import type { AppSettings } from '../shared';
import { datAPI } from './datApi';

export const DEFAULT_REGIONS = ['USA', 'World'];
const SELECTED_REGIONS_STORAGE_KEY = 'selectedRegions';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultRegions: [...DEFAULT_REGIONS],
  defaultSaveDir: null,
  showAllSystems: true,
  visibleSystemSlugs: []
};

export function filterVisibleSystems<T extends { slug: string }>(
  systems: T[],
  settings: Pick<AppSettings, 'showAllSystems' | 'visibleSystemSlugs'>
): T[] {
  if (settings.showAllSystems) {
    return systems;
  }
  const allowed = new Set(settings.visibleSystemSlugs);
  return systems.filter((system) => allowed.has(system.slug));
}

export function readLegacyStoredRegions(): string[] | null {
  try {
    const raw = localStorage.getItem(SELECTED_REGIONS_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === 'string')) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearLegacyStoredRegions(): void {
  try {
    localStorage.removeItem(SELECTED_REGIONS_STORAGE_KEY);
  } catch {
    // ignore storage access issues
  }
}

export async function loadAppSettings(): Promise<AppSettings> {
  const response = await datAPI.getSettings();
  let settings = response.settings;
  const legacy = readLegacyStoredRegions();

  if (!response.fromFile && legacy !== null) {
    settings = {
      ...settings,
      defaultRegions: legacy
    };
    await datAPI.saveSettings(settings);
  }

  clearLegacyStoredRegions();
  const visibleSystemSlugs = settings.visibleSystemSlugs ?? [];
  return {
    ...DEFAULT_APP_SETTINGS,
    ...settings,
    visibleSystemSlugs,
    showAllSystems: settings.showAllSystems ?? visibleSystemSlugs.length === 0
  };
}
