# Changelog

All notable changes to this project are documented here.

## [2.0.1] - 2026-08-13

### Fixed

- Title-case the Redump panel **Check Updates** button label.

## [2.0.0] - 2026-08-13

First stable Tauri 2 release. Replaces the Electron 1.x desktop shell.

### Changed

- Desktop backend is now Rust/Tauri 2 (DAT parse/filter, Redump download/cache, dialogs, window state, signed updates).
- Packaging uses `tauri build` / GitHub Actions instead of `electron-builder`.
- Installed builds update in-app via signed `latest.json`; portable zips open the GitHub release page.
- NSIS finish page leaves **Create desktop shortcut** unchecked by default.

### Added

- Drag-and-drop DAT loading via Tauri `onDragDropEvent`.
- One-time migration of Electron `userData/cache` into the Tauri app data cache when empty.
- Portable zips: `redump-dat-filter-unpacked-{VERSION}-{OS}-{ARCH}.zip`.

### Fixed

- App update status IPC uses camelCase fields (version labels and Download Update / View Release).
- Portable zip packaging for explicit macOS `--target` builds.
- Linux unused-variable warnings in install/portable detection.

### Breaking

- Electron 1.x installers and `electron-updater` (`latest*.yml` / blockmaps) are not used. Install 2.0.0 from GitHub Releases; later updates use the Tauri updater.
- Cache path identifier is now `com.redump.filter`; Electron caches are copied on first launch when possible.

## [1.9.1] - 2026-08-13

Updater E2E follow-up on the 1.9.0 Tauri baseline.

### Fixed

- App update status IPC now serializes camelCase fields so the UI shows the current version instead of `vundefined`.
- Portable zip packaging looks under `target/<triple>/release` when `--target` is set (macOS CI).
- Linux build warning for unused `dir` in portable/install detection.
- NSIS finish page leaves **Create desktop shortcut** unchecked by default.

### Changed

- Bumped Rust deps: `tauri` 2.11.5, `zip` 8.6, `uuid` 1.24; MSRV 1.88.

## [1.9.0] - 2026-08-13

Tauri migration baseline for signed updater E2E testing (pre-2.0.0).

### Changed

- Replaced Electron main/preload with a Rust Tauri 2 backend that owns DAT parse/filter, Redump download/cache, dialogs, window state, and signed updates.
- React UI talks to the backend through `@tauri-apps/api` `invoke`/`listen` instead of Electron preload IPC.
- Packaging and CI use `tauri build` / `tauri-apps/tauri-action` instead of `electron-builder`.
- Installed builds use the Tauri updater (`latest.json` + minisign); portable zips open the GitHub release page for updates.

### Added

- Drag-and-drop DAT loading via Tauri `onDragDropEvent`.
- One-time migration of Electron `userData/cache` into the Tauri app data cache when empty.
- Portable zips: `redump-dat-filter-unpacked-{VERSION}-{OS}-{ARCH}.zip`.
- Window launch restores remembered size/position while hidden to avoid the small/white flicker.

### Breaking

- Electron 1.x installers and `electron-updater` metadata (`latest*.yml` / blockmaps) are not used by Tauri builds.
- Cache path identifier is now `com.redump.filter`; Electron caches are copied on first launch when possible.

## [1.0.0] - 2026-08-10

First stable release of Redump DAT Filter.

### Added

- Desktop app for filtering Redump DAT files by region with live preview and rewritten header metadata.
- Redump download integration with cached system list, update badges, and offline bundled fallback.
- GitHub Releases packaging for Windows, macOS, and Linux (installers and portable zips).
- In-app update checks with NSIS/AppImage/macOS in-app install support and portable release-page fallback.
- CI workflow for typecheck, tests, and build on pull requests and main.

### Fixed

- Portable update checks no longer hang on `electron-updater`.
- NSIS installs correctly enable in-app download/update detection.
- Release publishing uses `gh` CLI and publishes drafts after upload.

## [0.3.4] - 2026-08-10

- Test release for in-app auto-update from 0.3.3.

## [0.3.3] - 2026-08-10

- Fix NSIS auto-update detection for installed Windows builds.
- Add dismiss control for app update status banner.

## [0.3.2] - 2026-08-10

- Fix portable app update checks via GitHub Releases API.

## [0.3.1] - 2026-08-10

- Follow-up release for update-check fix validation.

## [0.3.0] - 2026-08-10

- Add GitHub Actions multi-platform release workflow.
- Add app update checker and portable zip artifacts.

## [0.2.0] - 2026-08-09

- Add live Redump DAT download with cached system picker.
- Polish desktop shell with Redump theming and window state persistence.

[2.0.1]: https://github.com/scdemanett/redump-dat-filter/releases/tag/v2.0.1
[2.0.0]: https://github.com/scdemanett/redump-dat-filter/releases/tag/v2.0.0
[1.9.1]: https://github.com/scdemanett/redump-dat-filter/releases/tag/v1.9.1
[1.9.0]: https://github.com/scdemanett/redump-dat-filter/releases/tag/v1.9.0
[1.0.0]: https://github.com/scdemanett/redump-dat-filter/releases/tag/v1.0.0
[0.3.4]: https://github.com/scdemanett/redump-dat-filter/releases/tag/v0.3.4
[0.3.3]: https://github.com/scdemanett/redump-dat-filter/releases/tag/v0.3.3
[0.3.2]: https://github.com/scdemanett/redump-dat-filter/releases/tag/v0.3.2
[0.3.1]: https://github.com/scdemanett/redump-dat-filter/releases/tag/v0.3.1
[0.3.0]: https://github.com/scdemanett/redump-dat-filter/releases/tag/v0.3.0
[0.2.0]: https://github.com/scdemanett/redump-dat-filter/releases/tag/v0.2.0
