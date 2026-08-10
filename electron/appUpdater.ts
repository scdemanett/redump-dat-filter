import { app, shell } from 'electron';
import { autoUpdater } from 'electron-updater';

import { APP_UPDATE_CHANNELS, type AppUpdateStatus } from '../src/shared';

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const GITHUB_REPO = 'scdemanett/redump-dat-filter';
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;

type StatusSender = (status: AppUpdateStatus) => void;

let sendStatus: StatusSender = () => {};
let lastStatus: AppUpdateStatus = { state: 'idle' };
let lastCheckWasManual = false;

function setStatus(status: AppUpdateStatus): void {
  lastStatus = status;
  sendStatus(status);
}

function canAutoUpdate(): boolean {
  return app.isPackaged && !isDev && !process.env.PORTABLE_EXECUTABLE_DIR;
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

async function checkViaGitHubApi(): Promise<AppUpdateStatus> {
  const currentVersion = app.getVersion();

  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `${app.getName()}/${currentVersion}`
      }
    });

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
        autoInstallSupported: false
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

  if (!canAutoUpdate()) {
    setStatus({
      state: 'idle',
      currentVersion: app.getVersion()
    });

    setTimeout(() => {
      void checkForAppUpdates(false);
    }, 5000);
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    setStatus({ state: 'checking' });
  });

  autoUpdater.on('update-not-available', () => {
    if (lastCheckWasManual) {
      setStatus({
        state: 'unavailable',
        currentVersion: app.getVersion()
      });
    }
  });

  autoUpdater.on('update-available', (info) => {
    setStatus({
      state: 'available',
      currentVersion: app.getVersion(),
      latestVersion: info.version,
      releaseNotes: formatReleaseNotes(info.releaseNotes),
      releaseUrl: GITHUB_RELEASES_URL,
      autoInstallSupported: true
    });
  });

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
    if (lastCheckWasManual) {
      setStatus({
        state: 'error',
        message: error.message
      });
    }
  });

  setStatus({
    state: 'idle',
    currentVersion: app.getVersion()
  });

  setTimeout(() => {
    void checkForAppUpdates(false);
  }, 5000);
}

export async function checkForAppUpdates(manual: boolean): Promise<AppUpdateStatus> {
  lastCheckWasManual = manual;
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

  if (canAutoUpdate()) {
    try {
      if (manual) {
        setStatus({ state: 'checking' });
      }
      await autoUpdater.checkForUpdates();
      return lastStatus;
    } catch (error) {
      const status: AppUpdateStatus = {
        state: 'error',
        message: error instanceof Error ? error.message : 'Failed to check for updates.'
      };
      setStatus(status);
      return status;
    }
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

export async function downloadAppUpdate(): Promise<AppUpdateStatus> {
  if (!canAutoUpdate()) {
    const status = lastStatus;
    if (status.state === 'available' && status.releaseUrl) {
      await shell.openExternal(status.releaseUrl);
    } else {
      await shell.openExternal(GITHUB_RELEASES_URL);
    }
    return lastStatus;
  }

  try {
    setStatus({ state: 'downloading', percent: 0 });
    await autoUpdater.downloadUpdate();
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

export function installAppUpdate(): AppUpdateStatus {
  if (!canAutoUpdate() || lastStatus.state !== 'downloaded') {
    return lastStatus;
  }

  autoUpdater.quitAndInstall();
  return lastStatus;
}

export { APP_UPDATE_CHANNELS };
