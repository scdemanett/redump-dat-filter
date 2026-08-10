import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';

import type {
  DatHeader,
  FilterSummary,
  LoadedDatPayload,
  RedumpSystem,
  RedumpSystemListSource
} from '../shared';

const numberFormatter = new Intl.NumberFormat();
const preferredDefaultRegions = ['USA', 'World'];

function App() {
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

  const previewRequestId = useRef(0);
  const systemPickerRef = useRef<HTMLDivElement | null>(null);
  const systemSearchRef = useRef<HTMLInputElement | null>(null);

  const hydrateLoadedDat = useCallback((data: LoadedDatPayload, message?: string) => {
    setLoadedDat(data);
    const defaults = pickDefaultRegions(data.regions);
    setSelectedRegions(defaults);
    setPreviewHeader(null);
    setPreviewSummary(null);
    setPreviewFilename(null);
    setInfo(message ?? `Loaded ${data.originalFilename}`);
    setError(null);
  }, []);

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
    window.datAPI
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
        const list = await window.datAPI.listSystems();
        if (cancelled) {
          return;
        }
        if (!list.success) {
          setError(list.error ?? 'Failed to load Redump systems.');
        } else {
          applySystemsResponse(list);
        }

        setUpdatesChecking(true);
        const updates = await window.datAPI.checkUpdates(false);
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
    const preventDefault = (event: DragEvent) => {
      event.preventDefault();
    };

    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', preventDefault);

    return () => {
      window.removeEventListener('dragover', preventDefault);
      window.removeEventListener('drop', preventDefault);
    };
  }, []);

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

    window.datAPI
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
      const response = await window.datAPI.openDat();
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
      const response = await window.datAPI.refreshSystems();
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
      const response = await window.datAPI.checkUpdates(true);
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
        const response = await window.datAPI.downloadSystem(selectedSlug, force);
        if (!response.success || !response.data) {
          setError(response.error ?? 'Failed to download Redump DAT.');
          return;
        }

        const message = response.fromCache
          ? `Loaded cached ${response.data.originalFilename}`
          : `Downloaded ${response.data.originalFilename}`;
        hydrateLoadedDat(response.data, message);

        const refreshed = await window.datAPI.listSystems();
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
      const response = await window.datAPI.saveFiltered(selectedRegions);
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

  const handleDragEnter = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const hasFiles = hasFilePayload(event.dataTransfer);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = hasFiles ? 'copy' : 'none';
    }
    setIsDragActive(hasFiles);
  }, []);

  const handleDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const hasFiles = hasFilePayload(event.dataTransfer);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = hasFiles ? 'copy' : 'none';
    }
    if (hasFiles) {
      setIsDragActive(true);
    }
  }, []);

  const handleDragLeave = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setIsDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const filePath = extractDatPath(event.dataTransfer);
      setIsDragActive(false);

      if (!filePath) {
        setError('Only .dat or .xml files can be dropped.');
        return;
      }

      setOpening(true);
      setSaving(false);
      setInfo(null);
      setError(null);

      try {
        const response = await window.datAPI.loadDatFromPath(filePath);
        if (!response.success) {
          setError(response.error ?? 'Failed to load DAT file.');
          return;
        }

        if (response.data) {
          hydrateLoadedDat(response.data);
        }
      } catch (err) {
        setError(`Failed to load DAT file: ${extractMessage(err)}`);
      } finally {
        setOpening(false);
      }
    },
    [hydrateLoadedDat]
  );

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
    : 'Download & load';

  return (
    <main
      className={`app-shell ${isDragActive ? 'drag-active' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="app-container">
        <header className="app-header">
          <div>
            <h1>Redump DAT Filter</h1>
            <p>Filter Redump DAT collections by region and export a trimmed datafile.</p>
          </div>
          <div className="header-actions">
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
                {systemsRefreshing ? 'Refreshing…' : 'Refresh systems'}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={handleCheckUpdates}
                disabled={updatesChecking || systemsLoading}
              >
                {updatesChecking ? 'Checking…' : 'Check updates'}
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
                Force refresh
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
        <div
          className="drop-overlay"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
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

function extractMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function pickDefaultRegions(regions: string[]): string[] {
  const defaults = preferredDefaultRegions.filter((region) => regions.includes(region));
  return defaults.length > 0 ? defaults : [];
}

function hasFilePayload(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false;
  }
  if (Array.from(dataTransfer.types).includes('Files')) {
    return true;
  }
  return dataTransfer.files.length > 0;
}

function extractDatPath(dataTransfer: DataTransfer | null): string | null {
  if (!dataTransfer) {
    return null;
  }

  const files = Array.from(dataTransfer.files);
  for (const file of files) {
    const candidate = window.datAPI.resolveFilePath(file);
    if (!candidate) {
      continue;
    }
    if (/\.(dat|xml)$/i.test(candidate) || /\.(dat|xml)$/i.test(file.name)) {
      return candidate;
    }
  }

  return null;
}

export default App;
