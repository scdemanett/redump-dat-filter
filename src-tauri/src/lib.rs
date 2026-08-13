mod app_updater;
mod commands;
mod dat_parser;
mod redump_download;
mod types;

use commands::LoadedDatState;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    // Persist size/position/maximized, but never VISIBLE — otherwise a hidden
    // first-run (`visible: false` in tauri.conf) can be remembered and the app
    // launches invisible (tauri#5170). Restore geometry while hidden, then show.
    .plugin(
      tauri_plugin_window_state::Builder::new()
        .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE & !StateFlags::FULLSCREEN)
        .build(),
    )
    .manage(LoadedDatState(Mutex::new(None)))
    .manage(app_updater::UpdaterState::default())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      redump_download::migrate_electron_cache_if_needed(app.handle());
      redump_download::maybe_refresh_system_list_in_background(app.handle().clone());
      app_updater::init_app_updater(app.handle().clone());

      // Window starts `visible: false` so window-state can restore bounds before
      // the first paint (avoids the small/white → resize flicker).
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::ping,
      commands::open_dat,
      commands::load_from_path,
      commands::get_current,
      commands::preview_filter,
      commands::save_filtered,
      commands::list_systems,
      commands::refresh_systems,
      commands::check_updates,
      commands::download_system,
      commands::get_app_version,
      commands::get_app_update_status,
      commands::check_for_updates,
      commands::download_update,
      commands::install_update,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
