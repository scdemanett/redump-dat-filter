import { app, screen, type BrowserWindow, type Rectangle } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const MIN_WIDTH = 960;
const MIN_HEIGHT = 600;
const SAVE_DEBOUNCE_MS = 300;

function getStatePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isVisibleOnAnyDisplay(bounds: Rectangle): boolean {
  const display = screen.getDisplayMatching(bounds);
  const area = display.workArea;
  const overlapsHorizontally = bounds.x < area.x + area.width && bounds.x + bounds.width > area.x;
  const titleBarVisible = bounds.y < area.y + area.height && bounds.y + 40 > area.y;
  return overlapsHorizontally && titleBarVisible;
}

export function loadWindowState(): WindowState | null {
  try {
    const raw = fs.readFileSync(getStatePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<WindowState>;
    if (
      !isValidNumber(parsed.x) ||
      !isValidNumber(parsed.y) ||
      !isValidNumber(parsed.width) ||
      !isValidNumber(parsed.height)
    ) {
      return null;
    }

    const state: WindowState = {
      x: parsed.x,
      y: parsed.y,
      width: Math.max(MIN_WIDTH, Math.round(parsed.width)),
      height: Math.max(MIN_HEIGHT, Math.round(parsed.height)),
      isMaximized: Boolean(parsed.isMaximized)
    };

    if (!isVisibleOnAnyDisplay(state)) {
      return null;
    }

    return state;
  } catch {
    return null;
  }
}

export function getDefaultWindowOptions(saved: WindowState | null = loadWindowState()): {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  x?: number;
  y?: number;
} {
  if (!saved) {
    return {
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT
    };
  }

  return {
    x: saved.x,
    y: saved.y,
    width: saved.width,
    height: saved.height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT
  };
}

export function shouldStartMaximized(saved: WindowState | null = loadWindowState()): boolean {
  // First launch (or invalid saved state): open maximized.
  return saved ? saved.isMaximized : true;
}

function readStateFromWindow(win: BrowserWindow): WindowState {
  const bounds = win.getNormalBounds();
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: win.isMaximized()
  };
}

function writeWindowState(state: WindowState): void {
  try {
    fs.mkdirSync(path.dirname(getStatePath()), { recursive: true });
    fs.writeFileSync(getStatePath(), JSON.stringify(state), 'utf-8');
  } catch (error) {
    console.error('Failed to save window state', error);
  }
}

export function trackWindowState(win: BrowserWindow): void {
  let saveTimer: NodeJS.Timeout | null = null;

  const scheduleSave = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (!win.isDestroyed()) {
        writeWindowState(readStateFromWindow(win));
      }
    }, SAVE_DEBOUNCE_MS);
  };

  const saveNow = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!win.isDestroyed()) {
      writeWindowState(readStateFromWindow(win));
    }
  };

  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('maximize', scheduleSave);
  win.on('unmaximize', scheduleSave);
  win.on('close', saveNow);
}
