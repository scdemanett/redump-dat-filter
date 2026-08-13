// IPC response / request types matching src/shared/ipcTypes.ts.
// Depends on: serde (already in Cargo.toml), and crate::dat_parser::{DatHeader, FilterSummary}.

use crate::dat_parser::{DatHeader, FilterSummary};
use serde::{Deserialize, Serialize};

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
    use super::AppUpdateStatus;

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
}
