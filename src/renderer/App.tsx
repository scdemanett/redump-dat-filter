import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getCurrentWebview } from '@tauri-apps/api/webview';

import type {
  AppSettings,
  AppUpdateStatus,
  DatHeader,
  FilterSummary,
  LoadedDatPayload,
  RedumpSystem,
  RedumpSystemListSource
} from '../shared';
import appIconUrl from '../../build/icon.svg';
import { datAPI } from './datApi';
import { DEFAULT_APP_SETTINGS, filterVisibleSystems, loadAppSettings } from './settings';
import { SettingsModal, type ThemeMode } from './SettingsModal';
import { ContextCopyMenu } from './ContextCopyMenu';

const numberFormatter = new Intl.NumberFormat();

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

function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => readStoredTheme());
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const settingsRef = useRef(settings);
  const themeBeforeSettings = useRef(theme);
  settingsRef.current = settings;

  const hydrateLoadedDat = useCallback(
    (
      data: LoadedDatPayload,
      message?: string,
      options?: { systems?: RedumpSystem[]; preferSlug?: string }
    ) => {
      setLoadedDat(data);
      setSelectedRegions(resolveRegionSelection(data.regions, settingsRef.current.defaultRegions));
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
  }, [theme]);

  useEffect(() => {
    let cancelled = false;

    loadAppSettings()
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        settingsRef.current = loaded;
        setSettings(loaded);
        setSettingsReady(true);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setSettingsReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
    if (!settingsReady) {
      return;
    }

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
  }, [hydrateLoadedDat, settingsReady]);

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

  const visibleSystems = useMemo(
    () => filterVisibleSystems(systems, settings),
    [settings, systems]
  );

  const filteredSystems = useMemo(() => {
    const query = systemQuery.trim().toLowerCase();
    if (!query) {
      return visibleSystems;
    }
    return visibleSystems.filter(
      (system) =>
        system.name.toLowerCase().includes(query) || system.slug.toLowerCase().includes(query)
    );
  }, [systemQuery, visibleSystems]);

  const selectedSystem = useMemo(
    () => systems.find((system) => system.slug === selectedSlug) ?? null,
    [selectedSlug, systems]
  );

  const updateCount = useMemo(
    () => visibleSystems.filter((system) => system.updateAvailable).length,
    [visibleSystems]
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

      try {
        const latest = await datAPI.getSettings();
        settingsRef.current = latest.settings;
        setSettings(latest.settings);
      } catch {
        // keep in-memory settings if refresh fails
      }
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

  const persistTheme = useCallback((nextTheme: ThemeMode) => {
    try {
      localStorage.setItem('theme', nextTheme);
    } catch {
      // ignore storage access issues
    }
  }, []);

  const handleOpenSettings = useCallback(() => {
    themeBeforeSettings.current = theme;
    setSettingsOpen(true);
  }, [theme]);

  const handleCloseSettings = useCallback(() => {
    setTheme(themeBeforeSettings.current);
    setSettingsOpen(false);
  }, []);

  const handleSaveSettings = useCallback(
    async (next: AppSettings) => {
      const saved = await datAPI.saveSettings(next);
      settingsRef.current = saved;
      setSettings(saved);
      persistTheme(theme);
      themeBeforeSettings.current = theme;
      if (loadedDat) {
        setSelectedRegions(resolveRegionSelection(loadedDat.regions, saved.defaultRegions));
      }
      if (
        !saved.showAllSystems &&
        selectedSlug &&
        !saved.visibleSystemSlugs.includes(selectedSlug)
      ) {
        setSelectedSlug('');
      }
      setSettingsOpen(false);
    },
    [loadedDat, persistTheme, selectedSlug, theme]
  );

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
            <button
              type="button"
              className="icon-button"
              onClick={handleOpenSettings}
              aria-label="Settings"
              title="Settings"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
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
                  : `${numberFormatter.format(visibleSystems.length)}${
                      settings.showAllSystems
                        ? ''
                        : ` of ${numberFormatter.format(systems.length)}`
                    } systems · source: ${systemsSource ?? '—'}${
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
                  disabled={systemsLoading || visibleSystems.length === 0}
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
              <header className="panel-header panel-header--stacked">
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
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          systems={systems}
          systemsLoading={systemsLoading}
          theme={theme}
          onThemeChange={setTheme}
          onSave={handleSaveSettings}
          onClose={handleCloseSettings}
        />
      )}
      <ContextCopyMenu />
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

function resolveRegionSelection(availableRegions: string[], defaultRegions: string[]): string[] {
  const available = new Set(availableRegions);
  if (defaultRegions.length === 0) {
    return [];
  }
  return defaultRegions.filter((region) => available.has(region));
}

export default App;
