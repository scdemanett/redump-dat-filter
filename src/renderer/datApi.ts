import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type {
  AppSettings,
  AppUpdateStatus,
  CheckUpdatesResponse,
  CurrentDatResponse,
  DownloadSystemResponse,
  FilterPreviewResponse,
  GetSettingsResponse,
  ListSystemsResponse,
  LoadFromPathResponse,
  OpenDatResponse,
  SaveFilterResponse
} from '../shared';

export const datAPI = {
  ping: (): Promise<string> => invoke('ping'),

  openDat: (): Promise<OpenDatResponse> => invoke('open_dat'),

  loadDatFromPath: (filePath: string): Promise<LoadFromPathResponse> => {
    if (!filePath) {
      return Promise.resolve({ success: false, error: 'No file path provided.' });
    }
    return invoke('load_from_path', { filePath });
  },

  getCurrentDat: (): Promise<CurrentDatResponse> => invoke('get_current'),

  previewFilter: (regions: string[]): Promise<FilterPreviewResponse> =>
    invoke('preview_filter', { regions }),

  saveFiltered: (regions: string[], targetPath?: string): Promise<SaveFilterResponse> =>
    invoke('save_filtered', {
      regions,
      targetPath: targetPath ?? null
    }),

  getSettings: (): Promise<GetSettingsResponse> => invoke('get_settings'),

  saveSettings: (settings: AppSettings): Promise<AppSettings> => invoke('save_settings', { settings }),

  listSystems: (): Promise<ListSystemsResponse> => invoke('list_systems'),

  refreshSystems: (): Promise<ListSystemsResponse> => invoke('refresh_systems'),

  checkUpdates: (force?: boolean): Promise<CheckUpdatesResponse> =>
    invoke('check_updates', { force: Boolean(force) }),

  downloadSystem: (slug: string, force?: boolean): Promise<DownloadSystemResponse> =>
    invoke('download_system', {
      slug,
      force: Boolean(force)
    }),

  getAppVersion: (): Promise<string> => invoke('get_app_version'),

  getAppUpdateStatus: (): Promise<AppUpdateStatus> => invoke('get_app_update_status'),

  checkAppUpdates: (manual = true): Promise<AppUpdateStatus> =>
    invoke('check_for_updates', { manual }),

  downloadAppUpdate: (): Promise<AppUpdateStatus> => invoke('download_update'),

  installAppUpdate: (): Promise<AppUpdateStatus> => invoke('install_update'),

  onAppUpdateStatus: (callback: (status: AppUpdateStatus) => void): (() => void) => {
    let unlisten: UnlistenFn | undefined;
    void listen<AppUpdateStatus>('app:update-status', (event) => {
      callback(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }
};

export type DatAPI = typeof datAPI;
