// Required crates (add to Cargo.toml later; do not add here yet):
//   regex = "1"
//   serde = { version = "1", features = ["derive"] }  // already present
//   serde_json = "1"  // already present
// Optional (not used by this port; raw game blocks are regex-extracted):
//   quick-xml = "0.37"
//
// Port of src/shared/datParser.ts — preserve original <game> XML blocks on filter output.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

const XML_DECLARATION: &str = r#"<?xml version="1.0"?>"#;
const DATAFILE_DOCTYPE: &str = r#"<!DOCTYPE datafile PUBLIC "-//Logiqx//DTD ROM Management Datafile//EN" "http://www.logiqx.com/Dats/datafile.dtd">"#;

const DEFAULT_REGION: &str = "Unknown";

fn region_synonyms() -> &'static HashMap<&'static str, &'static str> {
    static MAP: OnceLock<HashMap<&'static str, &'static str>> = OnceLock::new();
    MAP.get_or_init(|| {
        HashMap::from([
            ("world", "World"),
            ("worldwide", "World"),
            ("usa", "USA"),
            ("u.s.a.", "USA"),
            ("us", "USA"),
            ("u.s.", "USA"),
            ("north america", "USA"),
            ("europe", "Europe"),
            ("eur", "Europe"),
            ("pal", "Europe"),
            ("japan", "Japan"),
            ("jpn", "Japan"),
            ("asia", "Asia"),
            ("asia pacific", "Asia"),
            ("asia-pacific", "Asia"),
            ("australia", "Australia"),
            ("australasia", "Australia"),
            ("brazil", "Brazil"),
            ("canada", "Canada"),
            ("china", "China"),
            ("denmark", "Denmark"),
            ("finland", "Finland"),
            ("france", "France"),
            ("germany", "Germany"),
            ("hong kong", "Hong Kong"),
            ("italy", "Italy"),
            ("korea", "Korea"),
            ("south korea", "Korea"),
            ("republic of korea", "Korea"),
            ("mexico", "Mexico"),
            ("netherlands", "Netherlands"),
            ("new zealand", "New Zealand"),
            ("norway", "Norway"),
            ("russia", "Russia"),
            ("spain", "Spain"),
            ("sweden", "Sweden"),
            ("switzerland", "Switzerland"),
            ("taiwan", "Taiwan"),
            ("uk", "United Kingdom"),
            ("united kingdom", "United Kingdom"),
            ("england", "United Kingdom"),
            ("ireland", "Ireland"),
            ("poland", "Poland"),
            ("portugal", "Portugal"),
            ("belgium", "Belgium"),
            ("greece", "Greece"),
            ("czech republic", "Czech Republic"),
            ("south africa", "South Africa"),
            ("latin america", "Latin America"),
            ("middle east", "Middle East"),
            ("africa", "Africa"),
            ("asia minor", "Asia"),
            ("united states", "USA"),
        ])
    })
}

fn canonical_regions() -> &'static HashSet<&'static str> {
    static SET: OnceLock<HashSet<&'static str>> = OnceLock::new();
    SET.get_or_init(|| {
        let mut set: HashSet<&'static str> = region_synonyms().values().copied().collect();
        set.insert(DEFAULT_REGION);
        set
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatHeader {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub extra: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatRom {
    pub attributes: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatGame {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub roms: Vec<DatRom>,
    pub regions: Vec<String>,
    /// Original `<game>...</game>` element text from the source DAT.
    pub raw_xml: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedDat {
    pub header: DatHeader,
    pub games: Vec<DatGame>,
    pub available_regions: Vec<String>,
    pub descriptor: String,
    pub normalized_descriptor: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_label: Option<String>,
    pub raw_root_extras: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterSummary {
    pub initial_games: usize,
    pub filtered_games: usize,
    pub removed_games: usize,
    pub selected_regions: Vec<String>,
    pub region_label: String,
    pub descriptor: String,
    pub normalized_descriptor: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilteredDatResult {
    pub xml: String,
    pub filename: String,
    pub header: DatHeader,
    pub games: Vec<DatGame>,
    pub summary: FilterSummary,
}

pub fn parse_dat(xml: &str) -> Result<ParsedDat, String> {
    if !datafile_present(xml) {
        return Err("Invalid DAT: missing <datafile> root node.".to_string());
    }

    let header = normalize_header(&extract_header_fields(xml)?)?;
    let version_label = header
        .version
        .clone()
        .or_else(|| header.date.clone());

    let blocks = extract_raw_game_blocks(xml);
    let mut games = Vec::with_capacity(blocks.len());
    for raw in blocks {
        games.push(normalize_game(raw));
    }

    let mut available_region_set: HashSet<String> = HashSet::new();
    for game in &games {
        if game.regions.is_empty() {
            available_region_set.insert(DEFAULT_REGION.to_string());
        } else {
            for region in &game.regions {
                available_region_set.insert(region.clone());
            }
        }
    }

    let (original_descriptor, normalized_descriptor) =
        derive_descriptors(&header, games.len());

    let mut available_regions: Vec<String> = available_region_set.into_iter().collect();
    // Match JS `localeCompare` for ASCII region labels (case-insensitive).
    available_regions.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));

    Ok(ParsedDat {
        header,
        games,
        available_regions,
        descriptor: original_descriptor,
        normalized_descriptor,
        version_label,
        raw_root_extras: HashMap::new(),
    })
}

pub fn filter_dat_by_regions(
    parsed: &ParsedDat,
    selected_regions: &[String],
    base_filename: Option<&str>,
) -> Result<FilteredDatResult, String> {
    let mut canonical_selections: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for value in selected_regions {
        let normalized = normalize_region_token(Some(value.as_str()))
            .unwrap_or_else(|| value.clone());
        if normalized.is_empty() {
            continue;
        }
        if seen.insert(normalized.clone()) {
            canonical_selections.push(normalized);
        }
    }

    let normalized_selection: HashSet<String> =
        canonical_selections.iter().cloned().collect();
    let selection_active = !normalized_selection.is_empty();

    let games: Vec<DatGame> = if selection_active {
        parsed
            .games
            .iter()
            .filter(|game| {
                game.regions
                    .iter()
                    .any(|region| normalized_selection.contains(region))
            })
            .cloned()
            .collect()
    } else {
        parsed.games.clone()
    };

    if games.is_empty() {
        return Err("No games match the selected region filters.".to_string());
    }

    let descriptor_original = if parsed.descriptor.is_empty() {
        "Datfile".to_string()
    } else {
        parsed.descriptor.clone()
    };
    let descriptor_normalized = if parsed.normalized_descriptor.is_empty() {
        normalize_descriptor_label(&descriptor_original)
    } else {
        parsed.normalized_descriptor.clone()
    };

    let header = build_filtered_header(
        &parsed.header,
        games.len(),
        &canonical_selections,
        &descriptor_original,
        parsed.version_label.as_deref(),
    );

    let mut xml = build_filtered_xml(&header, &games);
    xml = xml.replace("&apos;", "'");
    xml = Regex::new(r"\r?\n")
        .unwrap()
        .replace_all(&xml, "\r\n")
        .into_owned();

    let filename = derive_filtered_filename(
        base_filename,
        header.description.as_deref(),
        &header.name,
        &descriptor_normalized,
        games.len(),
        parsed.version_label.as_deref(),
    );

    let summary = FilterSummary {
        initial_games: parsed.games.len(),
        filtered_games: games.len(),
        removed_games: parsed.games.len() - games.len(),
        region_label: create_region_label(&canonical_selections),
        selected_regions: canonical_selections,
        descriptor: descriptor_original,
        normalized_descriptor: descriptor_normalized,
        version_label: parsed.version_label.clone(),
    };

    Ok(FilteredDatResult {
        xml,
        filename,
        header,
        games,
        summary,
    })
}

fn datafile_present(xml: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"<datafile[\s/>]").unwrap());
    re.is_match(xml)
}

fn extract_header_fields(xml: &str) -> Result<HashMap<String, String>, String> {
    static HEADER_RE: OnceLock<Regex> = OnceLock::new();
    static OPEN_RE: OnceLock<Regex> = OnceLock::new();

    let header_re =
        HEADER_RE.get_or_init(|| Regex::new(r"(?s)<header\b[^>]*>(.*?)</header>").unwrap());
    let open_re =
        OPEN_RE.get_or_init(|| Regex::new(r"<([A-Za-z_][\w.-]*)\b[^>]*>").unwrap());

    let Some(caps) = header_re.captures(xml) else {
        return Ok(HashMap::new());
    };
    let body = caps.get(1).map(|m| m.as_str()).unwrap_or("");

    let mut fields = HashMap::new();
    let mut search_from = 0usize;
    while let Some(caps) = open_re.captures(&body[search_from..]) {
        let full = caps.get(0).unwrap();
        let key = caps.get(1).unwrap().as_str();
        let content_start = search_from + full.end();
        let close_tag = format!("</{key}>");
        if let Some(close_rel) = body[content_start..].find(&close_tag) {
            let value = decode_basic_entities(body[content_start..content_start + close_rel].trim());
            fields.insert(key.to_string(), value);
            search_from = content_start + close_rel + close_tag.len();
        } else {
            search_from = content_start;
        }
    }
    Ok(fields)
}

fn extract_raw_game_blocks(xml: &str) -> Vec<&str> {
    let mut blocks = Vec::new();
    let mut from = 0usize;

    while let Some(start) = find_open_tag(xml, from, "<game") {
        let Some(open_end) = xml[start..].find('>') else {
            break;
        };
        let gt = start + open_end;
        if is_self_closing_tag(&xml[start..=gt]) {
            blocks.push(&xml[start..=gt]);
            from = gt + 1;
            continue;
        }

        let Some(close_rel) = xml[gt + 1..].find("</game>") else {
            break;
        };
        let end = gt + 1 + close_rel + "</game>".len();
        blocks.push(&xml[start..end]);
        from = end;
    }

    blocks
}

fn find_open_tag(haystack: &str, mut from: usize, needle: &str) -> Option<usize> {
    while from < haystack.len() {
        let rel = haystack[from..].find(needle)?;
        let pos = from + rel;
        let name_end = pos + needle.len();
        if tag_name_ends_at(haystack, name_end) {
            return Some(pos);
        }
        from = name_end;
    }
    None
}

fn tag_name_ends_at(haystack: &str, name_end: usize) -> bool {
    match haystack[name_end..].chars().next() {
        None => true,
        Some(c) => !(c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.'),
    }
}

fn is_self_closing_tag(open_through_gt: &str) -> bool {
    open_through_gt
        .trim_end_matches('>')
        .trim_end()
        .ends_with('/')
}

fn normalize_header(raw: &HashMap<String, String>) -> Result<DatHeader, String> {
    let mut extra = HashMap::new();
    let mut header = DatHeader {
        name: String::new(),
        description: None,
        version: None,
        date: None,
        author: None,
        homepage: None,
        url: None,
        extra: HashMap::new(),
    };

    for (key, value) in raw {
        let text_value = value.clone();
        match key.as_str() {
            "name" => header.name = text_value,
            "description" => header.description = non_empty(text_value),
            "version" => header.version = non_empty(text_value),
            "date" => header.date = non_empty(text_value),
            "author" => header.author = non_empty(text_value),
            "homepage" => header.homepage = non_empty(text_value),
            "url" => header.url = non_empty(text_value),
            _ => {
                extra.insert(key.clone(), text_value);
            }
        }
    }
    header.extra = extra;

    if header.name.is_empty() {
        return Err("Invalid DAT header: missing <name>.".to_string());
    }

    Ok(header)
}

fn normalize_game(raw_xml: &str) -> DatGame {
    let name = extract_game_name(raw_xml);
    let description = extract_child_text(raw_xml, "description");
    let category = extract_child_text(raw_xml, "category");
    let mut regions = extract_regions(Some(&name))
        .or_else(|| extract_regions(description.as_deref()));
    let roms = if regions.is_some() {
        Vec::new()
    } else {
        extract_roms(raw_xml)
    };
    if regions.is_none() {
        regions = roms
            .first()
            .and_then(|rom| rom.attributes.get("name"))
            .and_then(|n| extract_regions(Some(n)));
    }

    DatGame {
        name,
        description,
        category,
        roms,
        regions: regions.unwrap_or_default(),
        raw_xml: raw_xml.to_string(),
    }
}

fn extract_game_name(raw_xml: &str) -> String {
    if let Some(gt) = raw_xml.find('>') {
        if let Some(value) = quoted_attr(&raw_xml[..=gt], "name") {
            return decode_basic_entities(&value);
        }
    }

    extract_child_text(raw_xml, "name").unwrap_or_default()
}

fn extract_child_text(raw_xml: &str, tag: &str) -> Option<String> {
    match tag {
        "description" => extract_tagged_text(raw_xml, "<description", "</description>"),
        "category" => extract_tagged_text(raw_xml, "<category", "</category>"),
        "name" => extract_tagged_text(raw_xml, "<name", "</name>"),
        _ => {
            let open = format!("<{tag}");
            let close = format!("</{tag}>");
            extract_tagged_text(raw_xml, &open, &close)
        }
    }
}

fn extract_tagged_text(raw_xml: &str, open_needle: &str, close_needle: &str) -> Option<String> {
    let start = find_open_tag(raw_xml, 0, open_needle)?;
    let rel_gt = raw_xml[start..].find('>')?;
    let gt = start + rel_gt;
    if is_self_closing_tag(&raw_xml[start..=gt]) {
        return None;
    }
    let close_rel = raw_xml[gt + 1..].find(close_needle)?;
    let value = decode_basic_entities(raw_xml[gt + 1..gt + 1 + close_rel].trim());
    non_empty(value)
}

fn extract_roms(raw_xml: &str) -> Vec<DatRom> {
    let mut roms = Vec::new();
    let mut from = 0usize;

    while let Some(start) = find_open_tag(raw_xml, from, "<rom") {
        let Some(rel_gt) = raw_xml[start..].find('>') else {
            break;
        };
        let gt = start + rel_gt;
        let attr_blob = raw_xml[start + "<rom".len()..gt]
            .trim()
            .trim_end_matches('/');
        roms.push(DatRom {
            attributes: parse_quoted_attrs(attr_blob),
        });
        from = gt + 1;
    }

    roms
}

fn quoted_attr(blob: &str, name: &str) -> Option<String> {
    let mut from = 0usize;
    while let Some(rel) = blob[from..].find(name) {
        let pos = from + rel;
        let end = pos + name.len();
        let prev_ok = pos == 0 || {
            let prev = blob.as_bytes()[pos - 1];
            prev.is_ascii_whitespace() || prev == b'<'
        };
        let next_ok = tag_name_ends_at(blob, end);
        if prev_ok && next_ok {
            let rest = blob[end..].trim_start();
            if let Some(rest) = rest.strip_prefix('=') {
                let rest = rest.trim_start();
                if let Some(rest) = rest.strip_prefix('"') {
                    let close = rest.find('"')?;
                    return Some(rest[..close].to_string());
                }
            }
        }
        from = end;
    }
    None
}

fn parse_quoted_attrs(blob: &str) -> HashMap<String, String> {
    let bytes = blob.as_bytes();
    let mut attributes = HashMap::new();
    let mut i = 0usize;

    while i < bytes.len() {
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }

        let name_start = i;
        if !(bytes[i].is_ascii_alphabetic() || bytes[i] == b'_') {
            i += 1;
            continue;
        }
        i += 1;
        while i < bytes.len()
            && (bytes[i].is_ascii_alphanumeric() || matches!(bytes[i], b'_' | b'.' | b'-'))
        {
            i += 1;
        }
        let name = &blob[name_start..i];

        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() || bytes[i] != b'=' {
            continue;
        }
        i += 1;
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() || bytes[i] != b'"' {
            continue;
        }
        i += 1;
        let value_start = i;
        while i < bytes.len() && bytes[i] != b'"' {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        attributes.insert(
            name.to_string(),
            decode_basic_entities(&blob[value_start..i]),
        );
        i += 1;
    }

    attributes
}

fn extract_regions(input: Option<&str>) -> Option<Vec<String>> {
    let input = input?;
    if input.is_empty() {
        return None;
    }

    static PAREN_RE: OnceLock<Regex> = OnceLock::new();
    let paren_re = PAREN_RE.get_or_init(|| Regex::new(r"\(([^()]+)\)").unwrap());

    for caps in paren_re.captures_iter(input) {
        let inside = caps.get(1).unwrap().as_str();
        let tokens = tokenize_region_segment(inside);
        if tokens.is_empty() {
            continue;
        }

        let mut normalized_tokens: Vec<String> = tokens
            .iter()
            .filter_map(|token| normalize_region_token(Some(token)))
            .collect();

        if !normalized_tokens.is_empty() {
            let mut seen = HashSet::new();
            normalized_tokens.retain(|t| seen.insert(t.clone()));
            return Some(normalized_tokens);
        }
    }

    None
}

fn tokenize_region_segment(segment: &str) -> Vec<String> {
    static SPLIT_RE: OnceLock<Regex> = OnceLock::new();
    static WS_RE: OnceLock<Regex> = OnceLock::new();
    let split_re = SPLIT_RE.get_or_init(|| Regex::new(r"[/,&]").unwrap());
    let ws_re = WS_RE.get_or_init(|| Regex::new(r"\s{2,}").unwrap());

    split_re
        .split(segment)
        .map(str::trim)
        .flat_map(|part| {
            ws_re
                .split(part)
                .map(str::trim)
                .filter(|p| !p.is_empty())
                .map(|p| p.to_string())
                .collect::<Vec<_>>()
        })
        .filter(|p| !p.is_empty())
        .collect()
}

fn normalize_region_token(token: Option<&str>) -> Option<String> {
    let token = token?;
    static DOT_RE: OnceLock<Regex> = OnceLock::new();
    static WS_RE: OnceLock<Regex> = OnceLock::new();
    let dot_re = DOT_RE.get_or_init(|| Regex::new(r"\.+").unwrap());
    let ws_re = WS_RE.get_or_init(|| Regex::new(r"\s+").unwrap());

    let cleaned = ws_re
        .replace_all(&dot_re.replace_all(token, ""), " ")
        .trim()
        .to_string();
    if cleaned.is_empty() {
        return None;
    }

    let lower = cleaned.to_lowercase();
    if let Some(synonym) = region_synonyms().get(lower.as_str()) {
        return Some((*synonym).to_string());
    }

    if canonical_regions().contains(cleaned.as_str()) {
        return Some(cleaned);
    }

    None
}

fn derive_descriptors(header: &DatHeader, total_games: usize) -> (String, String) {
    let description = header.description.clone().unwrap_or_default();
    let candidate = try_extract_descriptor(&description, &header.name, total_games);
    let generic = candidate.or_else(|| extract_generic_descriptor(&description));

    let normalized = normalize_descriptor_label(generic.as_deref().unwrap_or("Datfile"));
    let original_descriptor = generic
        .map(|label| normalize_descriptor_label(&label))
        .unwrap_or_else(|| normalized.clone());

    (original_descriptor, normalized)
}

fn try_extract_descriptor(
    description: &str,
    system_name: &str,
    total_games: usize,
) -> Option<String> {
    if description.is_empty() {
        return None;
    }

    let escaped_system = escape_reg_exp(system_name);
    let count_pattern = escape_reg_exp(&total_games.to_string());
    let pattern = format!(r"^{escaped_system}\s*-\s*(.+?)\s*\({count_pattern}\)");
    let re = Regex::new(&pattern).ok()?;
    re.captures(description)
        .and_then(|caps| caps.get(1).map(|m| m.as_str().trim().to_string()))
}

fn extract_generic_descriptor(description: &str) -> Option<String> {
    static FALLBACK_RE: OnceLock<Regex> = OnceLock::new();
    static DATFILE_RE: OnceLock<Regex> = OnceLock::new();
    let fallback_re = FALLBACK_RE.get_or_init(|| {
        Regex::new(r"(?i)-\s*([^-()]+(?:\s*\(\s*serial\s*,\s*version\s*\))?)\s*\(\d+\)").unwrap()
    });
    let datfile_re = DATFILE_RE.get_or_init(|| Regex::new(r"(?i)datfile").unwrap());

    if let Some(caps) = fallback_re.captures(description) {
        if let Some(m) = caps.get(1) {
            return Some(m.as_str().trim().to_string());
        }
    }
    if datfile_re.is_match(description) {
        return Some("Datfile".to_string());
    }
    None
}

fn split_serial_version_suffix(label: &str) -> (String, bool) {
    static SERIAL_RE: OnceLock<Regex> = OnceLock::new();
    let serial_re = SERIAL_RE
        .get_or_init(|| Regex::new(r"(?i)\(\s*serial\s*,\s*version\s*\)").unwrap());
    let has_serial = serial_re.is_match(label);
    let stripped = serial_re.replace_all(label, "");
    let stripped = stripped.split_whitespace().collect::<Vec<_>>().join(" ");
    (stripped, has_serial)
}

fn normalize_descriptor_label(label: &str) -> String {
    static DATFILE_RE: OnceLock<Regex> = OnceLock::new();
    static DISC_RE: OnceLock<Regex> = OnceLock::new();
    let datfile_re = DATFILE_RE.get_or_init(|| Regex::new(r"(?i)datfile").unwrap());
    let disc_re = DISC_RE.get_or_init(|| Regex::new(r"(?i)disc").unwrap());

    let (stripped, has_serial) = split_serial_version_suffix(label);
    let base = if datfile_re.is_match(&stripped) || disc_re.is_match(&stripped) {
        "Datfile".to_string()
    } else if stripped.is_empty() {
        "Datfile".to_string()
    } else {
        stripped
    };

    if has_serial {
        format!("{base} (serial,version)")
    } else {
        base
    }
}

fn build_filtered_header(
    header: &DatHeader,
    filtered_count: usize,
    selected_regions: &[String],
    descriptor_original: &str,
    version_label: Option<&str>,
) -> DatHeader {
    let region_label = create_region_label(selected_regions);
    let system_name = &header.name;
    let version = version_label
        .map(|s| s.to_string())
        .or_else(|| header.version.clone())
        .or_else(|| header.date.clone())
        .unwrap_or_else(fallback_iso_date);

    let decorated_system = if region_label.is_empty() {
        system_name.clone()
    } else {
        format!("{system_name} ({region_label})")
    };

    let description = format!(
        "{decorated_system} - {descriptor_original} ({filtered_count}) ({version})"
    );

    DatHeader {
        name: decorated_system,
        description: Some(description),
        version: header.version.clone(),
        date: header.date.clone(),
        author: header.author.clone(),
        homepage: header.homepage.clone(),
        url: header.url.clone(),
        extra: header.extra.clone(),
    }
}

fn build_filtered_xml(header: &DatHeader, games: &[DatGame]) -> String {
    let mut lines: Vec<String> = Vec::new();
    lines.push(XML_DECLARATION.to_string());
    lines.push(DATAFILE_DOCTYPE.to_string());
    lines.push("<datafile>".to_string());
    lines.push("\t<header>".to_string());

    for (key, value) in header_xml_entries(header) {
        lines.push(format!(
            "\t\t<{key}>{}</{key}>",
            escape_xml_text(&value)
        ));
    }

    lines.push("\t</header>".to_string());

    for game in games {
        lines.push(indent_game_block(&game.raw_xml));
    }

    lines.push("</datafile>".to_string());
    lines.join("\n")
}

fn header_xml_entries(header: &DatHeader) -> Vec<(String, String)> {
    let mut entries: Vec<(String, String)> = Vec::new();

    for (key, value) in &header.extra {
        entries.push((key.clone(), value.clone()));
    }

    let known: [(&str, Option<&str>); 7] = [
        ("name", Some(header.name.as_str())),
        ("description", header.description.as_deref()),
        ("version", header.version.as_deref()),
        ("date", header.date.as_deref()),
        ("author", header.author.as_deref()),
        ("homepage", header.homepage.as_deref()),
        ("url", header.url.as_deref()),
    ];

    for (key, value) in known {
        if let Some(v) = value {
            if let Some(existing) = entries.iter().position(|(k, _)| k == key) {
                entries[existing] = (key.to_string(), v.to_string());
            } else {
                entries.push((key.to_string(), v.to_string()));
            }
        }
    }

    entries
}

fn indent_game_block(raw_xml: &str) -> String {
    let trimmed = raw_xml.trim();
    let lines: Vec<&str> = trimmed.lines().collect();
    let min_indent = lines
        .iter()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.len() - l.trim_start().len())
        .min()
        .unwrap_or(0);

    lines
        .iter()
        .map(|line| {
            if line.trim().is_empty() {
                String::new()
            } else {
                let content = if line.len() >= min_indent {
                    &line[min_indent..]
                } else {
                    line.trim_start()
                };
                format!("\t{content}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn create_region_label(selected_regions: &[String]) -> String {
    if selected_regions.is_empty() {
        String::new()
    } else {
        selected_regions.join(", ")
    }
}

fn sanitize_filename(input: &str) -> String {
    static BAD_RE: OnceLock<Regex> = OnceLock::new();
    static WS_RE: OnceLock<Regex> = OnceLock::new();
    let bad_re = BAD_RE.get_or_init(|| Regex::new(r#"[<>:"/\\|?*]"#).unwrap());
    let ws_re = WS_RE.get_or_init(|| Regex::new(r"\s+").unwrap());

    ws_re
        .replace_all(&bad_re.replace_all(input, " "), " ")
        .trim()
        .to_string()
}

fn derive_filtered_filename(
    base_filename: Option<&str>,
    header_description: Option<&str>,
    decorated_system: &str,
    descriptor_normalized: &str,
    filtered_count: usize,
    version_label: Option<&str>,
) -> String {
    static EXT_RE: OnceLock<Regex> = OnceLock::new();
    static PATTERN_RE: OnceLock<Regex> = OnceLock::new();
    let ext_re = EXT_RE.get_or_init(|| Regex::new(r"(\.[^.]+)$").unwrap());
    let pattern_re = PATTERN_RE.get_or_init(|| {
        Regex::new(r"(?i)^(.*?)\s*-\s*([^-()]+?(?:\s*\(\s*serial\s*,\s*version\s*\))?)\s*\((\d+)\)(.*)$")
            .unwrap()
    });

    let (extension, base_without_extension) = if let Some(base) = base_filename {
        if let Some(caps) = ext_re.captures(base) {
            let ext = caps.get(1).unwrap().as_str();
            let without = &base[..base.len() - ext.len()];
            (ext.to_string(), Some(without.to_string()))
        } else {
            (".dat".to_string(), Some(base.to_string()))
        }
    } else {
        (".dat".to_string(), None)
    };

    if let Some(ref base_without) = base_without_extension {
        if let Some(caps) = pattern_re.captures(base_without) {
            let rest = caps.get(4).map(|m| m.as_str()).unwrap_or("");
            let rest_trimmed = rest.trim();
            let suffix = if !rest_trimmed.is_empty() {
                format!(" {rest_trimmed}")
            } else if let Some(v) = version_label {
                format!(" ({v})")
            } else {
                String::new()
            };
            let base_name = format!(
                "{decorated_system} - {descriptor_normalized} ({filtered_count}){suffix}"
            );
            return format!("{}{extension}", sanitize_filename(&base_name));
        }
    }

    if let Some(desc) = header_description {
        return format!("{}{extension}", sanitize_filename(desc));
    }

    let version_segment = version_label
        .map(|v| format!(" ({v})"))
        .unwrap_or_default();
    let fallback = format!(
        "{decorated_system} - {descriptor_normalized} ({filtered_count}){version_segment}"
    );
    format!("{}{extension}", sanitize_filename(&fallback))
}

fn escape_reg_exp(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        if matches!(
            ch,
            '.' | '*' | '+' | '?' | '^' | '$' | '{' | '}' | '(' | ')' | '|' | '[' | ']' | '\\'
        ) {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

fn escape_xml_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn decode_basic_entities(value: &str) -> String {
    if !value.contains('&') {
        return value.to_string();
    }
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn non_empty(value: String) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn fallback_iso_date() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Civil date from Unix days (UTC), matching JS toISOString().split('T')[0] closely enough.
    let days = (secs / 86_400) as i64;
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Algorithm from Howard Hinnant's date algorithms (UTC civil date from Unix day count).
fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_DAT: &str = r#"<?xml version="1.0"?>
<!DOCTYPE datafile PUBLIC "-//Logiqx//DTD ROM Management Datafile//EN" "http://www.logiqx.com/Dats/datafile.dtd">
<datafile>
  <header>
    <name>Microsoft - Xbox</name>
    <description>Microsoft - Xbox - Datfile (4) (2025-11-07 05-38-55)</description>
    <version>2025-11-07 05-38-55</version>
    <date>2025-11-07</date>
    <author>Redump</author>
  </header>
  <game name="Halo (USA)">
    <rom name="Halo (USA)" size="1" crc="11111111"/>
  </game>
  <game name="Forza Motorsport (Europe)">
    <rom name="Forza Motorsport (Europe)" size="1" crc="22222222"/>
  </game>
  <game name="Project Gotham Racing 2 (Japan)">
    <rom name="Project Gotham Racing 2 (Japan)" size="1" crc="33333333"/>
  </game>
  <game name="Generic Title">
    <rom name="Generic Title" size="1" crc="44444444"/>
  </game>
</datafile>"#;

    #[test]
    fn parses_header_regions_and_descriptors() {
        let parsed = parse_dat(SAMPLE_DAT).expect("parse SAMPLE_DAT");

        assert_eq!(parsed.header.name, "Microsoft - Xbox");
        assert_eq!(parsed.games.len(), 4);
        assert_eq!(
            parsed.available_regions,
            vec!["Europe", "Japan", "Unknown", "USA"]
        );
        assert_eq!(parsed.descriptor, "Datfile");
        assert_eq!(
            parsed.version_label.as_deref(),
            Some("2025-11-07 05-38-55")
        );
    }

    #[test]
    fn normalizes_region_synonyms_from_game_titles() {
        let parsed = parse_dat(
            r#"<?xml version="1.0"?>
<datafile>
  <header><name>Test System</name></header>
  <game name="Example (US)"><rom name="Example (US)" size="1" crc="aaaaaaaa"/></game>
  <game name="Other (USA, Europe)"><rom name="Other (USA, Europe)" size="1" crc="bbbbbbbb"/></game>
</datafile>"#,
        )
        .expect("parse synonym DAT");

        assert_eq!(parsed.games[0].regions, vec!["USA"]);
        assert_eq!(parsed.games[1].regions, vec!["USA", "Europe"]);
    }

    #[test]
    fn throws_when_datafile_root_is_missing() {
        let err = parse_dat("<root></root>").unwrap_err();
        assert!(
            err.contains("missing <datafile>"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn filters_games_to_the_selected_regions() {
        let parsed = parse_dat(SAMPLE_DAT).unwrap();
        let result = filter_dat_by_regions(
            &parsed,
            &["USA".to_string()],
            Some("Microsoft - Xbox - Datfile (4) (2025-11-07).dat"),
        )
        .unwrap();

        assert_eq!(result.games.len(), 1);
        assert_eq!(result.games[0].name, "Halo (USA)");
        assert_eq!(result.summary.filtered_games, 1);
        assert_eq!(result.summary.removed_games, 3);
        assert!(result.header.name.contains("(USA)"));
        assert!(result
            .header
            .description
            .as_deref()
            .unwrap_or("")
            .contains("(1)"));
        let filename_re = Regex::new(r"Microsoft - Xbox \(USA\) - Datfile \(1\)").unwrap();
        assert!(filename_re.is_match(&result.filename));
        let game_re = Regex::new(r#"<game name="Halo \(USA\)">"#).unwrap();
        assert!(game_re.is_match(&result.xml));
        assert!(!result.xml.contains("Forza Motorsport"));
    }

    #[test]
    fn preserves_serial_version_descriptor_tags_and_filename() {
        let xml = r#"<?xml version="1.0"?>
<!DOCTYPE datafile PUBLIC "-//Logiqx//DTD ROM Management Datafile//EN" "http://www.logiqx.com/Dats/datafile.dtd">
<datafile>
  <header>
    <name>Sony - PlayStation</name>
    <description>Sony - PlayStation - Datfile (serial,version) (2) (2026-08-15 10-57-09)</description>
    <version>2026-08-15 10-57-09</version>
    <date>2026-08-15</date>
    <author>redump.org</author>
    <homepage>http://redump.org/</homepage>
    <url>http://redump.org/</url>
  </header>
  <game name="Ridge Racer (USA)">
    <category>Games</category>
    <description>Ridge Racer (USA)</description>
    <id>1</id>
    <serial>SCUS-94300</serial>
    <rom name="Ridge Racer (USA)" size="1" crc="aaaaaaaa"/>
  </game>
  <game name="Tekken (Europe)">
    <category>Games</category>
    <description>Tekken (Europe)</description>
    <id>2</id>
    <serial>SCES-00005</serial>
    <rom name="Tekken (Europe)" size="1" crc="bbbbbbbb"/>
  </game>
</datafile>"#;
        let parsed = parse_dat(xml).expect("parse serial DAT");
        assert_eq!(parsed.descriptor, "Datfile (serial,version)");
        assert_eq!(parsed.normalized_descriptor, "Datfile (serial,version)");

        let result = filter_dat_by_regions(
            &parsed,
            &["USA".to_string()],
            Some("Sony - PlayStation - Datfile (serial,version) (2) (2026-08-15 10-57-09).dat"),
        )
        .unwrap();

        assert_eq!(result.games.len(), 1);
        assert!(result
            .header
            .description
            .as_deref()
            .unwrap_or("")
            .contains("Datfile (serial,version)"));
        assert!(result.filename.contains("Datfile (serial,version)"));
        assert!(result.xml.contains("<serial>SCUS-94300</serial>"));
        assert!(!result.xml.contains("Tekken"));
    }

    #[test]
    fn returns_all_games_when_no_regions_are_selected() {
        let parsed = parse_dat(SAMPLE_DAT).unwrap();
        let result = filter_dat_by_regions(&parsed, &[], Some("source.dat")).unwrap();

        assert_eq!(result.games.len(), 4);
        assert_eq!(result.summary.selected_regions.len(), 0);
    }

    #[test]
    fn throws_when_no_games_match_the_selected_regions() {
        let parsed = parse_dat(SAMPLE_DAT).unwrap();
        let err = filter_dat_by_regions(&parsed, &["Brazil".to_string()], Some("source.dat"))
            .unwrap_err();
        assert!(
            err.contains("No games match the selected region filters"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn rewrites_xml_with_crlf_line_endings_and_preserves_doctype() {
        let parsed = parse_dat(SAMPLE_DAT).unwrap();
        let result =
            filter_dat_by_regions(&parsed, &["Europe".to_string()], Some("source.dat")).unwrap();

        let start_re =
            Regex::new(r#"^<\?xml version="1.0"\?>\r\n<!DOCTYPE datafile"#).unwrap();
        assert!(start_re.is_match(&result.xml));
        let game_re =
            Regex::new(r#"\r\n\t<game name="Forza Motorsport \(Europe\)">"#).unwrap();
        assert!(game_re.is_match(&result.xml));
    }

    #[test]
    fn parses_self_closing_games_and_ignores_similar_tags() {
        let parsed = parse_dat(
            r#"<?xml version="1.0"?>
<datafile>
  <header><name>Test System</name></header>
  <games count="2"/>
  <game name="Alpha (USA)"/>
  <game name="Beta (Europe)"></game>
</datafile>"#,
        )
        .expect("parse self-closing DAT");

        assert_eq!(parsed.games.len(), 2);
        assert_eq!(parsed.games[0].name, "Alpha (USA)");
        assert_eq!(parsed.games[0].regions, vec!["USA"]);
        assert_eq!(parsed.games[1].name, "Beta (Europe)");
        assert_eq!(parsed.games[1].regions, vec!["Europe"]);
    }

    #[test]
    fn parses_a_large_dat_without_dropping_games() {
        let mut xml = String::from(
            r#"<?xml version="1.0"?>
<datafile>
  <header><name>Test System</name></header>
"#,
        );
        for i in 0..4000 {
            xml.push_str(&format!(
                r#"  <game name="Title {i} (USA)"><description>Title {i} (USA)</description><rom name="Title {i} (USA)" size="1" crc="aaaaaaaa"/></game>
"#
            ));
        }
        xml.push_str("</datafile>");

        let parsed = parse_dat(&xml).expect("parse large DAT");
        assert_eq!(parsed.games.len(), 4000);
        assert_eq!(parsed.games[0].name, "Title 0 (USA)");
        assert_eq!(parsed.games[3999].name, "Title 3999 (USA)");
        assert_eq!(parsed.available_regions, vec!["USA"]);
    }

    #[test]
    fn throws_when_header_name_is_missing() {
        let err = parse_dat(
            r#"<?xml version="1.0"?>
<datafile>
  <header><description>No name</description></header>
  <game name="Example (USA)"><rom name="Example (USA)" size="1" crc="aaaaaaaa"/></game>
</datafile>"#,
        )
        .unwrap_err();
        assert!(
            err.contains("missing <name>"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn decodes_entities_in_game_names_but_keeps_source_xml() {
        let parsed = parse_dat(
            r#"<?xml version="1.0"?>
<datafile>
  <header><name>Test System</name></header>
  <game name="Tom &amp; Jerry (USA)">
    <rom name="Tom &amp; Jerry (USA)" size="1" crc="aaaaaaaa"/>
  </game>
</datafile>"#,
        )
        .expect("parse entity DAT");

        assert_eq!(parsed.games[0].name, "Tom & Jerry (USA)");
        assert_eq!(parsed.games[0].regions, vec!["USA"]);

        let result = filter_dat_by_regions(&parsed, &["USA".to_string()], Some("source.dat")).unwrap();
        assert!(result.xml.contains(r#"name="Tom &amp; Jerry (USA)""#));
    }

    #[test]
    fn uses_later_parenthetical_when_earlier_ones_are_not_regions() {
        let parsed = parse_dat(
            r#"<?xml version="1.0"?>
<datafile>
  <header><name>Test System</name></header>
  <game name="Final Fantasy IX (Disc 1) (USA)">
    <rom name="Final Fantasy IX (Disc 1) (USA)" size="1" crc="aaaaaaaa"/>
  </game>
  <game name="Ridge Racer (Rev 1) (Japan)">
    <rom name="Ridge Racer (Rev 1) (Japan)" size="1" crc="bbbbbbbb"/>
  </game>
</datafile>"#,
        )
        .expect("parse disc DAT");

        assert_eq!(parsed.games[0].regions, vec!["USA"]);
        assert_eq!(parsed.games[1].regions, vec!["Japan"]);
    }

    #[test]
    fn falls_back_to_description_then_rom_name_for_regions() {
        let parsed = parse_dat(
            r#"<?xml version="1.0"?>
<datafile>
  <header><name>Test System</name></header>
  <game name="Catalog 1001">
    <description>Cool Game (Europe)</description>
    <rom name="Cool Game (Europe)" size="1" crc="aaaaaaaa"/>
  </game>
  <game name="Mystery Dump">
    <rom name="Mystery Dump (Japan)" size="1" crc="bbbbbbbb"/>
  </game>
  <game name="No Clue">
    <rom name="No Clue.bin" size="1" crc="cccccccc"/>
  </game>
</datafile>"#,
        )
        .expect("parse fallback DAT");

        assert_eq!(parsed.games[0].regions, vec!["Europe"]);
        assert_eq!(parsed.games[1].regions, vec!["Japan"]);
        assert_eq!(parsed.games[2].regions, Vec::<String>::new());
        assert_eq!(parsed.available_regions, vec!["Europe", "Japan", "Unknown"]);
    }

    #[test]
    fn splits_combined_region_tokens_and_synonyms() {
        let parsed = parse_dat(
            r#"<?xml version="1.0"?>
<datafile>
  <header><name>Test System</name></header>
  <game name="A (USA / Europe)"><rom name="A" size="1" crc="aaaaaaaa"/></game>
  <game name="B (Japan &amp; USA)"><rom name="B" size="1" crc="bbbbbbbb"/></game>
  <game name="C (PAL)"><rom name="C" size="1" crc="cccccccc"/></game>
  <game name="D (JPN)"><rom name="D" size="1" crc="dddddddd"/></game>
  <game name="E (World)"><rom name="E" size="1" crc="eeeeeeee"/></game>
</datafile>"#,
        )
        .expect("parse combined regions DAT");

        assert_eq!(parsed.games[0].regions, vec!["USA", "Europe"]);
        assert_eq!(parsed.games[1].regions, vec!["Japan", "USA"]);
        assert_eq!(parsed.games[2].regions, vec!["Europe"]);
        assert_eq!(parsed.games[3].regions, vec!["Japan"]);
        assert_eq!(parsed.games[4].regions, vec!["World"]);
    }

    #[test]
    fn reads_child_name_when_attribute_is_missing() {
        let parsed = parse_dat(
            r#"<?xml version="1.0"?>
<datafile>
  <header><name>Test System</name></header>
  <game>
    <name>Child Named (USA)</name>
    <rom name="Child Named (USA)" size="1" crc="aaaaaaaa"/>
  </game>
</datafile>"#,
        )
        .expect("parse child name DAT");

        assert_eq!(parsed.games[0].name, "Child Named (USA)");
        assert_eq!(parsed.games[0].regions, vec!["USA"]);
    }

    #[test]
    fn preserves_all_rom_lines_and_extra_tags_when_filtering() {
        let xml = r#"<?xml version="1.0"?>
<datafile>
  <header><name>Sony - PlayStation</name></header>
  <game name="Ridge Racer (USA)">
    <category>Games</category>
    <description>Ridge Racer (USA)</description>
    <id>1</id>
    <serial>SCUS-94300</serial>
    <rom name="Ridge Racer (USA).cue" size="10" crc="aaaaaaaa"/>
    <rom name="Ridge Racer (USA).bin" size="100" crc="bbbbbbbb"/>
  </game>
</datafile>"#;
        let parsed = parse_dat(xml).expect("parse multi-rom DAT");
        let result = filter_dat_by_regions(&parsed, &["USA".to_string()], Some("source.dat")).unwrap();

        assert_eq!(parsed.games[0].category.as_deref(), Some("Games"));
        assert!(result.xml.contains("<serial>SCUS-94300</serial>"));
        assert!(result.xml.contains(r#"<rom name="Ridge Racer (USA).cue""#));
        assert!(result.xml.contains(r#"<rom name="Ridge Racer (USA).bin""#));
    }

    #[test]
    fn filters_to_union_of_selected_regions() {
        let parsed = parse_dat(SAMPLE_DAT).unwrap();
        let result = filter_dat_by_regions(
            &parsed,
            &["USA".to_string(), "Japan".to_string()],
            Some("source.dat"),
        )
        .unwrap();

        assert_eq!(result.games.len(), 2);
        assert_eq!(result.games[0].name, "Halo (USA)");
        assert_eq!(result.games[1].name, "Project Gotham Racing 2 (Japan)");
        assert!(result.header.name.contains("(USA, Japan)"));
    }

    fn sample_variant_dat(serial_version: bool) -> String {
        let descriptor = if serial_version {
            "Datfile (serial,version)"
        } else {
            "Datfile"
        };
        let extra_usa = if serial_version {
            "    <serial>SCUS-94300</serial>\n    <version>1.0</version>\n"
        } else {
            ""
        };
        let extra_europe = if serial_version {
            "    <serial>SCES-00005</serial>\n    <version>1.1</version>\n"
        } else {
            ""
        };
        format!(
            r#"<?xml version="1.0"?>
<!DOCTYPE datafile PUBLIC "-//Logiqx//DTD ROM Management Datafile//EN" "http://www.logiqx.com/Dats/datafile.dtd">
<datafile>
  <header>
    <name>Sony - PlayStation</name>
    <description>Sony - PlayStation - {descriptor} (2) (2026-08-15 10-57-09)</description>
    <version>2026-08-15 10-57-09</version>
    <date>2026-08-15</date>
    <author>redump.org</author>
  </header>
  <game name="Ridge Racer (USA)">
    <category>Games</category>
    <description>Ridge Racer (USA)</description>
{extra_usa}    <rom name="Ridge Racer (USA)" size="1" crc="aaaaaaaa"/>
  </game>
  <game name="Tekken (Europe)">
    <category>Games</category>
    <description>Tekken (Europe)</description>
{extra_europe}    <rom name="Tekken (Europe)" size="1" crc="bbbbbbbb"/>
  </game>
</datafile>"#
        )
    }

    #[test]
    fn standard_and_serial_version_dats_share_games_and_keep_variant_tags() {
        let parsed_standard = parse_dat(&sample_variant_dat(false)).expect("parse standard DAT");
        let parsed_serial = parse_dat(&sample_variant_dat(true)).expect("parse serial DAT");

        assert_eq!(parsed_standard.descriptor, "Datfile");
        assert_eq!(parsed_standard.normalized_descriptor, "Datfile");
        assert_eq!(parsed_serial.descriptor, "Datfile (serial,version)");
        assert_eq!(parsed_serial.normalized_descriptor, "Datfile (serial,version)");

        assert_eq!(parsed_standard.games.len(), parsed_serial.games.len());
        for (standard, serial) in parsed_standard.games.iter().zip(&parsed_serial.games) {
            assert_eq!(standard.name, serial.name);
            assert_eq!(standard.regions, serial.regions);
            assert_eq!(standard.category, serial.category);
        }
        assert_eq!(parsed_standard.available_regions, parsed_serial.available_regions);
        assert_eq!(parsed_standard.available_regions, vec!["Europe", "USA"]);

        let standard_filtered = filter_dat_by_regions(
            &parsed_standard,
            &["USA".to_string()],
            Some("Sony - PlayStation - Datfile (2) (2026-08-15 10-57-09).dat"),
        )
        .unwrap();
        let serial_filtered = filter_dat_by_regions(
            &parsed_serial,
            &["USA".to_string()],
            Some("Sony - PlayStation - Datfile (serial,version) (2) (2026-08-15 10-57-09).dat"),
        )
        .unwrap();

        assert_eq!(standard_filtered.games.len(), 1);
        assert_eq!(serial_filtered.games.len(), 1);
        assert_eq!(standard_filtered.games[0].name, serial_filtered.games[0].name);
        assert!(!standard_filtered.xml.contains("<serial>"));
        assert!(!standard_filtered.xml.contains("<version>1.0</version>"));
        assert!(!standard_filtered.filename.contains("serial,version"));
        assert!(standard_filtered.filename.contains("Datfile (1)"));
        assert!(serial_filtered.xml.contains("<serial>SCUS-94300</serial>"));
        assert!(serial_filtered.xml.contains("<version>1.0</version>"));
        assert!(!serial_filtered.xml.contains("Tekken"));
        assert!(serial_filtered.filename.contains("Datfile (serial,version) (1)"));
        assert!(serial_filtered
            .header
            .description
            .as_deref()
            .unwrap_or("")
            .contains("Datfile (serial,version)"));
    }
}
