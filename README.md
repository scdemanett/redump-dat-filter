# Redump DAT Filter



Cross-platform Electron desktop application for trimming Redump.org DAT collections by region and exporting an updated DAT with rewritten metadata.



## Features



- Download the latest Redump DAT for a system directly from [redump.info](https://redump.info/downloads) (no manual browser download required).

- Live system list with disk cache and manual refresh so new Redump systems appear without an app update.

- Cheap update badges for previously downloaded DATs via HTTP HEAD checks.

- Parse large Redump DAT (XML) files entirely on the desktop.

- Automatically detect available regions and offer quick-select checkboxes.

- Live preview of filtered totals, renamed header/description, and suggested output filename.

- Exports a fully formatted DAT with updated `<header>` values and reduced `<game>` entries.

- Built with Electron + React + TypeScript and packaged via `electron-builder` for Windows/macOS/Linux.



## Project Structure



```

electron/           # Main + preload processes

src/renderer/       # React renderer UI

src/shared/         # Shared parser utilities, IPC types, tests

build/              # Packaging assets and icons

```



## Getting Started



```bash

npm install

npm run dev

```



The development script launches Vite for the renderer, watches and rebuilds the Electron main/preload processes, and starts Electron with hot restarts.



## Usage



### Download from Redump



1. In **Download from Redump**, search/select a system. Selection alone does not download.

2. Click **Download & load** (or **Load** / **Download update** when a cached DAT exists).

3. The app HEADs the Redump DAT URL when a cache exists; if the `Content-Disposition` filename is unchanged it reuses the cached file. Otherwise it downloads the ZIP, unzips the `.dat`, and loads it into the filter UI.

4. Use **Refresh systems** to re-scrape the Redump downloads list. Use **Check updates** / **Force refresh** as needed.



Caches live under Electron `userData` (not next to the binary), e.g. `%APPDATA%\redump-dat-filter\cache\` on Windows:



- `redump-systems.json` — system list (refreshed in the background when older than 7 days)

- `dats/{slug}/` — cached DAT + `meta.json` for HEAD freshness / update badges



### Open a local DAT



1. Click **Open DAT** (or drag-and-drop) and choose a Redump `.dat` file.

2. Region checkboxes populate from the file. By default the app pre-selects `USA` and `World` when available.

3. Adjust selections to see an immediate preview showing:

   - Updated header description and suggested filename (e.g. `Microsoft - Xbox (USA, World) - Datfile (1107) (2025-11-07 05-38-55)`).

   - Matched/removed entry counts relative to the original DAT.

4. Click **Save Filtered DAT** to choose an output location. The written file includes:

   - Updated `<header><name>` and `<header><description>` reflecting selected regions and counts.

   - The same `<version>`, `<date>`, and author metadata as the original file.

   - Only the `<game>` entries whose region tags match the selection.



If no entries match a selection, the preview shows an error and **Save Filtered DAT** stays disabled. Clearing all region checkboxes includes every game (`All regions`).



## Scripts



| Command             | Description                                                                  |

| ------------------- | ---------------------------------------------------------------------------- |

| `npm run dev`       | Start Vite, watch main/preload via `tsup`, and launch Electron with reloads. |

| `npm run build`     | Build renderer assets and compile Electron entry points.                     |

| `npm run package`   | Create distributable installers and portable zips using `electron-builder`.  |

| `npm run test`      | Run shared parser unit tests.                                                |

| `npm run clean`     | Remove `dist/` and `dist-electron/` outputs.                                 |

| `npm run typecheck` | Run TypeScript checks without emitting files.                                |



## Packaging



`npm run package` invokes `electron-builder` with targets for:



- **Windows**: NSIS installer (`.exe`) and portable zip

- **macOS**: DMG image and portable zip (x64 and arm64)

- **Linux**: AppImage and portable zip



Artifacts are written to the `release/` directory with these names:



- Installers: `redump-dat-filter-setup-{VERSION}-{PLATFORM}.{ext}` (e.g. `redump-dat-filter-setup-1.0.0-win-x64.exe`)

- Portable builds: `redump-dat-filter-unpacked-{VERSION}-{PLATFORM}.zip` (e.g. `redump-dat-filter-unpacked-1.0.0-mac-arm64.zip`)



`{PLATFORM}` is `{os}-{arch}` such as `win-x64`, `mac-arm64`, or `linux-x64`. Portable zips contain the unpacked app — extract and run the executable without installing.



Download releases from [GitHub Releases](https://github.com/scdemanett/redump-dat-filter/releases).



Update `build/` with platform-specific icons (`icon.ico`, `icon.icns`, `icon.png`) before distributing production builds.



### GitHub Releases



CI builds all platforms when you push a version tag (`vX.Y.Z`) or run the **Release** workflow manually from the Actions tab.



- **Tag push** (`v*`) — builds installers and portable zips, then publishes them to a GitHub Release.

- **Manual run** — builds and uploads workflow artifacts only (no Release).

- **Publish only** — in the Actions tab, run **Release** with `release_only: true`, the target tag, and the workflow run ID from a completed build that uploaded artifacts. Skips rebuilding; useful when the build succeeded but publishing failed.



macOS builds are unsigned. On first launch you may need to right-click the app and choose **Open**, or allow it in **System Settings → Privacy & Security**. In-app macOS updates may also require a manual download until signing is added.



### App updates



Packaged builds check GitHub Releases for new app versions on startup. Installed builds (NSIS on Windows, AppImage on Linux, macOS apps in `/Applications`) can download and install updates in-app via **Download update** → **Restart and install**. Unpacked portable zips use the same release check but open the release page to download manually.



Dev builds (`npm run dev`) do not check for app updates.



## Icons



Source artwork lives in `build/`:



- `icon.svg` — vector mark used in the app header

- `icon.png` — 1024×1024 master used to generate platform icons



Generated packaging assets:



- `icon.ico` for Windows

- `icon.icns` for macOS

- `icon_*.png` size variants used while building those containers



Regenerate after replacing `icon.png`:



```powershell

pwsh ./scripts/generate-icons.ps1

node ./scripts/generate-icns.js

```



These commands resize the master PNG across multiple sizes, rebuild the multiresolution `.ico`, and compose a modern `.icns` container without external tooling.



## Tech Stack



- Electron 43

- React 19 + Vite 8

- TypeScript + `tsup`

- `fast-xml-parser` for XML parsing and writing

- `fflate` for Redump DAT ZIP extraction



## License



MIT © 2026 Steven Demanett. See [LICENSE](LICENSE) and [CHANGELOG.md](CHANGELOG.md).
