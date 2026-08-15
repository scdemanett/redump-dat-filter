import { useCallback, useEffect, useMemo, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';

import { CANONICAL_REGION_LIST, type AppSettings, type RedumpSystem } from '../shared';

export type ThemeMode = 'dark' | 'light';

interface SettingsModalProps {
  settings: AppSettings;
  systems: RedumpSystem[];
  systemsLoading?: boolean;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  onSave: (settings: AppSettings) => Promise<void>;
  onClose: () => void;
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function SettingsModal({
  settings,
  systems,
  systemsLoading = false,
  theme,
  onThemeChange,
  onSave,
  onClose
}: SettingsModalProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systemQuery, setSystemQuery] = useState('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, saving]);

  const handleToggleRegion = useCallback((region: string) => {
    setDraft((current) => ({
      ...current,
      defaultRegions: current.defaultRegions.includes(region)
        ? current.defaultRegions.filter((value) => value !== region)
        : [...current.defaultRegions, region]
    }));
  }, []);

  const handleToggleSystem = useCallback(
    (slug: string) => {
      setDraft((current) => {
        if (current.showAllSystems) {
          return {
            ...current,
            showAllSystems: false,
            visibleSystemSlugs: systems.map((system) => system.slug).filter((value) => value !== slug)
          };
        }
        return {
          ...current,
          visibleSystemSlugs: current.visibleSystemSlugs.includes(slug)
            ? current.visibleSystemSlugs.filter((value) => value !== slug)
            : [...current.visibleSystemSlugs, slug]
        };
      });
    },
    [systems]
  );

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

  const visibleSummary = draft.showAllSystems
    ? 'All systems'
    : `${draft.visibleSystemSlugs.length} of ${systems.length} selected`;

  const handleBrowse = useCallback(async () => {
    setError(null);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Choose default DAT save folder',
        defaultPath: draft.defaultSaveDir ?? undefined
      });
      if (typeof selected === 'string' && selected.length > 0) {
        setDraft((current) => ({ ...current, defaultSaveDir: selected }));
      }
    } catch (err) {
      setError(`Failed to choose a folder: ${extractMessage(err)}`);
    }
  }, [draft.defaultSaveDir]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
    } catch (err) {
      setError(`Failed to save settings: ${extractMessage(err)}`);
      setSaving(false);
    }
  }, [draft, onSave]);

  return (
    <div
      className="settings-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose();
        }
      }}
    >
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        <header className="settings-modal__header">
          <h2 id="settings-modal-title">Settings</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close settings"
            title="Close"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="settings-modal__body">
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}

        <div className="settings-top-row">
        <section className="settings-section">
          <h3>Appearance</h3>
          <div className="theme-toggle" role="group" aria-label="Color theme">
            <button
              type="button"
              className={`theme-toggle__option ${theme === 'light' ? 'is-active' : ''}`}
              onClick={() => onThemeChange('light')}
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
              onClick={() => onThemeChange('dark')}
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
        </section>

        <section className="settings-section">
          <h3>Default Save Folder</h3>
          <p className="panel-description">
            The save dialog opens in this folder. After you save a DAT, this updates to the folder you used.
          </p>
          <div className="settings-path-row">
            <input
              type="text"
              className="settings-path-input"
              value={draft.defaultSaveDir ?? ''}
              placeholder="Not set — uses the loaded DAT folder"
              readOnly
            />
            <button type="button" className="button secondary" onClick={() => void handleBrowse()} disabled={saving}>
              Browse
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => setDraft((current) => ({ ...current, defaultSaveDir: null }))}
              disabled={saving || !draft.defaultSaveDir}
            >
              Clear
            </button>
          </div>
        </section>
        </div>

        <div className="settings-columns">
        <section className="settings-section">
          <header className="panel-header">
            <h3>Visible Systems</h3>
            <div className="panel-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    showAllSystems: true,
                    visibleSystemSlugs: []
                  }))
                }
                disabled={saving || systems.length === 0 || draft.showAllSystems}
              >
                Select All
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    showAllSystems: false,
                    visibleSystemSlugs: []
                  }))
                }
                disabled={saving || (!draft.showAllSystems && draft.visibleSystemSlugs.length === 0)}
              >
                Clear
              </button>
            </div>
          </header>
          <p className="panel-description">
            Select All shows every system, including new ones. Clear, then check the systems you
            want in the main dropdown. Cached badges and update checks follow this list. {visibleSummary}.
          </p>
          <div className="settings-system-picker">
            <input
              type="search"
              className="system-combobox__search"
              value={systemQuery}
              onChange={(event) => setSystemQuery(event.target.value)}
              placeholder="Search systems…"
              aria-label="Search systems to show"
              disabled={saving || systemsLoading}
            />
            {systemsLoading ? (
              <p className="system-combobox__empty">Loading systems…</p>
            ) : filteredSystems.length === 0 ? (
              <p className="system-combobox__empty">No systems match your search.</p>
            ) : (
              <ul className="system-combobox__list settings-system-picker__list">
                {filteredSystems.map((system) => {
                  const checked =
                    draft.showAllSystems || draft.visibleSystemSlugs.includes(system.slug);
                  const badge = system.updateAvailable
                    ? 'update'
                    : system.downloaded
                      ? 'cached'
                      : null;
                  return (
                    <li key={system.slug}>
                      <label className={`settings-system-picker__item ${checked ? 'is-selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={saving}
                          onChange={() => handleToggleSystem(system.slug)}
                        />
                        <span className="settings-system-picker__name">{system.name}</span>
                        {badge && (
                          <span
                            className={`system-combobox__badge ${badge === 'update' ? 'is-update' : ''}`}
                          >
                            {badge}
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="settings-section">
          <header className="panel-header">
            <h3>Default Region Filters</h3>
            <div className="panel-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setDraft((current) => ({ ...current, defaultRegions: [...CANONICAL_REGION_LIST] }))}
                disabled={saving}
              >
                Select All
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => setDraft((current) => ({ ...current, defaultRegions: [] }))}
                disabled={saving}
              >
                Clear
              </button>
            </div>
          </header>
          <p className="panel-description">
            Used when a DAT is loaded. Only regions present in that DAT are applied. Leave empty to keep all games.
          </p>
          <div className="regions-grid">
            {CANONICAL_REGION_LIST.map((region) => {
              const checked = draft.defaultRegions.includes(region);
              return (
                <label key={region} className={`region-item ${checked ? 'selected' : ''}`}>
                  <input
                    type="checkbox"
                    value={region}
                    checked={checked}
                    disabled={saving}
                    onChange={() => handleToggleRegion(region)}
                  />
                  <span>{region}</span>
                </label>
              );
            })}
          </div>
        </section>
        </div>

        </div>

        <footer className="settings-modal__footer">
          <button type="button" className="button ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}
