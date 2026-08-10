# Changelog

All notable changes to this project are documented here.

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

[1.0.0]: https://github.com/scdemanett/redump-dat-filter/releases/tag/v1.0.0
[0.3.4]: https://github.com/scdemanett/redump-dat-filter/releases/tag/v0.3.4
[0.3.3]: https://github.com/scdemanett/redump-dat-filter/releases/tag/v0.3.3
[0.3.2]: https://github.com/scdemanett/redump-dat-filter/releases/tag/v0.3.2
[0.3.1]: https://github.com/scdemanett/redump-dat-filter/releases/tag/v0.3.1
[0.3.0]: https://github.com/scdemanett/redump-dat-filter/releases/tag/v0.3.0
[0.2.0]: https://github.com/scdemanett/redump-dat-filter/releases/tag/v0.2.0
