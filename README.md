# Redump DAT Filter

Cross-platform Electron desktop application for trimming Redump.org DAT collections by region and exporting an updated DAT with rewritten metadata.

## Features

- Parse large Redump DAT (XML) files entirely on the desktop.
- Automatically detect available regions and offer quick-select checkboxes.
- Live preview of filtered totals, renamed header/description, and suggested output filename.
- Exports a fully formatted DAT with updated `<header>` values and reduced `<game>` entries.
- Built with Electron + React + TypeScript and packaged via `electron-builder` for Windows/macOS/Linux.

## Project Structure

```
electron/           # Main + preload processes
src/renderer/       # React renderer UI
src/shared/         # Shared parser utilities, IPC types
DATs/               # Sample Redump DAT (Microsoft - Xbox)
build/              # Packaging assets (icons/placeholders)
```

## Getting Started

```bash
npm install
npm run dev
```

The development script launches Vite for the renderer, watches and rebuilds the Electron main/preload processes, and starts Electron with hot restarts. The UI automatically restores the most recently loaded DAT file when reopened.

## Usage

1. Click **Open DAT** and choose a Redump `.dat` file (a sample is available at `DATs/Microsoft - Xbox - Datfile (2665) (2025-11-07 05-38-55).dat`).
2. Region checkboxes populate from the file. By default the app pre-selects `USA` and `World` when available.
3. Adjust selections to see an immediate preview showing:
   - Updated header description and suggested filename (e.g. `Microsoft - Xbox (USA, World) - Datfile (1107) (2025-11-07 05-38-55)`).
   - Matched/removed entry counts relative to the original DAT.
4. Click **Save Filtered DAT** to choose an output location. The written file includes:
   - Updated `<header><name>` and `<header><description>` reflecting selected regions and counts.
   - The same `<version>`, `<date>`, and author metadata as the original file.
   - Only the `<game>` entries whose region tags match the selection.

If no entries match a selection the app warns before attempting to write a file.

## Scripts

| Command             | Description                                                                  |
| ------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`       | Start Vite, watch main/preload via `tsup`, and launch Electron with reloads. |
| `npm run build`     | Build renderer assets and compile Electron entry points.                     |
| `npm run package`   | Create distributable installers using `electron-builder`.                    |
| `npm run clean`     | Remove `dist/` and `dist-electron/` outputs.                                 |
| `npm run typecheck` | Run TypeScript checks without emitting files.                                |

## Packaging

`npm run package` invokes `electron-builder` with targets for:

- **Windows**: NSIS installer (`.exe`)
- **macOS**: DMG image
- **Linux**: AppImage

Artifacts are written to the `release/` directory. Update `build/` with platform-specific icons (`icon.ico`, `icon.icns`, `icon.png`) before distributing production builds.

## Icons

The `build/` directory includes pre-generated platform assets:

- `icon.png` (512×512) base artwork
- `icon.ico` for Windows
- `icon.icns` for macOS
- `icon_*.png` helper sizes used to build the icon set

To regenerate the icon set (requires Windows for the PowerShell drawing script):

```powershell
pwsh ./scripts/generate-icons.ps1
node ./scripts/generate-icns.js
```

These commands redraw the vector-style “R” artwork across multiple sizes, rebuild the multiresolution `.ico`, and compose a modern `.icns` container without external tooling.

## Tech Stack

- Electron 39
- React 19 + Vite 6
- TypeScript + `tsup`
- `fast-xml-parser` for XML parsing and writing

## License

MIT © 2025 Steven DeManett

