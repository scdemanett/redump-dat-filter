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
}

export interface DownloadSystemResponse {
  success: boolean;
  error?: string;
  data?: LoadedDatPayload;
  fromCache?: boolean;
}
