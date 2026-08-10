import { contextBridge, ipcRenderer, webUtils } from 'electron';

import {
  IPC_CHANNELS,
  type CheckUpdatesResponse,
  type CurrentDatResponse,
  type DownloadSystemResponse,
  type FilterPreviewResponse,
  type ListSystemsResponse,
  type LoadFromPathResponse,
  type OpenDatResponse,
  type SaveFilterResponse
} from '../src/shared';

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),
  openDat: (): Promise<OpenDatResponse> => ipcRenderer.invoke(IPC_CHANNELS.openDat),
  loadDatFromPath: (filePath: string): Promise<LoadFromPathResponse> => {
    if (!filePath) {
      return Promise.resolve({ success: false, error: 'No file path provided.' });
    }
    return ipcRenderer.invoke(IPC_CHANNELS.loadFromPath, filePath);
  },
  resolveFilePath: (file: File): string | null => {
    try {
      return webUtils.getPathForFile(file) ?? null;
    } catch {
      return null;
    }
  },
  getCurrentDat: (): Promise<CurrentDatResponse> => ipcRenderer.invoke(IPC_CHANNELS.getCurrent),
  previewFilter: (regions: string[]): Promise<FilterPreviewResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.previewFilter, {
      regions
    }),
  saveFiltered: (regions: string[], targetPath?: string): Promise<SaveFilterResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.saveFiltered, {
      regions,
      targetPath
    }),
  listSystems: (): Promise<ListSystemsResponse> => ipcRenderer.invoke(IPC_CHANNELS.listSystems),
  refreshSystems: (): Promise<ListSystemsResponse> => ipcRenderer.invoke(IPC_CHANNELS.refreshSystems),
  checkUpdates: (force?: boolean): Promise<CheckUpdatesResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.checkUpdates, { force: Boolean(force) }),
  downloadSystem: (slug: string, force?: boolean): Promise<DownloadSystemResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.downloadSystem, {
      slug,
      force: Boolean(force)
    })
};

contextBridge.exposeInMainWorld('datAPI', api);

export type DatAPI = typeof api;

declare global {
  interface Window {
    datAPI: DatAPI;
  }
}
