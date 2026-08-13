#!/usr/bin/env node
/**
 * Pack an Electron-parity portable zip after `tauri build`.
 *
 * Layout:
 *   redump-dat-filter-unpacked-{version}-{os}-{arch}.zip
 *     └── redump-dat-filter[.exe]   (or *.app on macOS)
 *
 * Portable builds are detected at runtime without a marker file (no NSIS
 * uninstaller / not AppImage / not under /Applications), so updates open
 * the GitHub release page instead of installing in-app.
 *
 * Usage:
 *   node scripts/create-portable-zip.mjs
 *   node scripts/create-portable-zip.mjs --target aarch64-apple-darwin
 *   node scripts/create-portable-zip.mjs --args "--target x86_64-apple-darwin"
 *   node scripts/create-portable-zip.mjs --out portable-dist
 */
import { execSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspace = join(__dirname, '..');
const BINARY_NAME = 'redump-dat-filter';
const PRODUCT_NAME = 'Redump DAT Filter';

/** @param {string[]} argv */
export function parseArgs(argv) {
  const out = { target: '', args: '', outDir: join(workspace, 'portable-dist'), version: '' };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--target') out.target = argv[++i] ?? '';
    else if (a === '--args') out.args = argv[++i] ?? '';
    else if (a === '--out') out.outDir = argv[++i] ?? out.outDir;
    else if (a === '--version') out.version = argv[++i] ?? '';
    else throw new Error(`Unknown option: ${a}`);
  }
  if (!out.target && out.args) {
    const match = /--target\s+(\S+)/.exec(out.args);
    if (match) out.target = match[1];
  }
  return out;
}

/** @param {string} cargoTomlPath */
export function readVersion(cargoTomlPath) {
  const text = readFileSync(cargoTomlPath, 'utf8');
  const match = text.match(/^\s*version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error(`Could not read version from ${cargoTomlPath}`);
  return match[1];
}

export function hostTriple() {
  return execSync('rustc -vV', { encoding: 'utf8' })
    .split('\n')
    .find((line) => line.startsWith('host:'))
    .split(':')[1]
    .trim();
}

/** @param {string} triple */
export function platformLabel(triple) {
  if (triple.includes('windows')) {
    if (triple.includes('aarch64')) return { os: 'win', arch: 'arm64' };
    return { os: 'win', arch: 'x64' };
  }
  if (triple.includes('apple-darwin') || triple.includes('macos')) {
    if (triple.includes('aarch64')) return { os: 'mac', arch: 'arm64' };
    return { os: 'mac', arch: 'x64' };
  }
  if (triple.includes('linux')) {
    if (triple.includes('aarch64')) return { os: 'linux', arch: 'arm64' };
    return { os: 'linux', arch: 'x64' };
  }
  throw new Error(`Unsupported target triple: ${triple}`);
}

/** @param {string} triple @param {string} host @param {boolean} explicitTarget */
export function releaseDirCandidates(triple, host, explicitTarget) {
  const base = join(workspace, 'src-tauri', 'target');
  /** @type {string[]} */
  const dirs = [];
  if (explicitTarget && triple) {
    // `tauri build --target <triple>` always writes under target/<triple>/release,
    // even when that triple matches the host (CI mac arm64 case).
    dirs.push(join(base, triple, 'release'));
  }
  dirs.push(join(base, 'release'));
  if (triple && triple !== host) {
    dirs.push(join(base, triple, 'release'));
  } else if (host) {
    dirs.push(join(base, host, 'release'));
  }
  return [...new Set(dirs)];
}

/**
 * @param {string[]} releaseDirs
 * @param {string} triple
 */
export function resolvePortablePayload(releaseDirs, triple) {
  /** @type {string[]} */
  const tried = [];

  if (triple.includes('apple-darwin')) {
    for (const releaseDir of releaseDirs) {
      const macosDir = join(releaseDir, 'bundle', 'macos');
      const preferred = join(macosDir, `${PRODUCT_NAME}.app`);
      tried.push(preferred);
      if (existsSync(preferred)) {
        return { kind: 'app', source: preferred, destName: `${PRODUCT_NAME}.app` };
      }
      if (existsSync(macosDir)) {
        const apps = readdirSync(macosDir).filter((name) => name.endsWith('.app'));
        if (apps[0]) {
          const appPath = join(macosDir, apps[0]);
          tried.push(appPath);
          return { kind: 'app', source: appPath, destName: apps[0] };
        }
        tried.push(`${macosDir}/*`);
      }
    }
    throw new Error(`Missing macOS app bundle. Looked in:\n${tried.map((p) => ` - ${p}`).join('\n')}`);
  }

  const exeName = triple.includes('windows') ? `${BINARY_NAME}.exe` : BINARY_NAME;
  for (const releaseDir of releaseDirs) {
    const exePath = join(releaseDir, exeName);
    tried.push(exePath);
    if (existsSync(exePath)) {
      return { kind: 'bin', source: exePath, destName: exeName };
    }
  }
  throw new Error(`Missing binary. Looked in:\n${tried.map((p) => ` - ${p}`).join('\n')}`);
}

/**
 * @param {{ source: string, destName: string, kind: string }} payload
 * @param {string} zipPath
 * @param {string} triple
 */
export function createZip(payload, zipPath, triple) {
  const staging = mkdtempSync(join(tmpdir(), 'redump-portable-'));
  try {
    if (payload.kind === 'app') {
      cpSync(payload.source, join(staging, payload.destName), { recursive: true });
    } else {
      cpSync(payload.source, join(staging, payload.destName));
    }

    if (existsSync(zipPath)) {
      rmSync(zipPath, { force: true });
    }
    mkdirSync(dirname(zipPath), { recursive: true });

    if (process.platform === 'win32') {
      const stagingEsc = staging.replace(/'/g, "''");
      const zipEsc = zipPath.replace(/'/g, "''");
      execSync(
        `powershell -NoProfile -Command "Compress-Archive -Path '${stagingEsc}\\*' -DestinationPath '${zipEsc}' -Force"`,
        { stdio: 'inherit' }
      );
    } else {
      execSync(`zip -qry "${zipPath}" .`, { cwd: staging, stdio: 'inherit' });
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function main() {
  const args = parseArgs(process.argv);
  const host = hostTriple();
  const explicitTarget = Boolean(args.target);
  const triple = args.target || host;
  const version = args.version || readVersion(join(workspace, 'src-tauri', 'Cargo.toml'));
  const { os, arch } = platformLabel(triple);
  const releaseDirs = releaseDirCandidates(triple, host, explicitTarget);
  const payload = resolvePortablePayload(releaseDirs, triple);

  mkdirSync(args.outDir, { recursive: true });
  const zipName = `redump-dat-filter-unpacked-${version}-${os}-${arch}.zip`;
  const zipPath = join(args.outDir, zipName);
  createZip(payload, zipPath, triple);

  console.log(`Created ${zipPath}`);
  console.log(`  source: ${payload.source}`);
  console.log(`  triple: ${triple}`);
  console.log(`  searched: ${releaseDirs.join(', ')}`);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main();
}
