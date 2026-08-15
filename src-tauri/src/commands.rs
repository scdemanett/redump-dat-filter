use crate::app_updater::{self, UpdaterState};
use crate::dat_parser::{filter_dat_by_regions, parse_dat, ParsedDat};
use crate::redump_download;
use crate::settings;
use crate::types::{
  AppSettings, AppUpdateStatus, CheckUpdatesResponse, CurrentDatResponse, DatVariant,
  DownloadExtraResponse, DownloadSystemResponse, FilterPreviewResponse, GetSettingsResponse,
  ListSystemsResponse, LoadFromPathResponse, LoadedDatPayload, OpenDatResponse, SaveFilterResponse,
};
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

pub struct LoadedDat {
  pub source_path: String,
  pub original_filename: String,
  pub parsed: ParsedDat,
}

pub struct LoadedDatState(pub Mutex<Option<LoadedDat>>);

fn build_loaded_payload(state: &LoadedDat) -> LoadedDatPayload {
  LoadedDatPayload {
    file_path: state.source_path.clone(),
    original_filename: state.original_filename.clone(),
    header: state.parsed.header.clone(),
    regions: state.parsed.available_regions.clone(),
    total_games: state.parsed.games.len(),
    descriptor: state.parsed.descriptor.clone(),
    normalized_descriptor: state.parsed.normalized_descriptor.clone(),
    version_label: state.parsed.version_label.clone(),
  }
}

fn load_state_from_file(file_path: &str) -> Result<LoadedDat, String> {
  let xml = std::fs::read_to_string(file_path)
    .map_err(|e| format!("Failed to read DAT file: {e}"))?;
  let parsed = parse_dat(&xml)?;
  let original_filename = Path::new(file_path)
    .file_name()
    .and_then(|s| s.to_str())
    .unwrap_or("data.dat")
    .to_string();
  Ok(LoadedDat {
    source_path: file_path.to_string(),
    original_filename,
    parsed,
  })
}

#[tauri::command]
pub fn ping() -> String {
  "pong".into()
}

#[tauri::command]
pub async fn open_dat(
  app: AppHandle,
  state: State<'_, LoadedDatState>,
) -> Result<OpenDatResponse, String> {
  let file_path = app
    .dialog()
    .file()
    .set_title("Select Redump DAT file")
    .add_filter("Redump DAT", &["dat", "xml"])
    .blocking_pick_file();

  let Some(FilePath::Path(path)) = file_path else {
    return Ok(OpenDatResponse {
      canceled: true,
      error: None,
      data: None,
    });
  };

  let path_str = path.to_string_lossy().to_string();
  match load_state_from_file(&path_str) {
    Ok(loaded) => {
      let data = build_loaded_payload(&loaded);
      *state.0.lock().map_err(|e| e.to_string())? = Some(loaded);
      Ok(OpenDatResponse {
        canceled: false,
        error: None,
        data: Some(data),
      })
    }
    Err(error) => Ok(OpenDatResponse {
      canceled: false,
      error: Some(error),
      data: None,
    }),
  }
}

#[tauri::command]
pub fn load_from_path(
  state: State<'_, LoadedDatState>,
  file_path: String,
) -> LoadFromPathResponse {
  if file_path.trim().is_empty() {
    return LoadFromPathResponse {
      success: false,
      error: Some("No file path provided.".into()),
      data: None,
    };
  }

  match load_state_from_file(&file_path) {
    Ok(loaded) => {
      let data = build_loaded_payload(&loaded);
      match state.0.lock() {
        Ok(mut guard) => {
          *guard = Some(loaded);
          LoadFromPathResponse {
            success: true,
            error: None,
            data: Some(data),
          }
        }
        Err(e) => LoadFromPathResponse {
          success: false,
          error: Some(e.to_string()),
          data: None,
        },
      }
    }
    Err(error) => LoadFromPathResponse {
      success: false,
      error: Some(error),
      data: None,
    },
  }
}

#[tauri::command]
pub fn get_current(state: State<'_, LoadedDatState>) -> CurrentDatResponse {
  match state.0.lock() {
    Ok(guard) => match guard.as_ref() {
      Some(loaded) => CurrentDatResponse {
        loaded: true,
        data: Some(build_loaded_payload(loaded)),
      },
      None => CurrentDatResponse {
        loaded: false,
        data: None,
      },
    },
    Err(_) => CurrentDatResponse {
      loaded: false,
      data: None,
    },
  }
}

#[tauri::command]
pub fn preview_filter(
  state: State<'_, LoadedDatState>,
  regions: Vec<String>,
) -> FilterPreviewResponse {
  let guard = match state.0.lock() {
    Ok(g) => g,
    Err(e) => {
      return FilterPreviewResponse {
        success: false,
        error: Some(e.to_string()),
        header: None,
        summary: None,
        filename: None,
      }
    }
  };

  let Some(loaded) = guard.as_ref() else {
    return FilterPreviewResponse {
      success: false,
      error: Some("No DAT file loaded.".into()),
      header: None,
      summary: None,
      filename: None,
    };
  };

  match filter_dat_by_regions(&loaded.parsed, &regions, Some(&loaded.original_filename)) {
    Ok(result) => FilterPreviewResponse {
      success: true,
      error: None,
      header: Some(result.header),
      summary: Some(result.summary),
      filename: Some(result.filename),
    },
    Err(error) => FilterPreviewResponse {
      success: false,
      error: Some(error),
      header: None,
      summary: None,
      filename: None,
    },
  }
}

#[tauri::command]
pub async fn save_filtered(
  app: AppHandle,
  state: State<'_, LoadedDatState>,
  regions: Vec<String>,
  target_path: Option<String>,
) -> Result<SaveFilterResponse, String> {
  let (xml, filename, header, summary, fallback_dir) = {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let Some(loaded) = guard.as_ref() else {
      return Ok(SaveFilterResponse {
        success: false,
        canceled: None,
        error: Some("No DAT file loaded.".into()),
        saved_path: None,
        header: None,
        summary: None,
        filename: None,
      });
    };

    let result = match filter_dat_by_regions(&loaded.parsed, &regions, Some(&loaded.original_filename))
    {
      Ok(r) => r,
      Err(error) => {
        return Ok(SaveFilterResponse {
          success: false,
          canceled: None,
          error: Some(error),
          saved_path: None,
          header: None,
          summary: None,
          filename: None,
        });
      }
    };

    let fallback_dir = Path::new(&loaded.source_path)
      .parent()
      .map(|p| p.to_path_buf());

    (
      result.xml,
      result.filename,
      result.header,
      result.summary,
      fallback_dir,
    )
  };

  let default_dir = settings::resolve_save_directory(&app, fallback_dir);

  let final_path = if let Some(path) = target_path.filter(|p| !p.trim().is_empty()) {
    path
  } else {
    let mut dialog = app
      .dialog()
      .file()
      .set_title("Save filtered DAT file")
      .add_filter("Redump DAT", &["dat", "xml"])
      .set_file_name(&filename);

    if let Some(dir) = default_dir {
      dialog = dialog.set_directory(dir);
    }

    let Some(FilePath::Path(path)) = dialog.blocking_save_file() else {
      return Ok(SaveFilterResponse {
        success: false,
        canceled: Some(true),
        error: None,
        saved_path: None,
        header: None,
        summary: None,
        filename: None,
      });
    };
    path.to_string_lossy().to_string()
  };

  if let Err(error) = std::fs::write(&final_path, xml.as_bytes()) {
    return Ok(SaveFilterResponse {
      success: false,
      canceled: None,
      error: Some(format!("Failed to save filtered DAT file: {error}")),
      saved_path: None,
      header: None,
      summary: None,
      filename: None,
    });
  }

  let saved_name = Path::new(&final_path)
    .file_name()
    .and_then(|s| s.to_str())
    .unwrap_or(&filename)
    .to_string();

  settings::remember_save_directory(&app, &final_path);

  Ok(SaveFilterResponse {
    success: true,
    canceled: None,
    error: None,
    saved_path: Some(final_path),
    header: Some(header),
    summary: Some(summary),
    filename: Some(saved_name),
  })
}

#[tauri::command]
pub async fn get_settings(app: AppHandle) -> GetSettingsResponse {
  let (settings, from_file) = settings::load_settings(&app);
  GetSettingsResponse { settings, from_file }
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
  crate::settings::save_settings(&app, &settings)
}

#[tauri::command]
pub async fn list_systems(app: AppHandle) -> ListSystemsResponse {
  match redump_download::get_system_list(&app, false).await {
    Ok(result) => ListSystemsResponse {
      success: true,
      error: None,
      systems: Some(result.systems),
      source: Some(result.source),
      fetched_at: result.fetched_at,
    },
    Err(error) => ListSystemsResponse {
      success: false,
      error: Some(error),
      systems: None,
      source: None,
      fetched_at: None,
    },
  }
}

#[tauri::command]
pub async fn refresh_systems(app: AppHandle) -> ListSystemsResponse {
  match redump_download::refresh_system_list(&app).await {
    Ok(result) => ListSystemsResponse {
      success: true,
      error: None,
      systems: Some(result.systems),
      source: Some(result.source),
      fetched_at: result.fetched_at,
    },
    Err(error) => {
      if let Ok(fallback) = redump_download::get_system_list(&app, false).await {
        ListSystemsResponse {
          success: false,
          error: Some(error),
          systems: Some(fallback.systems),
          source: Some(fallback.source),
          fetched_at: fallback.fetched_at,
        }
      } else {
        ListSystemsResponse {
          success: false,
          error: Some(error),
          systems: None,
          source: None,
          fetched_at: None,
        }
      }
    }
  }
}

#[tauri::command]
pub async fn check_updates(app: AppHandle, force: Option<bool>) -> CheckUpdatesResponse {
  match redump_download::check_downloaded_updates(&app, force.unwrap_or(false)).await {
    Ok(result) => {
      let (settings, _) = settings::load_settings(&app);
      let update_count = result
        .systems
        .iter()
        .filter(|system| {
          system.update_available.unwrap_or(false)
            && settings::allows_system_slug(&settings, &system.slug)
        })
        .count();
      CheckUpdatesResponse {
        success: true,
        error: None,
        systems: Some(result.systems),
        source: Some(result.source),
        fetched_at: result.fetched_at,
        update_count: Some(update_count),
      }
    }
    Err(error) => CheckUpdatesResponse {
      success: false,
      error: Some(error),
      systems: None,
      source: None,
      fetched_at: None,
      update_count: None,
    },
  }
}

#[tauri::command]
pub async fn download_system(
  app: AppHandle,
  state: State<'_, LoadedDatState>,
  slug: String,
  force: Option<bool>,
  serial_version: Option<bool>,
) -> Result<DownloadSystemResponse, String> {
  if slug.trim().is_empty() {
    return Ok(DownloadSystemResponse {
      success: false,
      error: Some("No system selected.".into()),
      data: None,
      from_cache: None,
    });
  }

  let variant = serial_version
    .map(DatVariant::from_serial_flag)
    .unwrap_or_else(|| {
      let (loaded, _) = settings::load_settings(&app);
      settings::resolve_dat_variant(&loaded, slug.trim())
    });

  Ok(
    match redump_download::download_or_load_system(&app, &slug, force.unwrap_or(false), variant).await {
      Ok(downloaded) => match parse_dat(&downloaded.xml) {
        Ok(parsed) => {
          let loaded = LoadedDat {
            source_path: downloaded.source_path,
            original_filename: downloaded.original_filename,
            parsed,
          };
          let data = build_loaded_payload(&loaded);
          match state.0.lock() {
            Ok(mut guard) => {
              *guard = Some(loaded);
              DownloadSystemResponse {
                success: true,
                error: None,
                data: Some(data),
                from_cache: Some(downloaded.from_cache),
              }
            }
            Err(e) => DownloadSystemResponse {
              success: false,
              error: Some(e.to_string()),
              data: None,
              from_cache: None,
            },
          }
        }
        Err(error) => DownloadSystemResponse {
          success: false,
          error: Some(error),
          data: None,
          from_cache: None,
        },
      },
      Err(error) => DownloadSystemResponse {
        success: false,
        error: Some(error),
        data: None,
        from_cache: None,
      },
    },
  )
}

#[tauri::command]
pub async fn download_extra(
  app: AppHandle,
  slug: String,
  kind: String,
) -> Result<DownloadExtraResponse, String> {
  let Some(extra_kind) = redump_download::ExtraKind::from_label(&kind) else {
    return Ok(DownloadExtraResponse {
      success: false,
      canceled: None,
      error: Some("Unknown extra download type.".into()),
      saved_path: None,
      filename: None,
    });
  };

  if slug.trim().is_empty() {
    return Ok(DownloadExtraResponse {
      success: false,
      canceled: None,
      error: Some("No system selected.".into()),
      saved_path: None,
      filename: None,
    });
  }

  let downloaded = match redump_download::download_extra(&app, &slug, extra_kind).await {
    Ok(result) => result,
    Err(error) => {
      return Ok(DownloadExtraResponse {
        success: false,
        canceled: None,
        error: Some(error),
        saved_path: None,
        filename: None,
      });
    }
  };

  let default_dir = settings::resolve_save_directory(&app, None);
  let title = match extra_kind {
    redump_download::ExtraKind::Cues => "Save cuesheets",
    redump_download::ExtraKind::Sbi => "Save SBI archive",
  };
  let mut dialog = app
    .dialog()
    .file()
    .set_title(title)
    .add_filter("ZIP archive", &["zip"])
    .set_file_name(&downloaded.filename);

  if let Some(dir) = default_dir {
    dialog = dialog.set_directory(dir);
  }

  let Some(FilePath::Path(path)) = dialog.blocking_save_file() else {
    return Ok(DownloadExtraResponse {
      success: false,
      canceled: Some(true),
      error: None,
      saved_path: None,
      filename: None,
    });
  };

  let final_path = path.to_string_lossy().to_string();
  if let Err(error) = std::fs::write(&final_path, &downloaded.bytes) {
    return Ok(DownloadExtraResponse {
      success: false,
      canceled: None,
      error: Some(format!("Failed to save {}: {error}", downloaded.filename)),
      saved_path: None,
      filename: None,
    });
  }

  settings::remember_save_directory(&app, &final_path);
  let saved_name = Path::new(&final_path)
    .file_name()
    .and_then(|s| s.to_str())
    .unwrap_or(&downloaded.filename)
    .to_string();

  Ok(DownloadExtraResponse {
    success: true,
    canceled: None,
    error: None,
    saved_path: Some(final_path),
    filename: Some(saved_name),
  })
}

#[tauri::command]
pub fn get_app_version(app: AppHandle) -> String {
  app.package_info().version.to_string()
}

#[tauri::command]
pub fn get_app_update_status(updater: State<'_, UpdaterState>) -> AppUpdateStatus {
  app_updater::get_last_status(&updater)
}

#[tauri::command]
pub async fn check_for_updates(
  app: AppHandle,
  updater: State<'_, UpdaterState>,
  manual: Option<bool>,
) -> Result<AppUpdateStatus, String> {
  Ok(app_updater::check_for_app_updates(&app, &updater, manual.unwrap_or(true)).await)
}

#[tauri::command]
pub async fn download_update(
  app: AppHandle,
  updater: State<'_, UpdaterState>,
) -> Result<AppUpdateStatus, String> {
  Ok(app_updater::download_app_update(&app, &updater).await)
}

#[tauri::command]
pub async fn install_update(
  app: AppHandle,
  updater: State<'_, UpdaterState>,
) -> Result<AppUpdateStatus, String> {
  Ok(app_updater::install_app_update(&app, &updater).await)
}
