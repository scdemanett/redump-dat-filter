// IPC response / request types matching src/shared/ipcTypes.ts.
// Depends on: serde (already in Cargo.toml), and crate::dat_parser::{DatHeader, FilterSummary}.

use crate::dat_parser::{DatHeader, FilterSummary};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedDatPayload {
    pub file_path: String,
    pub original_filename: String,
    pub header: DatHeader,
    pub regions: Vec<String>,
    pub total_games: usize,
    pub descriptor: String,
    pub normalized_descriptor: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDatResponse {
    pub canceled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<LoadedDatPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadFromPathResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<LoadedDatPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentDatResponse {
    pub loaded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<LoadedDatPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterPreviewResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header: Option<DatHeader>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<FilterSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
}

fn default_regions() -> Vec<String> {
    vec!["USA".into(), "World".into()]
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DatVariant {
    Standard,
    Serial,
}

impl DatVariant {
    pub fn from_serial_flag(serial: bool) -> Self {
        if serial {
            Self::Serial
        } else {
            Self::Standard
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_regions")]
    pub default_regions: Vec<String>,
    #[serde(default)]
    pub default_save_dir: Option<String>,
    #[serde(default = "default_true")]
    pub show_all_systems: bool,
    #[serde(default)]
    pub visible_system_slugs: Vec<String>,
    #[serde(default)]
    pub prefer_serial_version: bool,
    #[serde(default)]
    pub system_dat_variants: BTreeMap<String, DatVariant>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            default_regions: default_regions(),
            default_save_dir: None,
            show_all_systems: true,
            visible_system_slugs: Vec::new(),
            prefer_serial_version: false,
            system_dat_variants: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSettingsResponse {
    pub settings: AppSettings,
    pub from_file: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFilterResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canceled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saved_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header: Option<DatHeader>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<FilterSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RedumpSystemListSource {
    Live,
    Cache,
    Bundled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedumpSystem {
    pub name: String,
    pub slug: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloaded: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_available: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cached_filename: Option<String>,
    #[serde(default)]
    pub has_serial_version: bool,
    #[serde(default)]
    pub has_cues: bool,
    #[serde(default)]
    pub has_sbi: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSystemsResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub systems: Option<Vec<RedumpSystem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<RedumpSystemListSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetched_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckUpdatesResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub systems: Option<Vec<RedumpSystem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<RedumpSystemListSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetched_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSystemResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<LoadedDatPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_cache: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadExtraResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canceled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saved_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
}

/// Matches the TypeScript `AppUpdateStatus` discriminated union (`state` tag).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum AppUpdateStatus {
    #[serde(rename_all = "camelCase")]
    Idle {
        #[serde(skip_serializing_if = "Option::is_none")]
        current_version: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Disabled { reason: String },
    Checking,
    #[serde(rename_all = "camelCase")]
    Unavailable { current_version: String },
    #[serde(rename_all = "camelCase")]
    Available {
        current_version: String,
        latest_version: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        release_notes: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        release_url: Option<String>,
        auto_install_supported: bool,
    },
    #[serde(rename_all = "camelCase")]
    Downloading { percent: f64 },
    #[serde(rename_all = "camelCase")]
    Downloaded {
        latest_version: String,
        auto_install_supported: bool,
    },
    #[serde(rename_all = "camelCase")]
    Error { message: String },
}

#[cfg(test)]
mod tests {
    use super::{AppSettings, AppUpdateStatus, DatVariant};
    use std::collections::BTreeMap;

    #[test]
    fn app_update_status_serializes_camel_case_fields() {
        let status = AppUpdateStatus::Unavailable {
            current_version: "1.9.0".into(),
        };
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["state"], "unavailable");
        assert_eq!(json["currentVersion"], "1.9.0");
        assert!(json.get("current_version").is_none());

        let available = AppUpdateStatus::Available {
            current_version: "1.9.0".into(),
            latest_version: "1.9.1".into(),
            release_notes: None,
            release_url: None,
            auto_install_supported: true,
        };
        let json = serde_json::to_value(&available).unwrap();
        assert_eq!(json["latestVersion"], "1.9.1");
        assert_eq!(json["autoInstallSupported"], true);
    }

    #[test]
    fn app_settings_serializes_camel_case_fields() {
        let settings = AppSettings {
            default_regions: vec!["USA".into(), "World".into()],
            default_save_dir: Some(r"D:\DATs\filtered".into()),
            show_all_systems: false,
            visible_system_slugs: vec!["psx".into()],
            prefer_serial_version: true,
            system_dat_variants: BTreeMap::from([("psx".into(), DatVariant::Serial)]),
        };
        let json = serde_json::to_value(&settings).unwrap();
        assert_eq!(json["defaultRegions"][0], "USA");
        assert_eq!(json["defaultSaveDir"], r"D:\DATs\filtered");
        assert_eq!(json["showAllSystems"], false);
        assert_eq!(json["visibleSystemSlugs"][0], "psx");
        assert_eq!(json["preferSerialVersion"], true);
        assert_eq!(json["systemDatVariants"]["psx"], "serial");
        assert!(json.get("default_save_dir").is_none());
    }
}
