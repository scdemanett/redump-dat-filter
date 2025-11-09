import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import type { IpcMainInvokeEvent, OpenDialogOptions, SaveDialogOptions } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  filterDatByRegions,
  parseDat,
  type FilteredDatResult,
  type ParsedDat,
  IPC_CHANNELS,
  type CurrentDatResponse,
  type FilterPreviewRequest,
  type FilterPreviewResponse,
  type LoadedDatPayload,
  type LoadFromPathResponse,
  type OpenDatResponse,
  type SaveFilterRequest,
  type SaveFilterResponse
} from '../src/shared';

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

const createMainWindow = async () => {
  const browserWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  });

  browserWindow.once('ready-to-show', () => {
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
  registerIpcHandlers();

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
}

function unregisterIpcHandlers() {
  ipcMain.removeHandler('ping');
  ipcMain.removeHandler(IPC_CHANNELS.openDat);
  ipcMain.removeHandler(IPC_CHANNELS.loadFromPath);
  ipcMain.removeHandler(IPC_CHANNELS.getCurrent);
  ipcMain.removeHandler(IPC_CHANNELS.previewFilter);
  ipcMain.removeHandler(IPC_CHANNELS.saveFiltered);
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

