use crate::types::{AppSettings, DatVariant};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("settings.json"))
        .map_err(|error| format!("Failed to resolve app data dir: {error}"))
}

pub fn load_settings(app: &AppHandle) -> (AppSettings, bool) {
    let Ok(path) = settings_path(app) else {
        return (AppSettings::default(), false);
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return (AppSettings::default(), false);
    };
    match serde_json::from_str::<AppSettings>(&raw) {
        Ok(settings) => (normalize_settings(settings), true),
        Err(_) => (AppSettings::default(), false),
    }
}

pub fn save_settings(app: &AppHandle, settings: &AppSettings) -> Result<AppSettings, String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create settings directory {}: {error}", parent.display()))?;
    }

    let normalized = normalize_settings(settings.clone());
    let body = serde_json::to_string_pretty(&normalized).map_err(|error| error.to_string())?;
    fs::write(&path, format!("{body}\n"))
        .map_err(|error| format!("Failed to write {}: {error}", path.display()))?;
    Ok(normalized)
}

pub fn resolve_save_directory(app: &AppHandle, fallback: Option<PathBuf>) -> Option<PathBuf> {
    let (settings, _) = load_settings(app);
    if let Some(dir) = settings
        .default_save_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let path = PathBuf::from(dir);
        if path.is_dir() {
            return Some(path);
        }
    }
    fallback
}

pub fn remember_save_directory(app: &AppHandle, saved_path: &str) {
    let Some(parent) = Path::new(saved_path).parent() else {
        return;
    };
    if !parent.exists() {
        return;
    }

    let (mut settings, _) = load_settings(app);
    settings.default_save_dir = Some(parent.to_string_lossy().to_string());
    let _ = save_settings(app, &settings);
}

pub fn allows_system_slug(settings: &AppSettings, slug: &str) -> bool {
    settings.show_all_systems || settings.visible_system_slugs.iter().any(|value| value == slug)
}

pub fn filter_slugs(visible: &[String], slugs: Vec<String>) -> Vec<String> {
    let allowed: HashSet<&str> = visible.iter().map(String::as_str).collect();
    slugs
        .into_iter()
        .filter(|slug| allowed.contains(slug.as_str()))
        .collect()
}

pub fn filter_downloaded_slugs(app: &AppHandle, slugs: Vec<String>) -> Vec<String> {
    let (settings, _) = load_settings(app);
    if settings.show_all_systems {
        return slugs;
    }
    filter_slugs(&settings.visible_system_slugs, slugs)
}

pub fn resolve_dat_variant(settings: &AppSettings, slug: &str) -> DatVariant {
    settings
        .system_dat_variants
        .get(slug)
        .copied()
        .unwrap_or_else(|| DatVariant::from_serial_flag(settings.prefer_serial_version))
}

fn normalize_settings(mut settings: AppSettings) -> AppSettings {
    if let Some(dir) = settings.default_save_dir.as_deref().map(str::trim) {
        settings.default_save_dir = if dir.is_empty() {
            None
        } else {
            Some(dir.to_string())
        };
    }
    settings.visible_system_slugs = settings
        .visible_system_slugs
        .into_iter()
        .map(|slug| slug.trim().to_string())
        .filter(|slug| !slug.is_empty())
        .collect();
    settings.system_dat_variants = settings
        .system_dat_variants
        .into_iter()
        .map(|(slug, variant)| (slug.trim().to_string(), variant))
        .filter(|(slug, _)| !slug.is_empty())
        .collect();
    if settings.show_all_systems && !settings.visible_system_slugs.is_empty() {
        settings.show_all_systems = false;
    }
    settings
}

#[cfg(test)]
mod tests {
    use super::normalize_settings;
    use crate::types::AppSettings;

    #[test]
    fn blank_save_dir_becomes_none() {
        let settings = AppSettings {
            default_regions: vec!["Europe".into()],
            default_save_dir: Some("  ".into()),
            show_all_systems: true,
            visible_system_slugs: vec![" psx ".into(), "".into(), "gc".into()],
            prefer_serial_version: false,
            system_dat_variants: Default::default(),
        };
        let normalized = normalize_settings(settings);
        assert_eq!(normalized.default_save_dir, None);
        assert_eq!(normalized.default_regions, vec!["Europe"]);
        assert_eq!(normalized.visible_system_slugs, vec!["psx", "gc"]);
        assert!(!normalized.show_all_systems);
    }

    #[test]
    fn subset_visible_slugs_filters() {
        let slugs = vec!["psx".into(), "gc".into()];
        assert!(super::filter_slugs(&[], slugs.clone()).is_empty());
        assert_eq!(
            super::filter_slugs(&["gc".into()], slugs),
            vec!["gc".to_string()]
        );
    }

    #[test]
    fn resolve_dat_variant_prefers_per_system_override() {
        let mut settings = AppSettings::default();
        settings.prefer_serial_version = true;
        assert_eq!(
            super::resolve_dat_variant(&settings, "psx"),
            crate::types::DatVariant::Serial
        );

        settings
            .system_dat_variants
            .insert("psx".into(), crate::types::DatVariant::Standard);
        assert_eq!(
            super::resolve_dat_variant(&settings, "psx"),
            crate::types::DatVariant::Standard
        );
        assert_eq!(
            super::resolve_dat_variant(&settings, "gc"),
            crate::types::DatVariant::Serial
        );
    }
}
