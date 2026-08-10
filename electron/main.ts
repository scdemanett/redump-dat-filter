import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import type { IpcMainInvokeEvent, OpenDialogOptions, SaveDialogOptions } from 'electron';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  filterDatByRegions,
  parseDat,
  type FilteredDatResult,
  type ParsedDat,
  IPC_CHANNELS,
  type CheckUpdatesRequest,
  type CheckUpdatesResponse,
  type CurrentDatResponse,
  type DownloadSystemRequest,
  type DownloadSystemResponse,
  type FilterPreviewRequest,
  type FilterPreviewResponse,
  type ListSystemsResponse,
  type LoadedDatPayload,
  type LoadFromPathResponse,
  type OpenDatResponse,
  type SaveFilterRequest,
  type SaveFilterResponse
} from '../src/shared';
import {
  checkDownloadedUpdates,
  downloadOrLoadSystem,
  getSystemList,
  maybeRefreshSystemListInBackground,
  refreshSystemList
} from './redumpDownload';
import {
  getDefaultWindowOptions,
  loadWindowState,
  shouldStartMaximized,
  trackWindowState
} from './windowState';
import {
  APP_UPDATE_CHANNELS,
  checkForAppUpdates,
  downloadAppUpdate,
  getAppVersion,
  getLastAppUpdateStatus,
  initAppUpdater,
  installAppUpdate,
  registerAppUpdateStatusSender
} from './appUpdater';

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const DAT_FILE_FILTER = {
  name: 'Redump DAT',
  extensions: ['dat', 'xml']
};

interface LoadedDatState {
  sourcePath: string;
  originalFilename: string;
  parsed: ParsedDat;
}

let loadedDat: LoadedDatState | null = null;
let mainWindow: BrowserWindow | null = null;

function resolveAppIconPath(): string | undefined {
  const buildDir = path.join(__dirname, '..', 'build');
  const candidates =
    process.platform === 'win32'
      ? ['icon.ico', 'icon.png']
      : process.platform === 'darwin'
        ? ['icon.icns', 'icon.png']
        : ['icon.png'];

  for (const name of candidates) {
    const candidate = path.join(buildDir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

const createMainWindow = async () => {
  const savedState = loadWindowState();
  const windowOptions = getDefaultWindowOptions(savedState);
  const startMaximized = shouldStartMaximized(savedState);
  const icon = resolveAppIconPath();

  const browserWindow = new BrowserWindow({
    ...windowOptions,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  });

  trackWindowState(browserWindow);
  mainWindow = browserWindow;

  browserWindow.once('ready-to-show', () => {
    if (startMaximized) {
      browserWindow.maximize();
    }
    browserWindow.show();
    if (isDev) {
      try {
        browserWindow.webContents.openDevTools({ mode: 'detach' });
      } catch {
        // ignore devtools errors
      }
    }
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await browserWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const indexHtml = path.join(__dirname, '..', 'dist', 'index.html');
    await browserWindow.loadFile(indexHtml);
  }
};

app.whenReady().then(() => {
  // Drop Electron's default File/Edit/View/Window menu on Windows/Linux.
  // Keep the macOS app menu (platform convention).
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
  }

  registerIpcHandlers();
  registerAppUpdateStatusSender((status) => {
    mainWindow?.webContents.send(APP_UPDATE_CHANNELS.status, status);
  });
  initAppUpdater();
  maybeRefreshSystemListInBackground();

  createMainWindow().catch((error) => {
    console.error('Failed to create main window', error);
    app.exit(1);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow().catch((error) => console.error('Failed to recreate main window', error));
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  unregisterIpcHandlers();
});

function registerIpcHandlers() {
  ipcMain.handle('ping', () => 'pong');
  ipcMain.handle(IPC_CHANNELS.openDat, handleOpenDat);
  ipcMain.handle(IPC_CHANNELS.loadFromPath, handleLoadFromPath);
  ipcMain.handle(IPC_CHANNELS.getCurrent, handleGetCurrentDat);
  ipcMain.handle(IPC_CHANNELS.previewFilter, handlePreviewFilter);
  ipcMain.handle(IPC_CHANNELS.saveFiltered, handleSaveFiltered);
  ipcMain.handle(IPC_CHANNELS.listSystems, handleListSystems);
  ipcMain.handle(IPC_CHANNELS.refreshSystems, handleRefreshSystems);
  ipcMain.handle(IPC_CHANNELS.checkUpdates, handleCheckUpdates);
  ipcMain.handle(IPC_CHANNELS.downloadSystem, handleDownloadSystem);
  ipcMain.handle(APP_UPDATE_CHANNELS.getVersion, () => getAppVersion());
  ipcMain.handle(APP_UPDATE_CHANNELS.checkForUpdates, (_event, manual = true) =>
    checkForAppUpdates(Boolean(manual))
  );
  ipcMain.handle(APP_UPDATE_CHANNELS.downloadUpdate, () => downloadAppUpdate());
  ipcMain.handle(APP_UPDATE_CHANNELS.installUpdate, () => installAppUpdate());
  ipcMain.handle(APP_UPDATE_CHANNELS.getStatus, () => getLastAppUpdateStatus());
}

function unregisterIpcHandlers() {
  ipcMain.removeHandler('ping');
  ipcMain.removeHandler(IPC_CHANNELS.openDat);
  ipcMain.removeHandler(IPC_CHANNELS.loadFromPath);
  ipcMain.removeHandler(IPC_CHANNELS.getCurrent);
  ipcMain.removeHandler(IPC_CHANNELS.previewFilter);
  ipcMain.removeHandler(IPC_CHANNELS.saveFiltered);
  ipcMain.removeHandler(IPC_CHANNELS.listSystems);
  ipcMain.removeHandler(IPC_CHANNELS.refreshSystems);
  ipcMain.removeHandler(IPC_CHANNELS.checkUpdates);
  ipcMain.removeHandler(IPC_CHANNELS.downloadSystem);
  ipcMain.removeHandler(APP_UPDATE_CHANNELS.getVersion);
  ipcMain.removeHandler(APP_UPDATE_CHANNELS.checkForUpdates);
  ipcMain.removeHandler(APP_UPDATE_CHANNELS.downloadUpdate);
  ipcMain.removeHandler(APP_UPDATE_CHANNELS.installUpdate);
  ipcMain.removeHandler(APP_UPDATE_CHANNELS.getStatus);
}

async function handleOpenDat(event: IpcMainInvokeEvent): Promise<OpenDatResponse> {
  const window = BrowserWindow.fromWebContents(event.sender);
  const dialogOptions: OpenDialogOptions = {
    title: 'Select Redump DAT file',
    filters: [DAT_FILE_FILTER],
    properties: ['openFile']
  };
  const dialogResult = window
    ? await dialog.showOpenDialog(window, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = dialogResult.filePaths[0];

  return loadDatFromPath(filePath, false);
}

async function handleLoadFromPath(
  _event: IpcMainInvokeEvent,
  filePath: string
): Promise<LoadFromPathResponse> {
  return loadDatFromPath(filePath, true);
}

async function loadDatFromPath(filePath: string, respondWithStatus: true): Promise<LoadFromPathResponse>;
async function loadDatFromPath(filePath: string, respondWithStatus: false): Promise<OpenDatResponse>;
async function loadDatFromPath(
  filePath: string,
  respondWithStatus: boolean
): Promise<LoadFromPathResponse | OpenDatResponse> {
  if (!filePath) {
    const message = 'No file path provided.';
    return respondWithStatus ? { success: false, error: message } : { canceled: false, error: message };
  }

  try {
    const state = await loadStateFromFile(filePath);
    loadedDat = state;
    const data = buildLoadedPayload(state);
    return respondWithStatus ? { success: true, data } : { canceled: false, data };
  } catch (error) {
    console.error('Failed to load DAT file', error);
    const message = error instanceof Error ? error.message : 'Failed to load DAT file.';
    return respondWithStatus ? { success: false, error: message } : { canceled: false, error: message };
  }
}

async function handleGetCurrentDat(): Promise<CurrentDatResponse> {
  if (!loadedDat) {
    return { loaded: false };
  }

  return {
    loaded: true,
    data: buildLoadedPayload(loadedDat)
  };
}

async function handlePreviewFilter(
  _event: IpcMainInvokeEvent,
  request: FilterPreviewRequest
): Promise<FilterPreviewResponse> {
  if (!loadedDat) {
    return { success: false, error: 'No DAT file loaded.' };
  }

  try {
    const result = runFilter(loadedDat, request.regions);
    return {
      success: true,
      header: result.header,
      summary: result.summary,
      filename: result.filename
    };
  } catch (error) {
    console.error('Failed to preview filter', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to preview filtered DAT.'
    };
  }
}

async function handleSaveFiltered(
  event: IpcMainInvokeEvent,
  request: SaveFilterRequest
): Promise<SaveFilterResponse> {
  if (!loadedDat) {
    return { success: false, error: 'No DAT file loaded.' };
  }

  try {
    const result = runFilter(loadedDat, request.regions);
    const window = BrowserWindow.fromWebContents(event.sender);

    let finalPath = request.targetPath;
    if (!finalPath) {
      const saveOptions: SaveDialogOptions = {
        title: 'Save filtered DAT file',
        defaultPath: path.join(path.dirname(loadedDat.sourcePath), result.filename),
        filters: [DAT_FILE_FILTER]
      };
      const saveResult = window
        ? await dialog.showSaveDialog(window, saveOptions)
        : await dialog.showSaveDialog(saveOptions);

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, canceled: true };
      }

      finalPath = saveResult.filePath;
    }

    await fs.writeFile(finalPath, result.xml, 'utf-8');

    return {
      success: true,
      savedPath: finalPath,
      filename: path.basename(finalPath),
      header: result.header,
      summary: result.summary
    };
  } catch (error) {
    console.error('Failed to save filtered DAT', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save filtered DAT file.'
    };
  }
}

async function handleListSystems(): Promise<ListSystemsResponse> {
  try {
    const result = await getSystemList({ force: false });
    return {
      success: true,
      systems: result.systems,
      source: result.source,
      fetchedAt: result.fetchedAt
    };
  } catch (error) {
    console.error('Failed to list Redump systems', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list Redump systems.'
    };
  }
}

async function handleRefreshSystems(): Promise<ListSystemsResponse> {
  try {
    const result = await refreshSystemList();
    return {
      success: true,
      systems: result.systems,
      source: result.source,
      fetchedAt: result.fetchedAt
    };
  } catch (error) {
    console.error('Failed to refresh Redump systems', error);
    try {
      const fallback = await getSystemList({ force: false });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to refresh Redump systems.',
        systems: fallback.systems,
        source: fallback.source,
        fetchedAt: fallback.fetchedAt
      };
    } catch {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to refresh Redump systems.'
      };
    }
  }
}

async function handleCheckUpdates(
  _event: IpcMainInvokeEvent,
  request: CheckUpdatesRequest = {}
): Promise<CheckUpdatesResponse> {
  try {
    const result = await checkDownloadedUpdates({ force: Boolean(request.force) });
    const updateCount = result.systems.filter((system) => system.updateAvailable).length;
    return {
      success: true,
      systems: result.systems,
      source: result.source,
      fetchedAt: result.fetchedAt,
      updateCount
    };
  } catch (error) {
    console.error('Failed to check Redump DAT updates', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to check DAT updates.'
    };
  }
}

async function handleDownloadSystem(
  _event: IpcMainInvokeEvent,
  request: DownloadSystemRequest
): Promise<DownloadSystemResponse> {
  if (!request?.slug) {
    return { success: false, error: 'No system selected.' };
  }

  try {
    const downloaded = await downloadOrLoadSystem(request.slug, { force: Boolean(request.force) });
    const parsed = parseDat(downloaded.xml);
    const state: LoadedDatState = {
      sourcePath: downloaded.sourcePath,
      originalFilename: downloaded.originalFilename,
      parsed
    };
    loadedDat = state;

    return {
      success: true,
      data: buildLoadedPayload(state),
      fromCache: downloaded.fromCache
    };
  } catch (error) {
    console.error('Failed to download Redump DAT', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to download Redump DAT.'
    };
  }
}

async function loadStateFromFile(filePath: string): Promise<LoadedDatState> {
  await fs.access(filePath);
  const fileContent = await fs.readFile(filePath, 'utf-8');
  const parsed = parseDat(fileContent);

  return {
    sourcePath: filePath,
    originalFilename: path.basename(filePath),
    parsed
  };
}

function runFilter(state: LoadedDatState, regions: string[]): FilteredDatResult {
  return filterDatByRegions(state.parsed, regions ?? [], state.originalFilename);
}

function buildLoadedPayload(state: LoadedDatState): LoadedDatPayload {
  return {
    filePath: state.sourcePath,
    originalFilename: state.originalFilename,
    header: state.parsed.header,
    regions: state.parsed.availableRegions,
    totalGames: state.parsed.games.length,
    descriptor: state.parsed.descriptor,
    normalizedDescriptor: state.parsed.normalizedDescriptor,
    versionLabel: state.parsed.versionLabel
  };
}
