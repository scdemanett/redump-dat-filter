import type { DatHeader, FilterSummary } from './datParser';

export const IPC_CHANNELS = {
  openDat: 'dat:open',
  getCurrent: 'dat:get-current',
  previewFilter: 'dat:preview',
  saveFiltered: 'dat:save',
  loadFromPath: 'dat:load-path',
  listSystems: 'dat:list-systems',
  refreshSystems: 'dat:refresh-systems',
  checkUpdates: 'dat:check-updates',
  downloadSystem: 'dat:download-system'
} as const;

export const APP_UPDATE_CHANNELS = {
  getVersion: 'app:get-version',
  getStatus: 'app:get-update-status',
  checkForUpdates: 'app:check-for-updates',
  downloadUpdate: 'app:download-update',
  installUpdate: 'app:install-update',
  status: 'app:update-status'
} as const;

export type AppUpdateStatus =
  | { state: 'idle'; currentVersion?: string }
  | { state: 'disabled'; reason: string }
  | { state: 'checking' }
  | { state: 'unavailable'; currentVersion: string }
  | {
      state: 'available';
      currentVersion: string;
      latestVersion: string;
      releaseNotes?: string;
      releaseUrl?: string;
      autoInstallSupported: boolean;
    }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; latestVersion: string; autoInstallSupported: boolean }
  | { state: 'error'; message: string };

export interface LoadedDatPayload {
  filePath: string;
  originalFilename: string;
  header: DatHeader;
  regions: string[];
  totalGames: number;
  descriptor: string;
  normalizedDescriptor: string;
  versionLabel?: string;
}

export interface OpenDatResponse {
  canceled: boolean;
  error?: string;
  data?: LoadedDatPayload;
}

export interface LoadFromPathResponse {
  success: boolean;
  error?: string;
  data?: LoadedDatPayload;
}

export interface CurrentDatResponse {
  loaded: boolean;
  data?: LoadedDatPayload;
}

export interface FilterPreviewRequest {
  regions: string[];
}

export interface FilterPreviewResponse {
  success: boolean;
  error?: string;
  header?: DatHeader;
  summary?: FilterSummary;
  filename?: string;
}

export type DatVariant = 'standard' | 'serial';

export interface AppSettings {
  defaultRegions: string[];
  defaultSaveDir: string | null;
  showAllSystems: boolean;
  visibleSystemSlugs: string[];
  preferSerialVersion: boolean;
  systemDatVariants: Record<string, DatVariant>;
}

export interface GetSettingsResponse {
  settings: AppSettings;
  fromFile: boolean;
}

export interface SaveFilterRequest {
  regions: string[];
  targetPath?: string;
}

export interface SaveFilterResponse {
  success: boolean;
  canceled?: boolean;
  error?: string;
  savedPath?: string;
  header?: DatHeader;
  summary?: FilterSummary;
  filename?: string;
}

export type RedumpSystemListSource = 'live' | 'cache' | 'bundled';

export interface RedumpSystem {
  name: string;
  slug: string;
  downloaded?: boolean;
  updateAvailable?: boolean;
  cachedFilename?: string;
  hasSerialVersion?: boolean;
  hasCues?: boolean;
  hasSbi?: boolean;
}

export interface ListSystemsResponse {
  success: boolean;
  error?: string;
  systems?: RedumpSystem[];
  source?: RedumpSystemListSource;
  fetchedAt?: string;
}

export interface CheckUpdatesRequest {
  force?: boolean;
}

export interface CheckUpdatesResponse {
  success: boolean;
  error?: string;
  systems?: RedumpSystem[];
  source?: RedumpSystemListSource;
  fetchedAt?: string;
  updateCount?: number;
}

export interface DownloadSystemRequest {
  slug: string;
  force?: boolean;
  serialVersion?: boolean;
}

export interface DownloadSystemResponse {
  success: boolean;
  error?: string;
  data?: LoadedDatPayload;
  fromCache?: boolean;
}

export type ExtraDownloadKind = 'cues' | 'sbi';

export type DatLoadPhase = 'checking' | 'downloading' | 'extracting' | 'reading' | 'parsing';

export interface DatLoadProgress {
  phase: DatLoadPhase;
  percent?: number;
  message: string;
}

export interface DownloadExtraResponse {
  success: boolean;
  canceled?: boolean;
  error?: string;
  savedPath?: string;
  filename?: string;
}
