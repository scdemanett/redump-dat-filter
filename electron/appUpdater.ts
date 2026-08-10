import { app, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { APP_UPDATE_CHANNELS, type AppUpdateStatus } from '../src/shared';

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const GITHUB_REPO = 'scdemanett/redump-dat-filter';
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;
const UPDATE_CHECK_TIMEOUT_MS = 15_000;
const AUTO_UPDATE_TIMEOUT_MS = 30_000;

type StatusSender = (status: AppUpdateStatus) => void;

let sendStatus: StatusSender = () => {};
let lastStatus: AppUpdateStatus = { state: 'idle' };
let autoUpdaterConfigured = false;

function setStatus(status: AppUpdateStatus): void {
  lastStatus = status;
  sendStatus(status);
}

function hasWindowsInstallerUninstaller(): boolean {
  try {
    const installDir = path.dirname(process.execPath);
    return readdirSync(installDir).some((file) => /^Uninstall .+\.exe$/i.test(file));
  } catch {
    return false;
  }
}

function supportsAutoInstall(): boolean {
  if (!app.isPackaged || isDev || process.env.PORTABLE_EXECUTABLE_DIR) {
    return false;
  }

  if (!existsSync(path.join(process.resourcesPath, 'app-update.yml'))) {
    return false;
  }

  if (process.platform === 'win32') {
    return hasWindowsInstallerUninstaller();
  }

  if (process.platform === 'linux') {
    return Boolean(process.env.APPIMAGE);
  }

  if (process.platform === 'darwin') {
    return process.execPath.includes(`${path.sep}Applications${path.sep}`);
  }

  return false;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function isNewerVersion(latest: string, current: string): boolean {
  const parse = (value: string) =>
    value
      .replace(/^v/i, '')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);

  const latestParts = parse(latest);
  const currentParts = parse(current);
  const length = Math.max(latestParts.length, currentParts.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (latestParts[index] ?? 0) - (currentParts[index] ?? 0);
    if (diff !== 0) {
      return diff > 0;
    }
  }

  return false;
}

function formatReleaseNotes(notes: unknown): string | undefined {
  if (typeof notes === 'string') {
    return notes.trim() || undefined;
  }

  if (Array.isArray(notes)) {
    const text = notes
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }
        if (entry && typeof entry === 'object' && 'note' in entry && typeof entry.note === 'string') {
          return entry.note;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n')
      .trim();

    return text || undefined;
  }

  return undefined;
}

function configureAutoUpdater(): void {
  if (autoUpdaterConfigured) {
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('download-progress', (progress) => {
    setStatus({
      state: 'downloading',
      percent: progress.percent
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    setStatus({
      state: 'downloaded',
      latestVersion: info.version,
      autoInstallSupported: true
    });
  });

  autoUpdater.on('error', (error) => {
    if (lastStatus.state === 'downloading') {
      setStatus({
        state: 'error',
        message: error.message
      });
    }
  });

  autoUpdaterConfigured = true;
}

async function checkViaGitHubApi(): Promise<AppUpdateStatus> {
  const currentVersion = app.getVersion();
  const autoInstallSupported = supportsAutoInstall();

  try {
    const response = await withTimeout(
      fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `${app.getName()}/${currentVersion}`
        },
        signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS)
      }),
      UPDATE_CHECK_TIMEOUT_MS,
      'Timed out while checking for updates.'
    );

    if (!response.ok) {
      throw new Error(`GitHub API responded with ${response.status}`);
    }

    const payload = (await response.json()) as {
      tag_name?: string;
      html_url?: string;
      body?: string;
    };

    const latestVersion = payload.tag_name?.replace(/^v/i, '') ?? '';
    if (!latestVersion) {
      throw new Error('Latest release is missing a version tag.');
    }

    if (isNewerVersion(latestVersion, currentVersion)) {
      return {
        state: 'available',
        currentVersion,
        latestVersion,
        releaseNotes: payload.body?.trim() || undefined,
        releaseUrl: payload.html_url ?? GITHUB_RELEASES_URL,
        autoInstallSupported
      };
    }

    return {
      state: 'unavailable',
      currentVersion
    };
  } catch (error) {
    return {
      state: 'error',
      message: error instanceof Error ? error.message : 'Failed to check for updates.'
    };
  }
}

export function getAppVersion(): string {
  return app.getVersion();
}

export function getLastAppUpdateStatus(): AppUpdateStatus {
  return lastStatus;
}

export function registerAppUpdateStatusSender(sender: StatusSender): void {
  sendStatus = sender;
  sendStatus(lastStatus);
}

export function initAppUpdater(): void {
  if (!app.isPackaged || isDev) {
    setStatus({
      state: 'disabled',
      reason: 'Updates are checked in packaged builds only.'
    });
    return;
  }

  if (supportsAutoInstall()) {
    configureAutoUpdater();
  }

  setStatus({
    state: 'idle',
    currentVersion: app.getVersion()
  });

  setTimeout(() => {
    void checkForAppUpdates(false);
  }, 5000);
}

export async function checkForAppUpdates(manual: boolean): Promise<AppUpdateStatus> {
  const currentVersion = app.getVersion();

  if (!app.isPackaged || isDev) {
    const status: AppUpdateStatus = {
      state: 'disabled',
      reason: 'Updates are checked in packaged builds only.'
    };
    if (manual) {
      setStatus(status);
    }
    return status;
  }

  if (manual) {
    setStatus({ state: 'checking' });
  }

  const status = await checkViaGitHubApi();

  if (status.state === 'unavailable') {
    const resolved: AppUpdateStatus = {
      state: 'unavailable',
      currentVersion
    };
    if (manual) {
      setStatus(resolved);
    }
    return resolved;
  }

  if (manual || status.state === 'available') {
    setStatus(status);
  }

  return status;
}

async function downloadViaAutoUpdater(): Promise<AppUpdateStatus> {
  configureAutoUpdater();

  try {
    setStatus({ state: 'downloading', percent: 0 });

    const checkResult = await withTimeout(
      autoUpdater.checkForUpdates(),
      AUTO_UPDATE_TIMEOUT_MS,
      'Timed out while preparing the in-app update download.'
    );

    if (!checkResult?.updateInfo) {
      throw new Error('No in-app update is available for this install.');
    }

    await withTimeout(
      autoUpdater.downloadUpdate(),
      AUTO_UPDATE_TIMEOUT_MS,
      'Timed out while downloading the update.'
    );

    return lastStatus;
  } catch (error) {
    const status: AppUpdateStatus = {
      state: 'error',
      message: error instanceof Error ? error.message : 'Failed to download update.'
    };
    setStatus(status);
    return status;
  }
}

export async function downloadAppUpdate(): Promise<AppUpdateStatus> {
  if (lastStatus.state !== 'available') {
    return lastStatus;
  }

  if (supportsAutoInstall() && lastStatus.autoInstallSupported) {
    return downloadViaAutoUpdater();
  }

  const releaseUrl = lastStatus.releaseUrl ?? GITHUB_RELEASES_URL;
  await shell.openExternal(releaseUrl);
  return lastStatus;
}

export function installAppUpdate(): AppUpdateStatus {
  if (!supportsAutoInstall() || lastStatus.state !== 'downloaded') {
    return lastStatus;
  }

  autoUpdater.quitAndInstall();
  return lastStatus;
}

export { APP_UPDATE_CHANNELS };
