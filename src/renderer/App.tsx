import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getCurrentWebview } from '@tauri-apps/api/webview';

import type {
  AppUpdateStatus,
  DatHeader,
  FilterSummary,
  LoadedDatPayload,
  RedumpSystem,
  RedumpSystemListSource
} from '../shared';
import appIconUrl from '../../build/icon.svg';
import { datAPI } from './datApi';

const numberFormatter = new Intl.NumberFormat();
const preferredDefaultRegions = ['USA', 'World'];
const SELECTED_REGIONS_STORAGE_KEY = 'selectedRegions';
type ThemeMode = 'dark' | 'light';

function readStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    // ignore storage access issues
  }
  return 'dark';
}

function readStoredRegions(): string[] | null {
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

function writeStoredRegions(regions: string[]): void {
  try {
    localStorage.setItem(SELECTED_REGIONS_STORAGE_KEY, JSON.stringify(regions));
  } catch {
    // ignore storage access issues
  }
}

function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => readStoredTheme());
  const [loadedDat, setLoadedDat] = useState<LoadedDatPayload | null>(null);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [previewHeader, setPreviewHeader] = useState<DatHeader | null>(null);
  const [previewSummary, setPreviewSummary] = useState<FilterSummary | null>(null);
  const [previewFilename, setPreviewFilename] = useState<string | null>(null);

  const [opening, setOpening] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const [systems, setSystems] = useState<RedumpSystem[]>([]);
  const [systemsSource, setSystemsSource] = useState<RedumpSystemListSource | null>(null);
  const [systemsFetchedAt, setSystemsFetchedAt] = useState<string | undefined>();
  const [systemsLoading, setSystemsLoading] = useState(true);
  const [systemsRefreshing, setSystemsRefreshing] = useState(false);
  const [updatesChecking, setUpdatesChecking] = useState(false);
  const [systemQuery, setSystemQuery] = useState('');
  const [selectedSlug, setSelectedSlug] = useState('');
  const [systemPickerOpen, setSystemPickerOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [appUpdateStatus, setAppUpdateStatus] = useState<AppUpdateStatus>({ state: 'idle' });
  const [appUpdateBusy, setAppUpdateBusy] = useState(false);
  const [appUpdateBannerDismissed, setAppUpdateBannerDismissed] = useState(false);

  const previewRequestId = useRef(0);
  const systemPickerRef = useRef<HTMLDivElement | null>(null);
  const systemSearchRef = useRef<HTMLInputElement | null>(null);

  const hydrateLoadedDat = useCallback(
    (
      data: LoadedDatPayload,
      message?: string,
      options?: { systems?: RedumpSystem[]; preferSlug?: string }
    ) => {
      setLoadedDat(data);
      setSelectedRegions(resolveRegionSelection(data.regions));
      setPreviewHeader(null);
      setPreviewSummary(null);
      setPreviewFilename(null);
      setInfo(message ?? `Loaded ${data.originalFilename}`);
      setError(null);

      if (options?.preferSlug) {
        setSelectedSlug(options.preferSlug);
        return;
      }

      const matched = matchSystemForDat(data, options?.systems ?? systems);
      setSelectedSlug(matched?.slug ?? '');
    },
    [systems]
  );

  const applySystemsResponse = useCallback(
    (response: {
      systems?: RedumpSystem[];
      source?: RedumpSystemListSource;
      fetchedAt?: string;
    }) => {
      if (response.systems) {
        setSystems(response.systems);
      }
      if (response.source) {
        setSystemsSource(response.source);
      }
      setSystemsFetchedAt(response.fetchedAt);
    },
    []
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // ignore storage access issues
    }
  }, [theme]);

  useEffect(() => {
    if (!loadedDat || systems.length === 0 || selectedSlug) {
      return;
    }
    const matched = matchSystemForDat(loadedDat, systems);
    if (matched) {
      setSelectedSlug(matched.slug);
    }
  }, [loadedDat, systems, selectedSlug]);

  useEffect(() => {
    if (!loadedDat) {
      return;
    }
    writeStoredRegions(selectedRegions);
  }, [loadedDat, selectedRegions]);

  useEffect(() => {
    datAPI
      .getCurrentDat()
      .then((response) => {
        if (response.loaded && response.data) {
          hydrateLoadedDat(response.data);
        }
      })
      .catch((err) => {
        console.error(err);
        setError(`Failed to restore previous session: ${extractMessage(err)}`);
      });
  }, [hydrateLoadedDat]);

  useEffect(() => {
    let cancelled = false;

    async function loadSystemsAndUpdates() {
      setSystemsLoading(true);
      try {
        const list = await datAPI.listSystems();
        if (cancelled) {
          return;
        }
        if (!list.success) {
          setError(list.error ?? 'Failed to load Redump systems.');
        } else {
          applySystemsResponse(list);
        }

        setUpdatesChecking(true);
        const updates = await datAPI.checkUpdates(false);
        if (cancelled) {
          return;
        }
        if (updates.success) {
          applySystemsResponse(updates);
          if ((updates.updateCount ?? 0) > 0) {
            setInfo(
              `${updates.updateCount} downloaded DAT${updates.updateCount === 1 ? '' : 's'} have updates available.`
            );
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          setError(`Failed to load Redump systems: ${extractMessage(err)}`);
        }
      } finally {
        if (!cancelled) {
          setSystemsLoading(false);
          setUpdatesChecking(false);
        }
      }
    }

    void loadSystemsAndUpdates();
    return () => {
      cancelled = true;
    };
  }, [applySystemsResponse]);

  useEffect(() => {
    let cancelled = false;

    async function loadAppUpdateState() {
      try {
        const [version, status] = await Promise.all([
          datAPI.getAppVersion(),
          datAPI.getAppUpdateStatus()
        ]);
        if (!cancelled) {
          setAppVersion(version);
          setAppUpdateStatus(status);
        }
      } catch {
        // ignore update bootstrap errors
      }
    }

    void loadAppUpdateState();
    const unsubscribe = datAPI.onAppUpdateStatus((status) => {
      if (!cancelled) {
        setAppUpdateStatus(status);
        if (status.state === 'available' || status.state === 'downloaded') {
          setAppUpdateBannerDismissed(false);
        }
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const dismissAppUpdateBanner = useCallback(() => {
    setAppUpdateBannerDismissed(true);
  }, []);

  const handleCheckAppUpdates = useCallback(async () => {
    setAppUpdateBannerDismissed(false);
    setAppUpdateBusy(true);
    try {
      const status = await datAPI.checkAppUpdates(true);
      setAppUpdateStatus(status);
    } catch (err) {
      setAppUpdateStatus({
        state: 'error',
        message: extractMessage(err)
      });
    } finally {
      setAppUpdateBusy(false);
    }
  }, []);

  const handleDownloadAppUpdate = useCallback(async () => {
    setAppUpdateBusy(true);
    try {
      const status = await datAPI.downloadAppUpdate();
      setAppUpdateStatus(status);
    } catch (err) {
      setAppUpdateStatus({
        state: 'error',
        message: extractMessage(err)
      });
    } finally {
      setAppUpdateBusy(false);
    }
  }, []);

  const handleInstallAppUpdate = useCallback(async () => {
    try {
      await datAPI.installAppUpdate();
    } catch (err) {
      setAppUpdateStatus({
        state: 'error',
        message: extractMessage(err)
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (cancelled) {
          return;
        }

        if (event.payload.type === 'over' || event.payload.type === 'enter') {
          setIsDragActive(true);
          return;
        }

        if (event.payload.type === 'leave') {
          setIsDragActive(false);
          return;
        }

        if (event.payload.type !== 'drop') {
          return;
        }

        setIsDragActive(false);
        const path = event.payload.paths.find((candidate) => /\.(dat|xml)$/i.test(candidate));
        if (!path) {
          setError('Only .dat or .xml files can be dropped.');
          return;
        }

        setOpening(true);
        setSaving(false);
        setInfo(null);
        setError(null);

        void datAPI
          .loadDatFromPath(path)
          .then((response) => {
            if (!response.success) {
              setError(response.error ?? 'Failed to load DAT file.');
              return;
            }
            if (response.data) {
              hydrateLoadedDat(response.data);
            }
          })
          .catch((err) => {
            setError(`Failed to load DAT file: ${extractMessage(err)}`);
          })
          .finally(() => {
            setOpening(false);
          });
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        console.error('Failed to register drag-drop listener', err);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [hydrateLoadedDat]);

  useEffect(() => {
    if (!systemPickerOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!systemPickerRef.current?.contains(event.target as Node)) {
        setSystemPickerOpen(false);
        setSystemQuery('');
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSystemPickerOpen(false);
        setSystemQuery('');
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [systemPickerOpen]);

  useEffect(() => {
    if (systemPickerOpen) {
      systemSearchRef.current?.focus();
    }
  }, [systemPickerOpen]);

  useEffect(() => {
    if (!loadedDat) {
      setPreviewHeader(null);
      setPreviewSummary(null);
      setPreviewFilename(null);
      setPreviewLoading(false);
      return;
    }

    const requestId = ++previewRequestId.current;
    setPreviewLoading(true);

    datAPI
      .previewFilter(selectedRegions)
      .then((response) => {
        if (previewRequestId.current !== requestId) {
          return;
        }

        if (response.success && response.summary && response.header) {
          setPreviewHeader(response.header);
          setPreviewSummary(response.summary);
          setPreviewFilename(response.filename ?? null);
          setError(null);
        } else {
          setPreviewHeader(null);
          setPreviewSummary(null);
          setPreviewFilename(null);
          setError(response.error ?? 'Unable to preview filtered DAT.');
        }
      })
      .catch((err) => {
        if (previewRequestId.current !== requestId) {
          return;
        }
        setPreviewHeader(null);
        setPreviewSummary(null);
        setPreviewFilename(null);
        setError(`Failed to preview filtered DAT: ${extractMessage(err)}`);
      })
      .finally(() => {
        if (previewRequestId.current === requestId) {
          setPreviewLoading(false);
        }
      });
  }, [loadedDat, selectedRegions]);

  const filteredSystems = useMemo(() => {
    const query = systemQuery.trim().toLowerCase();
    if (!query) {
      return systems;
    }
    return systems.filter(
      (system) =>
        system.name.toLowerCase().includes(query) || system.slug.toLowerCase().includes(query)
    );
  }, [systemQuery, systems]);

  const selectedSystem = useMemo(
    () => systems.find((system) => system.slug === selectedSlug) ?? null,
    [selectedSlug, systems]
  );

  const updateCount = useMemo(
    () => systems.filter((system) => system.updateAvailable).length,
    [systems]
  );

  const handleOpenDat = useCallback(async () => {
    setOpening(true);
    setSaving(false);
    setInfo(null);
    setError(null);

    try {
      const response = await datAPI.openDat();
      if (response.canceled) {
        return;
      }

      if (response.error) {
        setError(response.error);
        return;
      }

      if (response.data) {
        hydrateLoadedDat(response.data);
      }
    } catch (err) {
      setError(`Failed to open DAT file: ${extractMessage(err)}`);
    } finally {
      setOpening(false);
    }
  }, [hydrateLoadedDat]);

  const handleRefreshSystems = useCallback(async () => {
    setSystemsRefreshing(true);
    setError(null);
    try {
      const response = await datAPI.refreshSystems();
      if (response.systems) {
        applySystemsResponse(response);
      }
      if (!response.success) {
        setError(response.error ?? 'Failed to refresh Redump systems.');
        return;
      }
      setInfo(`System list updated (${response.systems?.length ?? 0} systems).`);
    } catch (err) {
      setError(`Failed to refresh Redump systems: ${extractMessage(err)}`);
    } finally {
      setSystemsRefreshing(false);
    }
  }, [applySystemsResponse]);

  const handleCheckUpdates = useCallback(async () => {
    setUpdatesChecking(true);
    setError(null);
    try {
      const response = await datAPI.checkUpdates(true);
      if (!response.success) {
        setError(response.error ?? 'Failed to check for DAT updates.');
        return;
      }
      applySystemsResponse(response);
      const count = response.updateCount ?? 0;
      setInfo(
        count > 0
          ? `${count} downloaded DAT${count === 1 ? '' : 's'} have updates available.`
          : 'All downloaded DATs are up to date.'
      );
    } catch (err) {
      setError(`Failed to check for DAT updates: ${extractMessage(err)}`);
    } finally {
      setUpdatesChecking(false);
    }
  }, [applySystemsResponse]);

  const handleDownloadSystem = useCallback(
    async (force: boolean) => {
      if (!selectedSlug) {
        return;
      }

      setDownloading(true);
      setError(null);
      setInfo(null);

      try {
        const response = await datAPI.downloadSystem(selectedSlug, force);
        if (!response.success || !response.data) {
          setError(response.error ?? 'Failed to download Redump DAT.');
          return;
        }

        const message = response.fromCache
          ? `Loaded cached ${response.data.originalFilename}`
          : `Downloaded ${response.data.originalFilename}`;
        hydrateLoadedDat(response.data, message, { preferSlug: selectedSlug });

        const refreshed = await datAPI.listSystems();
        if (refreshed.success) {
          applySystemsResponse(refreshed);
        }
      } catch (err) {
        setError(`Failed to download Redump DAT: ${extractMessage(err)}`);
      } finally {
        setDownloading(false);
      }
    },
    [applySystemsResponse, hydrateLoadedDat, selectedSlug]
  );

  const handleToggleRegion = useCallback((region: string) => {
    setSelectedRegions((current) =>
      current.includes(region) ? current.filter((value) => value !== region) : [...current, region]
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    if (loadedDat) {
      setSelectedRegions(loadedDat.regions);
    }
  }, [loadedDat]);

  const handleClearSelection = useCallback(() => {
    setSelectedRegions([]);
  }, []);

  const handleSaveFiltered = useCallback(async () => {
    if (!loadedDat) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await datAPI.saveFiltered(selectedRegions);
      if (!response.success) {
        if (response.canceled) {
          setInfo('Save cancelled.');
          return;
        }
        setError(response.error ?? 'Failed to save filtered DAT file.');
        return;
      }

      const destination = response.filename ?? response.savedPath ?? 'filtered.dat';
      setInfo(`Filtered DAT saved as ${destination}`);
    } catch (err) {
      setError(`Failed to save filtered DAT file: ${extractMessage(err)}`);
    } finally {
      setSaving(false);
    }
  }, [loadedDat, selectedRegions]);

  const regionLabel = useMemo(() => {
    if (!selectedRegions.length) {
      return 'All regions';
    }
    return selectedRegions.join(', ');
  }, [selectedRegions]);

  const canPreview = !!loadedDat;
  const canSave = !!previewSummary && !previewLoading && !saving;
  const downloadLabel = selectedSystem?.downloaded
    ? selectedSystem.updateAvailable
      ? 'Download update'
      : 'Load'
    : 'Download & Load';

  const appUpdateMessage = useMemo(() => {
    switch (appUpdateStatus.state) {
      case 'checking':
        return 'Checking for app updates…';
      case 'unavailable':
        return `You're on the latest app version (v${appUpdateStatus.currentVersion}).`;
      case 'available':
        return `App update available: v${appUpdateStatus.latestVersion} (current v${appUpdateStatus.currentVersion}).`;
      case 'downloading':
        return `Downloading app update… ${Math.round(appUpdateStatus.percent)}%`;
      case 'downloaded':
        return `App update v${appUpdateStatus.latestVersion} downloaded. Restart to install.`;
      case 'error':
        return `App update check failed: ${appUpdateStatus.message}`;
      case 'disabled':
        return appUpdateStatus.reason;
      default:
        return null;
    }
  }, [appUpdateStatus]);

  const showAppUpdateActions =
    appUpdateStatus.state === 'available' ||
    appUpdateStatus.state === 'downloaded' ||
    appUpdateStatus.state === 'idle' ||
    appUpdateStatus.state === 'unavailable' ||
    appUpdateStatus.state === 'error';

  const showAppUpdateBanner =
    !appUpdateBannerDismissed &&
    appUpdateMessage &&
    appUpdateStatus.state !== 'idle' &&
    appUpdateStatus.state !== 'disabled';

  const canDismissAppUpdateBanner =
    appUpdateStatus.state !== 'checking' && appUpdateStatus.state !== 'downloading';

  return (
    <main className={`app-shell ${isDragActive ? 'drag-active' : ''}`}>
      <div className="app-container">
        <header className="app-header">
          <div className="app-header__brand">
            <img className="app-header__logo" src={appIconUrl} alt="" width={96} height={96} />
            <div>
              <h1>Redump DAT Filter</h1>
              <p>Filter Redump DAT collections by region and export a trimmed datafile.</p>
              {appVersion && (
                <p className="app-version">
                  App version v{appVersion}
                  {' · '}
                  <button
                    type="button"
                    className="link-button"
                    onClick={handleCheckAppUpdates}
                    disabled={appUpdateBusy || appUpdateStatus.state === 'checking'}
                  >
                    {appUpdateBusy || appUpdateStatus.state === 'checking'
                      ? 'Checking for updates…'
                      : 'Check for app updates'}
                  </button>
                </p>
              )}
            </div>
          </div>
          <div className="header-actions">
            <div className="theme-toggle" role="group" aria-label="Color theme">
              <button
                type="button"
                className={`theme-toggle__option ${theme === 'light' ? 'is-active' : ''}`}
                onClick={() => setTheme('light')}
                aria-pressed={theme === 'light'}
                title="Light theme"
              >
                <svg className="theme-toggle__icon" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" fill="currentColor" />
                  <path
                    d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                  />
                </svg>
                <span>Light</span>
              </button>
              <button
                type="button"
                className={`theme-toggle__option ${theme === 'dark' ? 'is-active' : ''}`}
                onClick={() => setTheme('dark')}
                aria-pressed={theme === 'dark'}
                title="Dark theme"
              >
                <svg className="theme-toggle__icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 7 7 0 1 0 20.5 14.2Z"
                    fill="currentColor"
                  />
                </svg>
                <span>Dark</span>
              </button>
            </div>
            <button type="button" className="button" onClick={handleOpenDat} disabled={opening || downloading}>
              {opening ? 'Opening…' : 'Open DAT'}
            </button>
            <button type="button" className="button ghost" onClick={handleSaveFiltered} disabled={!canSave}>
              {saving ? 'Saving…' : 'Save Filtered DAT'}
            </button>
          </div>
        </header>

        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}

        {info && !error && (
          <div className="alert success" role="status">
            {info}
          </div>
        )}

        {showAppUpdateBanner && (
          <div
            className={`alert app-update ${appUpdateStatus.state === 'error' ? 'error' : 'info'}`}
            role={appUpdateStatus.state === 'error' ? 'alert' : 'status'}
          >
            <div className="app-update__message">{appUpdateMessage}</div>
            {showAppUpdateActions && (
              <div className="app-update__actions">
                {canDismissAppUpdateBanner && (
                  <button type="button" className="button ghost" onClick={dismissAppUpdateBanner}>
                    Dismiss
                  </button>
                )}
                {(appUpdateStatus.state === 'available' ||
                  appUpdateStatus.state === 'unavailable' ||
                  appUpdateStatus.state === 'error') && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={handleCheckAppUpdates}
                    disabled={appUpdateBusy}
                  >
                    Check Again
                  </button>
                )}
                {appUpdateStatus.state === 'available' && (
                  <button
                    type="button"
                    className="button"
                    onClick={handleDownloadAppUpdate}
                    disabled={appUpdateBusy}
                  >
                    {appUpdateStatus.autoInstallSupported ? 'Download Update' : 'View Release'}
                  </button>
                )}
                {appUpdateStatus.state === 'downloaded' && appUpdateStatus.autoInstallSupported && (
                  <button type="button" className="button" onClick={handleInstallAppUpdate}>
                    Restart and install
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <section className={`panel redump-panel ${systemPickerOpen ? 'is-picker-open' : ''}`}>
          <header className="panel-header">
            <div>
              <h3>Download from Redump</h3>
              <p className="panel-description redump-meta">
                {systemsLoading
                  ? 'Loading system list…'
                  : `${numberFormatter.format(systems.length)} systems · source: ${systemsSource ?? '—'}${
                      systemsFetchedAt ? ` · ${formatFetchedAt(systemsFetchedAt)}` : ''
                    }`}
                {updateCount > 0 ? ` · ${updateCount} update${updateCount === 1 ? '' : 's'} available` : ''}
                {updatesChecking ? ' · checking updates…' : ''}
              </p>
            </div>
            <div className="panel-actions">
              <button
                type="button"
                className="button secondary"
                onClick={handleRefreshSystems}
                disabled={systemsRefreshing || systemsLoading}
              >
                {systemsRefreshing ? 'Refreshing…' : 'Refresh Systems'}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={handleCheckUpdates}
                disabled={updatesChecking || systemsLoading}
              >
                {updatesChecking ? 'Checking…' : 'Check Updates'}
              </button>
            </div>
          </header>

          <div className="redump-controls">
            <div className="field field-grow" ref={systemPickerRef}>
              <span className="field-label">System</span>
              <div className={`system-combobox ${systemPickerOpen ? 'is-open' : ''}`}>
                <button
                  type="button"
                  className="system-combobox__trigger"
                  aria-haspopup="listbox"
                  aria-expanded={systemPickerOpen}
                  disabled={systemsLoading || systems.length === 0}
                  onClick={() => {
                    setSystemPickerOpen((open) => {
                      const next = !open;
                      if (!next) {
                        setSystemQuery('');
                      }
                      return next;
                    });
                  }}
                >
                  <span
                    className={`system-combobox__value ${selectedSystem ? '' : 'is-placeholder'}`}
                  >
                    {selectedSystem ? formatSystemOption(selectedSystem) : 'Select a system…'}
                  </span>
                  <span className="system-combobox__chevron" aria-hidden>
                    {systemPickerOpen ? '▴' : '▾'}
                  </span>
                </button>

                {systemPickerOpen && (
                  <div className="system-combobox__panel" role="listbox">
                    <input
                      ref={systemSearchRef}
                      type="search"
                      className="system-combobox__search"
                      value={systemQuery}
                      onChange={(event) => setSystemQuery(event.target.value)}
                      placeholder="Search systems…"
                      aria-label="Search systems"
                    />
                    {filteredSystems.length === 0 ? (
                      <p className="system-combobox__empty">No systems match your search.</p>
                    ) : (
                      <ul className="system-combobox__list">
                        {filteredSystems.map((system) => {
                          const selected = system.slug === selectedSlug;
                          const badge = system.updateAvailable
                            ? 'update'
                            : system.downloaded
                              ? 'cached'
                              : null;
                          return (
                            <li key={system.slug}>
                              <button
                                type="button"
                                className={`system-combobox__option ${selected ? 'is-selected' : ''}`}
                                role="option"
                                aria-selected={selected}
                                onClick={() => {
                                  setSelectedSlug(system.slug);
                                  setSystemPickerOpen(false);
                                  setSystemQuery('');
                                }}
                              >
                                <span>{system.name}</span>
                                {badge && (
                                  <span
                                    className={`system-combobox__badge ${
                                      badge === 'update' ? 'is-update' : ''
                                    }`}
                                  >
                                    {badge}
                                  </span>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="redump-actions">
              <button
                type="button"
                className="button"
                onClick={() => handleDownloadSystem(false)}
                disabled={!selectedSlug || downloading || opening}
              >
                {downloading ? 'Working…' : downloadLabel}
              </button>
              <button
                type="button"
                className="button ghost"
                onClick={() => handleDownloadSystem(true)}
                disabled={!selectedSlug || downloading || opening}
                title="Force re-download from Redump"
              >
                Force Refresh
              </button>
            </div>
          </div>

          {selectedSystem && (
            <p className="redump-selection-hint">
              {selectedSystem.updateAvailable
                ? 'Update available for this system’s cached DAT.'
                : selectedSystem.downloaded
                  ? 'Cached DAT available — Load will HEAD-check then reuse cache if unchanged.'
                  : 'Selection alone does not download. Click Download & load to fetch and filter.'}
            </p>
          )}
        </section>

        {loadedDat ? (
          <>
            <section className="panel">
              <header className="panel-header">
                <h2>{loadedDat.header.name}</h2>
                <div className="panel-meta">
                  <span>Source: {loadedDat.originalFilename}</span>
                  <span>Total entries: {numberFormatter.format(loadedDat.totalGames)}</span>
                  {loadedDat.versionLabel && <span>Version: {loadedDat.versionLabel}</span>}
                </div>
              </header>
              <p className="panel-description">
                Choose one or more regions below. The preview automatically recalculates totals and the generated file
                name using the current filters.
              </p>
            </section>

            <section className="panel">
              <header className="panel-header">
                <h3>Region Filters</h3>
                <div className="panel-actions">
                  <button type="button" className="button secondary" onClick={handleSelectAll}>
                    Select All
                  </button>
                  <button type="button" className="button secondary" onClick={handleClearSelection}>
                    Clear
                  </button>
                </div>
              </header>

              <div className="regions-grid">
                {loadedDat.regions.map((region) => {
                  const checked = selectedRegions.includes(region);
                  return (
                    <label key={region} className={`region-item ${checked ? 'selected' : ''}`}>
                      <input
                        type="checkbox"
                        value={region}
                        checked={checked}
                        onChange={() => handleToggleRegion(region)}
                      />
                      <span>{region}</span>
                    </label>
                  );
                })}
              </div>
            </section>

            <section className="panel">
              <header className="panel-header">
                <h3>Preview</h3>
                <span className="preview-status">{previewLoading ? 'Calculating…' : regionLabel}</span>
              </header>

              {canPreview ? (
                previewSummary && previewHeader ? (
                  <div className="preview-content">
                    <div className="preview-grid">
                      <div>
                        <p className="preview-heading">Filtered Description</p>
                        <p className="preview-text">{previewHeader.description ?? previewHeader.name}</p>
                      </div>
                      <div>
                        <p className="preview-heading">Suggested Filename</p>
                        <p className="preview-text monospace">{previewFilename ?? 'filtered.dat'}</p>
                      </div>
                    </div>
                    <ul className="preview-stats">
                      <li>
                        <span className="stat-label">Matched entries</span>
                        <span className="stat-value">{numberFormatter.format(previewSummary.filteredGames)}</span>
                      </li>
                      <li>
                        <span className="stat-label">Removed entries</span>
                        <span className="stat-value">{numberFormatter.format(previewSummary.removedGames)}</span>
                      </li>
                      <li>
                        <span className="stat-label">Total in source</span>
                        <span className="stat-value">{numberFormatter.format(previewSummary.initialGames)}</span>
                      </li>
                    </ul>
                  </div>
                ) : (
                  <p className="placeholder">
                    {previewLoading
                      ? 'Generating preview…'
                      : 'Select one or more regions to see preview totals and filename.'}
                  </p>
                )
              ) : (
                <p className="placeholder">Load a DAT file to begin filtering.</p>
              )}
            </section>
          </>
        ) : (
          <section className="panel empty">
            <h2>No DAT Loaded</h2>
            <p>
              Download a system from Redump above, or use “Open DAT” / drag-and-drop to load a local Redump DAT file.
            </p>
          </section>
        )}
      </div>
      {isDragActive && (
        <div className="drop-overlay">
          <div className="drop-overlay__content">
            <p>Drop DAT file to load</p>
          </div>
        </div>
      )}
    </main>
  );
}

function formatSystemOption(system: RedumpSystem): string {
  const flags: string[] = [];
  if (system.updateAvailable) {
    flags.push('update');
  } else if (system.downloaded) {
    flags.push('cached');
  }
  return flags.length > 0 ? `${system.name} (${flags.join(', ')})` : system.name;
}

function formatFetchedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `as of ${date.toLocaleString()}`;
}

function normalizeSystemLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function matchSystemForDat(
  data: LoadedDatPayload,
  systems: RedumpSystem[]
): RedumpSystem | undefined {
  if (systems.length === 0) {
    return undefined;
  }

  const pathSlugMatch = /(?:^|[\\/])dats[\\/]([^\\/]+)[\\/]/i.exec(data.filePath);
  if (pathSlugMatch?.[1]) {
    const pathSlug = pathSlugMatch[1];
    const byPath = systems.find((system) => system.slug === pathSlug);
    if (byPath) {
      return byPath;
    }
  }

  const headerLabel = normalizeSystemLabel(data.header.name);
  const filenameLabel = normalizeSystemLabel(
    data.originalFilename.replace(/\.(dat|xml)$/i, '')
  );

  const exactHeader = systems.find(
    (system) => normalizeSystemLabel(system.name) === headerLabel
  );
  if (exactHeader) {
    return exactHeader;
  }

  const scored = systems
    .map((system) => {
      const systemLabel = normalizeSystemLabel(system.name);
      let score = 0;
      if (headerLabel === systemLabel) {
        score = 100;
      } else if (headerLabel.includes(systemLabel) || systemLabel.includes(headerLabel)) {
        score = Math.min(headerLabel.length, systemLabel.length);
      } else if (
        filenameLabel.includes(systemLabel) ||
        systemLabel.includes(filenameLabel.split(' datfile')[0]?.trim() ?? '')
      ) {
        score = Math.min(filenameLabel.length, systemLabel.length) / 2;
      }
      return { system, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.system;
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function resolveRegionSelection(availableRegions: string[]): string[] {
  const available = new Set(availableRegions);
  const stored = readStoredRegions();

  if (stored !== null) {
    if (stored.length === 0) {
      return [];
    }
    const matched = stored.filter((region) => available.has(region));
    if (matched.length > 0) {
      return matched;
    }
  }

  return preferredDefaultRegions.filter((region) => available.has(region));
}

export default App;
