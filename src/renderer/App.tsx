import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';

import type { DatHeader, FilterSummary, LoadedDatPayload } from '../shared';

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

  const previewRequestId = useRef(0);

  const hydrateLoadedDat = useCallback((data: LoadedDatPayload) => {
    setLoadedDat(data);
    const defaults = pickDefaultRegions(data.regions);
    setSelectedRegions(defaults);
    setPreviewHeader(null);
    setPreviewSummary(null);
    setPreviewFilename(null);
    setInfo(`Loaded ${data.originalFilename}`);
    setError(null);
  }, []);

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
            <button type="button" className="button" onClick={handleOpenDat} disabled={opening}>
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
            <p>Use the “Open DAT” button to choose a Redump DAT file and load its available regions.</p>
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

