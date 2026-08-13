# Redump DAT Filter

Cross-platform Tauri desktop application for trimming Redump.org DAT collections by region and exporting an updated DAT with rewritten metadata.

## Features

- Download the latest Redump DAT for a system directly from [redump.info](https://redump.info/downloads) (no manual browser download required).
- Live system list with disk cache and manual refresh so new Redump systems appear without an app update.
- Cheap update badges for previously downloaded DATs via HTTP HEAD checks.
- Parse large Redump DAT (XML) files entirely in the Rust backend.
- Automatically detect available regions and offer quick-select checkboxes.
- Live preview of filtered totals, renamed header/description, and suggested output filename.
- Exports a fully formatted DAT with updated `<header>` values and reduced `<game>` entries.
- Drag-and-drop local `.dat` / `.xml` files onto the window to load them.
- Built with Tauri 2 + React + TypeScript for Windows/macOS/Linux.

## Project Structure

```
src-tauri/          # Rust backend (commands, DAT parser, Redump download)
src/renderer/       # React UI
src/shared/         # Shared IPC TypeScript types + legacy parser tests
build/              # Packaging assets and icons
```

## Getting Started

Requirements:

- Node.js 22+
- Rust stable (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))

```bash
npm install
npm run dev
```

The development script starts Vite for the renderer and launches the Tauri window with hot reload.

## Usage

### Download from Redump

1. In **Download from Redump**, search/select a system. Selection alone does not download.
2. Click **Download & load** (or **Load** / **Download update** when a cached DAT exists).
3. The app HEADs the Redump DAT URL when a cache exists; if the `Content-Disposition` filename is unchanged it reuses the cached file. Otherwise it downloads the ZIP, unzips the `.dat`, and loads it into the filter UI.
4. Use **Refresh systems** to re-scrape the Redump downloads list. Use **Check updates** / **Force refresh** as needed.

Caches live under the Tauri app data directory (not next to the binary), e.g. `%APPDATA%\com.redump.filter\cache\` on Windows:

- `redump-systems.json` — system list (refreshed in the background when older than 7 days)
- `dats/{slug}/` — cached DAT + `meta.json` for HEAD freshness / update badges

On first launch after upgrading from the Electron 1.x app, an existing Electron cache under `%APPDATA%\redump-dat-filter\cache\` is copied automatically when the Tauri cache is empty.

### Open a local DAT

1. Click **Open DAT** (or drag-and-drop) and choose a Redump `.dat` file.
2. Region checkboxes populate from the file. By default the app pre-selects `USA` and `World` when available.
3. Adjust selections to see an immediate preview showing updated header description, suggested filename, and matched/removed entry counts.
4. Click **Save Filtered DAT** to choose an output location.

If no entries match a selection, the preview shows an error and **Save Filtered DAT** stays disabled. Clearing all region checkboxes includes every game (`All regions`).

## Scripts

| Command             | Description                                              |
| ------------------- | -------------------------------------------------------- |
| `npm run dev`       | Start Vite + Tauri in development mode.                  |
| `npm run build`     | Build renderer assets.                                   |
| `npm run package`   | Create distributable installers via `tauri build`.       |
| `npm run test`      | Run TypeScript parser tests and Rust unit tests.         |
| `npm run clean`     | Remove `dist/` output.                                   |
| `npm run typecheck` | Run TypeScript checks without emitting files.            |

## Packaging

`npm run package` / `npm run package:signed` invokes `tauri build` for the current platform.

CI builds all platforms when you push a version tag (`vX.Y.Z`) or run the **Release** workflow from the Actions tab. Each release includes:

- **Installers** (NSIS / DMG / AppImage, etc.) with signed Tauri updater artifacts and `latest.json` for in-app updates
- **Portable zips** named `redump-dat-filter-unpacked-{VERSION}-{OS}-{ARCH}.zip` (extract and run; updates open the GitHub release page)

Artifacts are published to [GitHub Releases](https://github.com/scdemanett/redump-dat-filter/releases).

macOS builds are unsigned. On first launch you may need to right-click the app and choose **Open**, or allow it in **System Settings → Privacy & Security**.

### App updates

Packaged **installed** builds check GitHub Releases on startup and can download/install updates in-app via **Download update** → **Restart and install** (signed with the Tauri updater minisign key).

**Portable zips** still check for updates, but **Download update** opens the latest GitHub release page instead of installing in-place (detected like Electron: no NSIS uninstaller / not AppImage / not under `/Applications`).

Dev builds (`npm run dev`) do not check for app updates.

**Maintainers:** generate the minisign keypair once (`npx tauri signer generate -w .tauri/redump-dat-filter.key`), embed the public key in `src-tauri/tauri.conf.json`, and set GitHub Actions secrets `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Local signed builds use [`scripts/signing-key.ps1`](scripts/signing-key.ps1) (1Password CLI via `REDUMP_DAT_FILTER_OP_PASSWORD_REF` / `OP_SERVICE_ACCOUNT_TOKEN`, or `.tauri/redump-dat-filter.key.pass`).

## Icons

Source artwork lives in `build/`:

- `icon.svg` — vector mark used in the app header
- `icon.png` — 1024×1024 master used to generate platform icons

Regenerate Tauri icons after replacing `icon.png`:

```bash
npx tauri icon build/icon.png
```

## Tech Stack

- Tauri 2 (Rust backend)
- React 19 + Vite 8
- TypeScript
- `reqwest` + `zip` for Redump download/cache
- Custom Rust DAT parser (Logiqx XML)

## License

MIT © 2026 Steven Demanett. See [LICENSE](LICENSE) and [CHANGELOG.md](CHANGELOG.md).
