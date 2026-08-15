// Required crates (add to Cargo.toml later; do not add here yet):
//   regex = "1"
//   reqwest = { version = "0.12", default-features = false, features = ["rustls-tls"] }
// Already present: serde, serde_json, tauri, zip, chrono, urlencoding, log
//
// Port of electron/redumpDownload.ts — Redump system list + DAT cache/download.

use crate::types::{DatVariant, RedumpSystem, RedumpSystemListSource};
use chrono::{SecondsFormat, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use zip::ZipArchive;

const REDUMP_BASE: &str = "https://redump.info";
const DOWNLOADS_URL: &str = "https://redump.info/downloads";
const SYSTEM_LIST_TTL_MS: u64 = 7 * 24 * 60 * 60 * 1000;
const UPDATE_PROBE_TTL_MS: u64 = 6 * 60 * 60 * 1000;
const HEAD_CONCURRENCY: usize = 4;
const FETCH_TIMEOUT_MS: u64 = 60_000;
const SCRAPE_TIMEOUT_MS: u64 = 30_000;
const HEAD_TIMEOUT_MS: u64 = 20_000;
const DOWNLOAD_TIMEOUT_MS: u64 = 120_000;

const BUNDLED_SYSTEMS_JSON: &str = include_str!("../../src/shared/redumpSystems.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatCacheMeta {
    pub slug: String,
    pub filename: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_length: Option<u64>,
    pub fetched_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_available: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_filename: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SystemListCache {
    #[serde(skip_serializing_if = "Option::is_none")]
    fetched_at: Option<String>,
    systems: Vec<SystemNameSlug>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SystemNameSlug {
    pub name: String,
    pub slug: String,
    #[serde(default)]
    pub has_serial_version: bool,
    #[serde(default)]
    pub has_cues: bool,
    #[serde(default)]
    pub has_sbi: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExtraKind {
    Cues,
    Sbi,
}

impl ExtraKind {
    pub fn from_label(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "cues" => Some(Self::Cues),
            "sbi" => Some(Self::Sbi),
            _ => None,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Cues => "cuesheets",
            Self::Sbi => "SBI",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSystemList {
    pub systems: Vec<RedumpSystem>,
    pub source: RedumpSystemListSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetched_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSystemResult {
    pub xml: String,
    pub original_filename: String,
    pub source_path: String,
    pub from_cache: bool,
}

fn user_agent(app: &AppHandle) -> String {
    format!(
        "RedumpDATFilter/{} (Tauri; +https://github.com/scdemanett/redump-dat-filter)",
        app.package_info().version
    )
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn cache_root(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("failed to resolve app data dir")
        .join("cache")
}

fn systems_cache_path(app: &AppHandle) -> PathBuf {
    cache_root(app).join("redump-systems.json")
}

fn sanitize_slug(slug: &str) -> String {
    slug.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn dat_dir(app: &AppHandle, slug: &str, variant: DatVariant) -> PathBuf {
    cache_dat_dir(&cache_root(app), slug, variant)
}

pub fn cache_dat_dir(cache_root: &Path, slug: &str, variant: DatVariant) -> PathBuf {
    let base = cache_root.join("dats").join(sanitize_slug(slug));
    match variant {
        DatVariant::Standard => base,
        DatVariant::Serial => base.join("serial"),
    }
}

fn dat_file_path(app: &AppHandle, slug: &str, variant: DatVariant) -> PathBuf {
    dat_dir(app, slug, variant).join("data.dat")
}

fn dat_meta_path(app: &AppHandle, slug: &str, variant: DatVariant) -> PathBuf {
    dat_dir(app, slug, variant).join("meta.json")
}

pub fn datfile_url(slug: &str, variant: DatVariant) -> String {
    let encoded = urlencoding::encode(slug);
    match variant {
        DatVariant::Standard => format!("{REDUMP_BASE}/datfile/{encoded}"),
        DatVariant::Serial => format!("{REDUMP_BASE}/datfile/{encoded}/serial,version"),
    }
}

pub fn extra_url(slug: &str, kind: ExtraKind) -> String {
    let encoded = urlencoding::encode(slug);
    match kind {
        ExtraKind::Cues => format!("{REDUMP_BASE}/cues/{encoded}"),
        ExtraKind::Sbi => format!("{REDUMP_BASE}/sbi/{encoded}"),
    }
}

fn ensure_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Failed to create directory {}: {e}", dir.display()))
}

fn read_json_file<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_json_file(path: &Path, value: &impl Serialize) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        ensure_dir(parent)?;
    }
    let body = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, format!("{body}\n")).map_err(|e| format!("Failed to write {}: {e}", path.display()))
}

fn is_fresh(iso: Option<&str>, ttl_ms: u64) -> bool {
    let Some(iso) = iso else {
        return false;
    };
    let Ok(ts) = chrono::DateTime::parse_from_rfc3339(iso) else {
        // JS Date.parse accepts more formats; try a loose fallback via timestamp millis.
        return false;
    };
    let age_ms = (Utc::now() - ts.with_timezone(&Utc))
        .num_milliseconds()
        .max(0) as u64;
    age_ms < ttl_ms
}

fn http_client(app: &AppHandle) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(user_agent(app))
        .timeout(Duration::from_millis(FETCH_TIMEOUT_MS))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

async fn fetch_with_timeout(
    client: &reqwest::Client,
    method: reqwest::Method,
    url: &str,
    timeout_ms: u64,
) -> Result<reqwest::Response, String> {
    client
        .request(method, url)
        .header("Accept", "*/*")
        .timeout(Duration::from_millis(timeout_ms))
        .send()
        .await
        .map_err(|e| format!("Request failed for {url}: {e}"))
}

/// Parse Redump downloads HTML into system rows with extra-download flags.
pub fn parse_systems_from_html(html: &str) -> Vec<SystemNameSlug> {
    static ROW_RE: OnceLock<Regex> = OnceLock::new();
    static TAG_RE: OnceLock<Regex> = OnceLock::new();
    static HREF_RE: OnceLock<Regex> = OnceLock::new();

    let row_re = ROW_RE.get_or_init(|| {
        Regex::new(r#"(?is)<tr[^>]*>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>"#)
            .expect("valid systems row regex")
    });
    let tag_re = TAG_RE.get_or_init(|| Regex::new(r"(?is)<[^>]+>").expect("valid tag regex"));
    let href_re = HREF_RE.get_or_init(|| Regex::new(r#"(?i)href="([^"]*)""#).expect("valid href regex"));

    let mut systems = Vec::new();
    let mut seen = HashSet::new();

    for caps in row_re.captures_iter(html) {
        let raw_name = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let downloads_html = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        let name = tag_re
            .replace_all(raw_name, "")
            .replace("&amp;", "&")
            .replace("&nbsp;", " ");
        let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
        if name.is_empty() {
            continue;
        }

        let mut slug: Option<String> = None;
        let mut has_serial_version = false;
        let mut has_cues = false;
        let mut has_sbi = false;

        for href_caps in href_re.captures_iter(downloads_html) {
            let href = href_caps.get(1).map(|m| m.as_str().trim()).unwrap_or("");
            if href.is_empty() {
                continue;
            }
            let path = href
                .strip_prefix("https://redump.info")
                .or_else(|| href.strip_prefix("http://redump.info"))
                .unwrap_or(href);

            if let Some(rest) = path.strip_prefix("/datfile/") {
                if let Some(serial_slug) = rest.strip_suffix("/serial,version") {
                    has_serial_version = true;
                    if slug.is_none() {
                        slug = Some(serial_slug.to_string());
                    }
                } else if !rest.contains('/') {
                    slug = Some(rest.to_string());
                }
            } else if let Some(cues_slug) = path.strip_prefix("/cues/") {
                has_cues = true;
                if slug.is_none() && !cues_slug.contains('/') {
                    slug = Some(cues_slug.to_string());
                }
            } else if let Some(sbi_slug) = path.strip_prefix("/sbi/") {
                has_sbi = true;
                if slug.is_none() && !sbi_slug.contains('/') {
                    slug = Some(sbi_slug.to_string());
                }
            }
        }

        let Some(slug) = slug.filter(|value| !value.is_empty()) else {
            continue;
        };
        if !seen.insert(slug.clone()) {
            continue;
        }
        systems.push(SystemNameSlug {
            name,
            slug,
            has_serial_version,
            has_cues,
            has_sbi,
        });
    }

    systems
}

/// Parse a Content-Disposition header value into a filename, if present.
pub fn parse_content_disposition_filename(header: Option<&str>) -> Option<String> {
    let header = header?;

    static UTF_RE: OnceLock<Regex> = OnceLock::new();
    static QUOTED_RE: OnceLock<Regex> = OnceLock::new();
    static PLAIN_RE: OnceLock<Regex> = OnceLock::new();

    let utf_re = UTF_RE.get_or_init(|| {
        Regex::new(r"(?i)filename\*\s*=\s*UTF-8''([^;]+)").expect("valid filename* regex")
    });
    if let Some(caps) = utf_re.captures(header) {
        let raw = caps
            .get(1)
            .map(|m| m.as_str().trim().trim_matches('"'))
            .unwrap_or("");
        return Some(
            urlencoding::decode(raw)
                .map(|c| c.into_owned())
                .unwrap_or_else(|_| raw.to_string()),
        );
    }

    let quoted_re = QUOTED_RE.get_or_init(|| {
        Regex::new(r#"(?i)filename\s*=\s*"((?:\\.|[^"\\])*)""#).expect("valid quoted filename regex")
    });
    if let Some(caps) = quoted_re.captures(header) {
        let inner = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        return Some(inner.replace("\\\"", "\""));
    }

    let plain_re = PLAIN_RE
        .get_or_init(|| Regex::new(r"(?i)filename\s*=\s*([^;]+)").expect("valid plain filename regex"));
    if let Some(caps) = plain_re.captures(header) {
        let raw = caps
            .get(1)
            .map(|m| m.as_str().trim().trim_matches('"'))
            .unwrap_or("");
        if !raw.is_empty() {
            return Some(raw.to_string());
        }
    }

    None
}

pub fn read_dat_meta(app: &AppHandle, slug: &str, variant: DatVariant) -> Option<DatCacheMeta> {
    read_json_file(&dat_meta_path(app, slug, variant))
}

fn list_downloaded_slugs(app: &AppHandle) -> Vec<String> {
    let (settings, _) = crate::settings::load_settings(app);
    let root = cache_root(app).join("dats");
    let entries = match fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    let mut slugs = Vec::new();
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let variant = crate::settings::resolve_dat_variant(&settings, &name);
        if let Some(meta) = read_dat_meta(app, &name, variant) {
            if !meta.filename.is_empty() {
                slugs.push(if meta.slug.is_empty() {
                    name
                } else {
                    meta.slug
                });
            }
        }
    }
    slugs
}

fn enrich_systems(app: &AppHandle, systems: &[SystemNameSlug]) -> Vec<RedumpSystem> {
    let (settings, _) = crate::settings::load_settings(app);
    systems
        .iter()
        .map(|system| {
            let variant = crate::settings::resolve_dat_variant(&settings, &system.slug);
            let meta = read_dat_meta(app, &system.slug, variant);
            RedumpSystem {
                name: system.name.clone(),
                slug: system.slug.clone(),
                downloaded: Some(meta.as_ref().is_some_and(|m| !m.filename.is_empty())),
                update_available: Some(
                    meta.as_ref()
                        .and_then(|m| m.update_available)
                        .unwrap_or(false),
                ),
                cached_filename: meta.map(|m| m.filename),
                has_serial_version: system.has_serial_version,
                has_cues: system.has_cues,
                has_sbi: system.has_sbi,
            }
        })
        .collect()
}

async fn scrape_systems_live(app: &AppHandle) -> Result<SystemListCache, String> {
    let client = http_client(app)?;
    let response =
        fetch_with_timeout(&client, reqwest::Method::GET, DOWNLOADS_URL, SCRAPE_TIMEOUT_MS).await?;
    if !response.status().is_success() {
        return Err(format!(
            "Failed to fetch Redump downloads page ({}).",
            response.status().as_u16()
        ));
    }
    let html = response
        .text()
        .await
        .map_err(|e| format!("Failed to read Redump downloads page: {e}"))?;
    let systems = parse_systems_from_html(&html);
    if systems.is_empty() {
        return Err("Could not parse any systems from the Redump downloads page.".to_string());
    }
    let cache = SystemListCache {
        fetched_at: Some(now_iso()),
        systems,
    };
    write_json_file(&systems_cache_path(app), &cache)?;
    Ok(cache)
}

fn bundled_systems() -> SystemListCache {
    let systems: Vec<SystemNameSlug> =
        serde_json::from_str(BUNDLED_SYSTEMS_JSON).unwrap_or_default();
    SystemListCache {
        fetched_at: None,
        systems,
    }
}

pub async fn get_system_list(app: &AppHandle, force: bool) -> Result<ResolvedSystemList, String> {
    let cached: Option<SystemListCache> = read_json_file(&systems_cache_path(app));

    if !force {
        if let Some(ref cache) = cached {
            if !cache.systems.is_empty() {
                return Ok(ResolvedSystemList {
                    systems: enrich_systems(app, &cache.systems),
                    source: RedumpSystemListSource::Cache,
                    fetched_at: cache.fetched_at.clone(),
                });
            }
        }
    }

    match scrape_systems_live(app).await {
        Ok(live) => Ok(ResolvedSystemList {
            systems: enrich_systems(app, &live.systems),
            source: RedumpSystemListSource::Live,
            fetched_at: live.fetched_at,
        }),
        Err(_) => {
            if let Some(cache) = cached {
                if !cache.systems.is_empty() {
                    return Ok(ResolvedSystemList {
                        systems: enrich_systems(app, &cache.systems),
                        source: RedumpSystemListSource::Cache,
                        fetched_at: cache.fetched_at,
                    });
                }
            }
            let bundled = bundled_systems();
            Ok(ResolvedSystemList {
                systems: enrich_systems(app, &bundled.systems),
                source: RedumpSystemListSource::Bundled,
                fetched_at: None,
            })
        }
    }
}

pub async fn refresh_system_list(app: &AppHandle) -> Result<ResolvedSystemList, String> {
    let live = scrape_systems_live(app).await?;
    Ok(ResolvedSystemList {
        systems: enrich_systems(app, &live.systems),
        source: RedumpSystemListSource::Live,
        fetched_at: live.fetched_at,
    })
}

/// Non-blocking refresh when cache is missing/stale.
pub fn maybe_refresh_system_list_in_background(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let cached: Option<SystemListCache> = read_json_file(&systems_cache_path(&app));
        if let Some(ref cache) = cached {
            if !cache.systems.is_empty()
                && is_fresh(cache.fetched_at.as_deref(), SYSTEM_LIST_TTL_MS)
            {
                return;
            }
        }
        if let Err(error) = scrape_systems_live(&app).await {
            log::warn!("Background Redump system list refresh failed: {error}");
        }
    });
}

async fn map_pool<T, R, F, Fut>(items: Vec<T>, concurrency: usize, worker: F) -> Vec<R>
where
    T: Send + 'static,
    R: Send + 'static,
    F: Fn(T) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = R> + Send + 'static,
{
    if items.is_empty() {
        return Vec::new();
    }

    let concurrency = concurrency.max(1).min(items.len());
    let worker = Arc::new(worker);
    let mut results = Vec::with_capacity(items.len());
    let mut iter = items.into_iter();

    loop {
        let mut batch = Vec::new();
        for _ in 0..concurrency {
            let Some(item) = iter.next() else {
                break;
            };
            let w = Arc::clone(&worker);
            batch.push(tauri::async_runtime::spawn(async move { w(item).await }));
        }
        if batch.is_empty() {
            break;
        }
        for handle in batch {
            match handle.await {
                Ok(value) => results.push(value),
                Err(err) => log::warn!("Worker task failed: {err}"),
            }
        }
    }

    results
}

async fn head_dat_info(
    client: &reqwest::Client,
    slug: &str,
    variant: DatVariant,
) -> Result<(Option<String>, Option<u64>), String> {
    let response = fetch_with_timeout(
        client,
        reqwest::Method::HEAD,
        &datfile_url(slug, variant),
        HEAD_TIMEOUT_MS,
    )
    .await?;
    if !response.status().is_success() {
        return Err(format!(
            "HEAD failed for {slug} ({}).",
            response.status().as_u16()
        ));
    }

    let filename = parse_content_disposition_filename(
        response
            .headers()
            .get(reqwest::header::CONTENT_DISPOSITION)
            .and_then(|v| v.to_str().ok()),
    );
    let content_length = response
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok());

    Ok((filename, content_length))
}

pub async fn check_downloaded_updates(
    app: &AppHandle,
    force: bool,
) -> Result<ResolvedSystemList, String> {
    let slugs = crate::settings::filter_downloaded_slugs(app, list_downloaded_slugs(app));
    let now = now_iso();
    let client = http_client(app)?;
    let app_clone = app.clone();
    let (settings, _) = crate::settings::load_settings(app);

    map_pool(slugs, HEAD_CONCURRENCY, move |slug| {
        let app = app_clone.clone();
        let client = client.clone();
        let now = now.clone();
        let variant = crate::settings::resolve_dat_variant(&settings, &slug);
        async move {
            let Some(meta) = read_dat_meta(&app, &slug, variant) else {
                return;
            };
            if !force && is_fresh(meta.checked_at.as_deref(), UPDATE_PROBE_TTL_MS) {
                return;
            }

            match head_dat_info(&client, &slug, variant).await {
                Ok((remote_filename, content_length)) => {
                    let remote_filename = remote_filename.or_else(|| meta.remote_filename.clone());
                    let update_available = remote_filename
                        .as_ref()
                        .is_some_and(|remote| remote != &meta.filename);
                    let next = DatCacheMeta {
                        slug: meta.slug,
                        filename: meta.filename,
                        content_length: content_length.or(meta.content_length),
                        fetched_at: meta.fetched_at,
                        update_available: Some(update_available),
                        remote_filename: remote_filename.or(meta.remote_filename),
                        checked_at: Some(now),
                    };
                    if let Err(err) = write_json_file(&dat_meta_path(&app, &slug, variant), &next) {
                        log::warn!("Failed to write update meta for {slug}: {err}");
                    }
                }
                Err(error) => {
                    log::warn!("Update probe failed for {slug}: {error}");
                    let next = DatCacheMeta {
                        update_available: Some(false),
                        checked_at: Some(now),
                        ..meta
                    };
                    if let Err(err) = write_json_file(&dat_meta_path(&app, &slug, variant), &next) {
                        log::warn!("Failed to write update meta for {slug}: {err}");
                    }
                }
            }
        }
    })
    .await;

    get_system_list(app, false).await
}

fn zip_entry_to_dat_filename(zip_name: &str) -> String {
    let base = Path::new(zip_name)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| zip_name.to_string());
    if base.to_ascii_lowercase().ends_with(".zip") {
        format!("{}.dat", &base[..base.len() - 4])
    } else {
        base
    }
}

fn extract_dat_from_zip(buffer: &[u8]) -> Result<(String, String), String> {
    let mut archive = ZipArchive::new(Cursor::new(buffer))
        .map_err(|e| format!("Failed to read ZIP archive: {e}"))?;

    let mut dat_idx: Option<usize> = None;
    let mut xml_idx: Option<usize> = None;
    let mut first_idx: Option<usize> = None;

    for i in 0..archive.len() {
        let file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read ZIP entry: {e}"))?;
        let name = file.name().to_string();
        if name.ends_with('/') {
            continue;
        }
        if first_idx.is_none() {
            first_idx = Some(i);
        }
        let lower = name.to_ascii_lowercase();
        if dat_idx.is_none() && lower.ends_with(".dat") {
            dat_idx = Some(i);
        } else if xml_idx.is_none() && lower.ends_with(".xml") {
            xml_idx = Some(i);
        }
    }

    let idx = dat_idx
        .or(xml_idx)
        .or(first_idx)
        .ok_or_else(|| "Downloaded ZIP did not contain a DAT file.".to_string())?;

    let mut file = archive
        .by_index(idx)
        .map_err(|e| format!("Failed to open DAT entry: {e}"))?;
    let entry_name = file.name().to_string();
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|e| format!("Failed to read DAT entry: {e}"))?;
    let xml = String::from_utf8(bytes).map_err(|e| format!("DAT entry is not valid UTF-8: {e}"))?;
    Ok((xml, zip_entry_to_dat_filename(&entry_name)))
}

fn replace_zip_with_dat(name: &str) -> String {
    if name.to_ascii_lowercase().ends_with(".zip") {
        format!("{}.dat", &name[..name.len() - 4])
    } else {
        name.to_string()
    }
}

async fn download_and_cache_dat(
    app: &AppHandle,
    slug: &str,
    variant: DatVariant,
) -> Result<DownloadSystemResult, String> {
    let client = http_client(app)?;
    let response = fetch_with_timeout(
        &client,
        reqwest::Method::GET,
        &datfile_url(slug, variant),
        DOWNLOAD_TIMEOUT_MS,
    )
    .await?;
    if !response.status().is_success() {
        return Err(format!(
            "Failed to download DAT for {slug} ({}).",
            response.status().as_u16()
        ));
    }

    let disposition = parse_content_disposition_filename(
        response
            .headers()
            .get(reqwest::header::CONTENT_DISPOSITION)
            .and_then(|v| v.to_str().ok()),
    );
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let content_length = response
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok());

    let buffer = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read DAT download body: {e}"))?;

    let looks_like_zip = (buffer.len() >= 4 && buffer[0] == 0x50 && buffer[1] == 0x4b)
        || disposition
            .as_deref()
            .is_some_and(|d| d.to_ascii_lowercase().ends_with(".zip"))
        || content_type.contains("zip");

    let (xml, dat_filename) = if looks_like_zip {
        let (xml, extracted_name) = extract_dat_from_zip(&buffer)?;
        let dat_filename = disposition
            .as_deref()
            .map(replace_zip_with_dat)
            .unwrap_or(extracted_name);
        (xml, dat_filename)
    } else {
        let xml = String::from_utf8(buffer.to_vec())
            .map_err(|e| format!("Downloaded DAT is not valid UTF-8: {e}"))?;
        let dat_filename = disposition
            .as_deref()
            .map(replace_zip_with_dat)
            .unwrap_or_else(|| format!("{slug}.dat"));
        (xml, dat_filename)
    };

    let source_path = dat_file_path(app, slug, variant);
    ensure_dir(&dat_dir(app, slug, variant))?;
    fs::write(&source_path, &xml)
        .map_err(|e| format!("Failed to write cached DAT {}: {e}", source_path.display()))?;

    let filename = disposition.clone().unwrap_or_else(|| dat_filename.clone());
    let checked = now_iso();
    let meta = DatCacheMeta {
        slug: slug.to_string(),
        filename: filename.clone(),
        content_length,
        fetched_at: checked.clone(),
        update_available: Some(false),
        remote_filename: Some(filename),
        checked_at: Some(checked),
    };
    write_json_file(&dat_meta_path(app, slug, variant), &meta)?;

    Ok(DownloadSystemResult {
        xml,
        original_filename: dat_filename,
        source_path: source_path.to_string_lossy().into_owned(),
        from_cache: false,
    })
}

pub async fn download_or_load_system(
    app: &AppHandle,
    slug: &str,
    force: bool,
    variant: DatVariant,
) -> Result<DownloadSystemResult, String> {
    let normalized = slug.trim();
    if normalized.is_empty() {
        return Err("No system slug provided.".to_string());
    }

    let meta = read_dat_meta(app, normalized, variant);
    let cached_path = dat_file_path(app, normalized, variant);

    if !force {
        if let Some(ref meta) = meta {
            if !meta.filename.is_empty() {
                let client = http_client(app)?;
                match head_dat_info(&client, normalized, variant).await {
                    Ok((remote_filename, content_length)) => {
                        if let Some(ref remote) = remote_filename {
                            if remote == &meta.filename {
                                let xml = fs::read_to_string(&cached_path).map_err(|e| {
                                    format!("Failed to read cached DAT {}: {e}", cached_path.display())
                                })?;
                                let next = DatCacheMeta {
                                    update_available: Some(false),
                                    remote_filename: Some(remote.clone()),
                                    checked_at: Some(now_iso()),
                                    content_length: content_length.or(meta.content_length),
                                    ..meta.clone()
                                };
                                write_json_file(&dat_meta_path(app, normalized, variant), &next)?;
                                return Ok(DownloadSystemResult {
                                    xml,
                                    original_filename: replace_zip_with_dat(&meta.filename),
                                    source_path: cached_path.to_string_lossy().into_owned(),
                                    from_cache: true,
                                });
                            }
                        }
                    }
                    Err(error) => {
                        log::warn!(
                            "HEAD check failed for {normalized}; trying cached DAT: {error}"
                        );
                        if let Ok(xml) = fs::read_to_string(&cached_path) {
                            return Ok(DownloadSystemResult {
                                xml,
                                original_filename: replace_zip_with_dat(&meta.filename),
                                source_path: cached_path.to_string_lossy().into_owned(),
                                from_cache: true,
                            });
                        }
                    }
                }
            }
        }
    }

    download_and_cache_dat(app, normalized, variant).await
}

pub struct DownloadExtraResult {
    pub bytes: Vec<u8>,
    pub filename: String,
}

pub async fn download_extra(
    app: &AppHandle,
    slug: &str,
    kind: ExtraKind,
) -> Result<DownloadExtraResult, String> {
    let normalized = slug.trim();
    if normalized.is_empty() {
        return Err("No system slug provided.".to_string());
    }

    let client = http_client(app)?;
    let response = fetch_with_timeout(
        &client,
        reqwest::Method::GET,
        &extra_url(normalized, kind),
        DOWNLOAD_TIMEOUT_MS,
    )
    .await?;
    if !response.status().is_success() {
        return Err(format!(
            "Failed to download {} for {normalized} ({}).",
            kind.label(),
            response.status().as_u16()
        ));
    }

    let filename = parse_content_disposition_filename(
        response
            .headers()
            .get(reqwest::header::CONTENT_DISPOSITION)
            .and_then(|v| v.to_str().ok()),
    )
    .filter(|value| !value.trim().is_empty())
    .unwrap_or_else(|| match kind {
        ExtraKind::Cues => format!("{normalized}-cues.zip"),
        ExtraKind::Sbi => format!("{normalized}-sbi.zip"),
    });

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read {} download body: {e}", kind.label()))?;

    Ok(DownloadExtraResult {
        bytes: bytes.to_vec(),
        filename,
    })
}

fn is_dir_empty(path: &Path) -> bool {
    match fs::read_dir(path) {
        Ok(mut entries) => entries.next().is_none(),
        Err(_) => true,
    }
}

fn electron_cache_dir(app: &AppHandle) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        let appdata = std::env::var_os("APPDATA")?;
        Some(PathBuf::from(appdata).join("redump-dat-filter").join("cache"))
    }
    #[cfg(target_os = "macos")]
    {
        let home = app.path().home_dir().ok()?;
        Some(
            home.join("Library")
                .join("Application Support")
                .join("redump-dat-filter")
                .join("cache"),
        )
    }
    #[cfg(target_os = "linux")]
    {
        let home = app.path().home_dir().ok()?;
        Some(home.join(".config").join("redump-dat-filter").join("cache"))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = app;
        None
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    ensure_dir(dst)?;
    for entry in fs::read_dir(src).map_err(|e| format!("Failed to read {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let target = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), &target)
                .map_err(|e| format!("Failed to copy to {}: {e}", target.display()))?;
        }
    }
    Ok(())
}

/// If the Tauri cache is empty and an Electron userData cache exists, copy it over.
pub fn migrate_electron_cache_if_needed(app: &AppHandle) {
    let tauri_cache = cache_root(app);
    if !is_dir_empty(&tauri_cache) {
        return;
    }

    let Some(electron_cache) = electron_cache_dir(app) else {
        return;
    };
    if !electron_cache.is_dir() || is_dir_empty(&electron_cache) {
        return;
    }

    match copy_dir_recursive(&electron_cache, &tauri_cache) {
        Ok(()) => log::info!(
            "Migrated Electron cache from {} to {}",
            electron_cache.display(),
            tauri_cache.display()
        ),
        Err(err) => log::warn!("Electron cache migration failed: {err}"),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        cache_dat_dir, datfile_url, extra_url, parse_content_disposition_filename,
        parse_systems_from_html, ExtraKind,
    };
    use crate::types::DatVariant;
    use std::path::Path;

    #[test]
    fn parse_systems_from_html_extracts_flags_and_skips_bios() {
        let html = r#"
            <table>
              <tr><td>Sony <b>PlayStation</b></td><td>
                <a href="/datfile/psx">Dat</a>
                <a href="/datfile/psx/serial,version">Dat + Serial/Version</a>
                <a href="/cues/psx">Cuesheets</a>
                <a href="/sbi/psx">SBI</a>
              </td></tr>
              <tr><td>Nintendo&nbsp;GameCube</td><td>
                <a href="/datfile/gc">Dat</a>
                <a href="/datfile/gc/serial,version">Dat + Serial/Version</a>
              </td></tr>
              <tr><td>Sony PlayStation</td><td><a href="/datfile/psx">dup</a></td></tr>
              <tr><td></td><td><a href="/datfile/empty">x</a></td></tr>
              <tr><td>Microsoft Xbox</td><td><a href="">Dat</a></td></tr>
            </table>
        "#;
        let systems = parse_systems_from_html(html);
        assert_eq!(systems.len(), 2);
        assert_eq!(systems[0].name, "Sony PlayStation");
        assert_eq!(systems[0].slug, "psx");
        assert!(systems[0].has_serial_version);
        assert!(systems[0].has_cues);
        assert!(systems[0].has_sbi);
        assert_eq!(systems[1].name, "Nintendo GameCube");
        assert_eq!(systems[1].slug, "gc");
        assert!(systems[1].has_serial_version);
        assert!(!systems[1].has_cues);
        assert!(!systems[1].has_sbi);
    }

    #[test]
    fn datfile_and_extra_urls_match_redump_paths() {
        assert_eq!(
            datfile_url("psx", DatVariant::Standard),
            "https://redump.info/datfile/psx"
        );
        assert_eq!(
            datfile_url("psx", DatVariant::Serial),
            "https://redump.info/datfile/psx/serial,version"
        );
        assert_eq!(extra_url("psx", ExtraKind::Cues), "https://redump.info/cues/psx");
        assert_eq!(extra_url("psx", ExtraKind::Sbi), "https://redump.info/sbi/psx");
    }

    #[test]
    fn cache_dat_dir_keeps_standard_layout_and_nests_serial() {
        let root = Path::new("/tmp/cache");
        assert_eq!(
            cache_dat_dir(root, "psx", DatVariant::Standard),
            root.join("dats").join("psx")
        );
        assert_eq!(
            cache_dat_dir(root, "psx", DatVariant::Serial),
            root.join("dats").join("psx").join("serial")
        );
    }

    #[test]
    fn parse_content_disposition_filename_supports_variants() {
        assert_eq!(
            parse_content_disposition_filename(Some(
                r#"attachment; filename="redump_psx.zip""#
            ))
            .as_deref(),
            Some("redump_psx.zip")
        );
        assert_eq!(
            parse_content_disposition_filename(Some(
                "attachment; filename*=UTF-8''redump%20psx.zip"
            ))
            .as_deref(),
            Some("redump psx.zip")
        );
        assert_eq!(
            parse_content_disposition_filename(Some("attachment; filename=plain.dat"))
                .as_deref(),
            Some("plain.dat")
        );
        assert_eq!(parse_content_disposition_filename(None), None);
        assert_eq!(
            parse_content_disposition_filename(Some("inline")),
            None
        );
    }
}
