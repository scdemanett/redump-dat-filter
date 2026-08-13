use crate::types::AppUpdateStatus;
use serde::Deserialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

const GITHUB_REPO: &str = "scdemanett/redump-dat-filter";
const GITHUB_RELEASES_URL: &str = "https://github.com/scdemanett/redump-dat-filter/releases/latest";
const UPDATE_CHECK_TIMEOUT_MS: u64 = 15_000;

pub struct UpdaterState {
  pub last_status: Mutex<AppUpdateStatus>,
}

impl Default for UpdaterState {
  fn default() -> Self {
    Self {
      last_status: Mutex::new(AppUpdateStatus::Idle {
        current_version: None,
      }),
    }
  }
}

fn set_status(app: &AppHandle, state: &UpdaterState, status: AppUpdateStatus) {
  if let Ok(mut guard) = state.last_status.lock() {
    *guard = status.clone();
  }
  let _ = app.emit("app:update-status", status);
}

pub fn get_last_status(state: &UpdaterState) -> AppUpdateStatus {
  state
    .last_status
    .lock()
    .map(|g| g.clone())
    .unwrap_or(AppUpdateStatus::Idle {
      current_version: None,
    })
}

fn is_newer_version(latest: &str, current: &str) -> bool {
  let parse = |value: &str| -> Vec<u32> {
    value
      .trim_start_matches(|c: char| c == 'v' || c == 'V')
      .split('.')
      .map(|part| part.parse::<u32>().unwrap_or(0))
      .collect()
  };
  let latest_parts = parse(latest);
  let current_parts = parse(current);
  let len = latest_parts.len().max(current_parts.len());
  for i in 0..len {
    let l = latest_parts.get(i).copied().unwrap_or(0);
    let c = current_parts.get(i).copied().unwrap_or(0);
    if l != c {
      return l > c;
    }
  }
  false
}

fn supports_auto_install(_app: &AppHandle) -> bool {
  // Dev builds never auto-install. Packaged installers can; portable zips open GitHub Releases.
  if cfg!(debug_assertions) {
    return false;
  }

  let Ok(exe) = std::env::current_exe() else {
    return false;
  };
  let Some(dir) = exe.parent() else {
    return false;
  };

  #[cfg(target_os = "windows")]
  {
    // Tauri/Electron NSIS installs ship an uninstaller next to the binary.
    // Portable zips are just the exe, so they fall back to the release page.
    match std::fs::read_dir(dir) {
      Ok(entries) => entries.flatten().any(|entry| {
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        name == "uninstall.exe" || (name.starts_with("uninstall ") && name.ends_with(".exe"))
      }),
      Err(_) => false,
    }
  }

  #[cfg(target_os = "linux")]
  {
    // In-app install is supported for AppImage launches.
    std::env::var_os("APPIMAGE").is_some()
  }

  #[cfg(target_os = "macos")]
  {
    exe
      .to_string_lossy()
      .contains(&format!("{}Applications{}", std::path::MAIN_SEPARATOR, std::path::MAIN_SEPARATOR))
  }

  #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
  {
    let _ = dir;
    false
  }
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
  tag_name: Option<String>,
  html_url: Option<String>,
  body: Option<String>,
}

async fn check_via_github_api(app: &AppHandle) -> AppUpdateStatus {
  let current_version = app.package_info().version.to_string();
  let auto_install_supported = supports_auto_install(app);

  let client = match reqwest::Client::builder()
    .user_agent(format!("RedumpDATFilter/{current_version}"))
    .timeout(std::time::Duration::from_millis(UPDATE_CHECK_TIMEOUT_MS))
    .build()
  {
    Ok(c) => c,
    Err(e) => {
      return AppUpdateStatus::Error {
        message: e.to_string(),
      }
    }
  };

  let url = format!("https://api.github.com/repos/{GITHUB_REPO}/releases/latest");
  let response = match client
    .get(&url)
    .header("Accept", "application/vnd.github+json")
    .send()
    .await
  {
    Ok(r) => r,
    Err(e) => {
      return AppUpdateStatus::Error {
        message: e.to_string(),
      }
    }
  };

  if !response.status().is_success() {
    return AppUpdateStatus::Error {
      message: format!("GitHub API responded with {}", response.status()),
    };
  }

  let payload: GitHubRelease = match response.json().await {
    Ok(p) => p,
    Err(e) => {
      return AppUpdateStatus::Error {
        message: e.to_string(),
      }
    }
  };

  let latest_version = payload
    .tag_name
    .unwrap_or_default()
    .trim_start_matches(|c: char| c == 'v' || c == 'V')
    .to_string();

  if latest_version.is_empty() {
    return AppUpdateStatus::Error {
      message: "Latest release is missing a version tag.".into(),
    };
  }

  if is_newer_version(&latest_version, &current_version) {
    AppUpdateStatus::Available {
      current_version,
      latest_version,
      release_notes: payload
        .body
        .map(|b| b.trim().to_string())
        .filter(|s| !s.is_empty()),
      release_url: Some(
        payload
          .html_url
          .unwrap_or_else(|| GITHUB_RELEASES_URL.to_string()),
      ),
      auto_install_supported,
    }
  } else {
    AppUpdateStatus::Unavailable { current_version }
  }
}

pub fn init_app_updater(app: AppHandle) {
  let state = app.state::<UpdaterState>();
  if cfg!(debug_assertions) {
    set_status(
      &app,
      &state,
      AppUpdateStatus::Disabled {
        reason: "Updates are checked in packaged builds only.".into(),
      },
    );
    return;
  }

  set_status(
    &app,
    &state,
    AppUpdateStatus::Idle {
      current_version: Some(app.package_info().version.to_string()),
    },
  );

  let app_clone = app.clone();
  tauri::async_runtime::spawn(async move {
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    let state = app_clone.state::<UpdaterState>();
    let _ = check_for_app_updates(&app_clone, &state, false).await;
  });
}

pub async fn check_for_app_updates(
  app: &AppHandle,
  state: &UpdaterState,
  manual: bool,
) -> AppUpdateStatus {
  let current_version = app.package_info().version.to_string();

  if cfg!(debug_assertions) {
    let status = AppUpdateStatus::Disabled {
      reason: "Updates are checked in packaged builds only.".into(),
    };
    if manual {
      set_status(app, state, status.clone());
    }
    return status;
  }

  if manual {
    set_status(app, state, AppUpdateStatus::Checking);
  }

  let status = check_via_github_api(app).await;

  match &status {
    AppUpdateStatus::Unavailable { .. } => {
      let resolved = AppUpdateStatus::Unavailable { current_version };
      if manual {
        set_status(app, state, resolved.clone());
      }
      resolved
    }
    AppUpdateStatus::Available { .. } => {
      set_status(app, state, status.clone());
      status
    }
    other => {
      if manual {
        set_status(app, state, other.clone());
      }
      other.clone()
    }
  }
}

pub async fn download_app_update(app: &AppHandle, state: &UpdaterState) -> AppUpdateStatus {
  let last = get_last_status(state);
  let AppUpdateStatus::Available {
    release_url,
    auto_install_supported,
    latest_version,
    ..
  } = last.clone()
  else {
    return last;
  };

  if !auto_install_supported {
    let url = release_url.unwrap_or_else(|| GITHUB_RELEASES_URL.to_string());
    let _ = app.opener().open_url(url, None::<&str>);
    return get_last_status(state);
  }

  set_status(app, state, AppUpdateStatus::Downloading { percent: 0.0 });

  match app.updater() {
    Ok(updater) => match updater.check().await {
      Ok(Some(update)) => {
        let mut downloaded = 0u64;
        let result = update
          .download_and_install(
            |chunk_len, content_len| {
              downloaded += chunk_len as u64;
              if let Some(total) = content_len {
                if total > 0 {
                  let percent = (downloaded as f64 / total as f64) * 100.0;
                  set_status(app, state, AppUpdateStatus::Downloading { percent });
                }
              }
            },
            || {},
          )
          .await;

        match result {
          Ok(()) => {
            let status = AppUpdateStatus::Downloaded {
              latest_version,
              auto_install_supported: true,
            };
            set_status(app, state, status.clone());
            status
          }
          Err(e) => {
            let status = AppUpdateStatus::Error {
              message: e.to_string(),
            };
            set_status(app, state, status.clone());
            status
          }
        }
      }
      Ok(None) => {
        let status = AppUpdateStatus::Error {
          message: "No in-app update is available for this install.".into(),
        };
        set_status(app, state, status.clone());
        status
      }
      Err(e) => {
        let status = AppUpdateStatus::Error {
          message: e.to_string(),
        };
        set_status(app, state, status.clone());
        status
      }
    },
    Err(e) => {
      let status = AppUpdateStatus::Error {
        message: e.to_string(),
      };
      set_status(app, state, status.clone());
      status
    }
  }
}

pub async fn install_app_update(app: &AppHandle, state: &UpdaterState) -> AppUpdateStatus {
  let last = get_last_status(state);
  if !matches!(
    last,
    AppUpdateStatus::Downloaded {
      auto_install_supported: true,
      ..
    }
  ) {
    return last;
  }

  app.restart();
}
