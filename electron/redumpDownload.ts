import { unzipSync } from 'fflate';
import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

import fallbackSystems from '../src/shared/redumpSystems.json';
import type { RedumpSystem, RedumpSystemListSource } from '../src/shared/ipcTypes';

const REDUMP_BASE = 'https://redump.info';
const DOWNLOADS_URL = `${REDUMP_BASE}/downloads`;
const USER_AGENT = `RedumpDATFilter/${app.getVersion()} (Electron; +https://github.com/scdemanett/redump-dat-filter)`;
const SYSTEM_LIST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UPDATE_PROBE_TTL_MS = 6 * 60 * 60 * 1000;
const HEAD_CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 60_000;

export interface DatCacheMeta {
  slug: string;
  filename: string;
  contentLength?: number;
  fetchedAt: string;
  updateAvailable?: boolean;
  remoteFilename?: string;
  checkedAt?: string;
}

interface SystemListCache {
  fetchedAt?: string;
  systems: Array<{ name: string; slug: string }>;
}

export interface ResolvedSystemList {
  systems: RedumpSystem[];
  source: RedumpSystemListSource;
  fetchedAt?: string;
}

export interface DownloadSystemResult {
  xml: string;
  originalFilename: string;
  sourcePath: string;
  fromCache: boolean;
}

function cacheRoot(): string {
  return path.join(app.getPath('userData'), 'cache');
}

function systemsCachePath(): string {
  return path.join(cacheRoot(), 'redump-systems.json');
}

function datDir(slug: string): string {
  return path.join(cacheRoot(), 'dats', sanitizeSlug(slug));
}

function datFilePath(slug: string): string {
  return path.join(datDir(slug), 'data.dat');
}

function datMetaPath(slug: string): string {
  return path.join(datDir(slug), 'meta.json');
}

function sanitizeSlug(slug: string): string {
  return slug.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function datfileUrl(slug: string): string {
  return `${REDUMP_BASE}/datfile/${encodeURIComponent(slug)}`;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function isFresh(iso: string | undefined, ttlMs: number): boolean {
  if (!iso) {
    return false;
  }
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) {
    return false;
  }
  return Date.now() - ts < ttlMs;
}

export function parseSystemsFromHtml(html: string): Array<{ name: string; slug: string }> {
  const systems: Array<{ name: string; slug: string }> = [];
  const seen = new Set<string>();
  const rowRe =
    /<tr[^>]*>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?href="(\/datfile\/([^"/?#]+))(?:\/serial,version)?"/gi;

  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(html))) {
    const name = match[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const slug = match[3];
    if (!name || !slug || seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    systems.push({ name, slug });
  }

  return systems;
}

export function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) {
    return null;
  }

  const utfMatch = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1].trim().replace(/^"|"$/g, ''));
    } catch {
      return utfMatch[1].trim().replace(/^"|"$/g, '');
    }
  }

  const quoted = /filename\s*=\s*"((?:\\.|[^"\\])*)"/i.exec(header);
  if (quoted?.[1]) {
    return quoted[1].replace(/\\"/g, '"');
  }

  const plain = /filename\s*=\s*([^;]+)/i.exec(header);
  if (plain?.[1]) {
    return plain[1].trim().replace(/^"|"$/g, '');
  }

  return null;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = FETCH_TIMEOUT_MS, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: '*/*',
        ...(rest.headers ?? {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function readDatMeta(slug: string): Promise<DatCacheMeta | null> {
  return readJsonFile<DatCacheMeta>(datMetaPath(slug));
}

async function listDownloadedSlugs(): Promise<string[]> {
  const root = path.join(cacheRoot(), 'dats');
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const slugs: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const meta = await readDatMeta(entry.name);
      if (meta?.filename) {
        slugs.push(meta.slug || entry.name);
      }
    }
    return slugs;
  } catch {
    return [];
  }
}

async function enrichSystems(
  systems: Array<{ name: string; slug: string }>
): Promise<RedumpSystem[]> {
  return Promise.all(
    systems.map(async (system) => {
      const meta = await readDatMeta(system.slug);
      return {
        name: system.name,
        slug: system.slug,
        downloaded: Boolean(meta?.filename),
        updateAvailable: Boolean(meta?.updateAvailable),
        cachedFilename: meta?.filename
      };
    })
  );
}

async function scrapeSystemsLive(): Promise<SystemListCache> {
  const response = await fetchWithTimeout(DOWNLOADS_URL, {
    method: 'GET',
    timeoutMs: 30_000
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Redump downloads page (${response.status}).`);
  }
  const html = await response.text();
  const systems = parseSystemsFromHtml(html);
  if (systems.length === 0) {
    throw new Error('Could not parse any systems from the Redump downloads page.');
  }
  const cache: SystemListCache = {
    fetchedAt: new Date().toISOString(),
    systems
  };
  await writeJsonFile(systemsCachePath(), cache);
  return cache;
}

function bundledSystems(): SystemListCache {
  return {
    systems: (fallbackSystems as Array<{ name: string; slug: string }>).slice()
  };
}

export async function getSystemList(options: { force?: boolean } = {}): Promise<ResolvedSystemList> {
  const cached = await readJsonFile<SystemListCache>(systemsCachePath());

  if (!options.force && cached?.systems?.length) {
    return {
      systems: await enrichSystems(cached.systems),
      source: 'cache',
      fetchedAt: cached.fetchedAt
    };
  }

  try {
    const live = await scrapeSystemsLive();
    return {
      systems: await enrichSystems(live.systems),
      source: 'live',
      fetchedAt: live.fetchedAt
    };
  } catch {
    if (cached?.systems?.length) {
      return {
        systems: await enrichSystems(cached.systems),
        source: 'cache',
        fetchedAt: cached.fetchedAt
      };
    }

    const bundled = bundledSystems();
    return {
      systems: await enrichSystems(bundled.systems),
      source: 'bundled'
    };
  }
}

export async function refreshSystemList(): Promise<ResolvedSystemList> {
  const live = await scrapeSystemsLive();
  return {
    systems: await enrichSystems(live.systems),
    source: 'live',
    fetchedAt: live.fetchedAt
  };
}

/** Non-blocking refresh when cache is missing/stale. */
export function maybeRefreshSystemListInBackground(): void {
  void (async () => {
    const cached = await readJsonFile<SystemListCache>(systemsCachePath());
    if (cached?.systems?.length && isFresh(cached.fetchedAt, SYSTEM_LIST_TTL_MS)) {
      return;
    }
    try {
      await scrapeSystemsLive();
    } catch (error) {
      console.warn('Background Redump system list refresh failed', error);
    }
  })();
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function run(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index]);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () =>
    run()
  );
  await Promise.all(runners);
  return results;
}

async function headDatInfo(slug: string): Promise<{ filename: string | null; contentLength?: number }> {
  const response = await fetchWithTimeout(datfileUrl(slug), {
    method: 'HEAD',
    timeoutMs: 20_000
  });
  if (!response.ok) {
    throw new Error(`HEAD failed for ${slug} (${response.status}).`);
  }
  const filename = parseContentDispositionFilename(response.headers.get('content-disposition'));
  const lengthHeader = response.headers.get('content-length');
  const contentLength = lengthHeader ? Number(lengthHeader) : undefined;
  return {
    filename,
    contentLength: Number.isFinite(contentLength) ? contentLength : undefined
  };
}

export async function checkDownloadedUpdates(
  options: { force?: boolean } = {}
): Promise<ResolvedSystemList> {
  const slugs = await listDownloadedSlugs();
  const now = new Date().toISOString();

  await mapPool(slugs, HEAD_CONCURRENCY, async (slug) => {
    const meta = await readDatMeta(slug);
    if (!meta) {
      return;
    }
    if (!options.force && isFresh(meta.checkedAt, UPDATE_PROBE_TTL_MS)) {
      return;
    }

    try {
      const remote = await headDatInfo(slug);
      const remoteFilename = remote.filename ?? meta.remoteFilename;
      const updateAvailable = Boolean(remoteFilename && remoteFilename !== meta.filename);
      const next: DatCacheMeta = {
        ...meta,
        remoteFilename: remoteFilename ?? meta.remoteFilename,
        updateAvailable,
        checkedAt: now,
        contentLength: remote.contentLength ?? meta.contentLength
      };
      await writeJsonFile(datMetaPath(slug), next);
    } catch (error) {
      console.warn(`Update probe failed for ${slug}`, error);
      const next: DatCacheMeta = {
        ...meta,
        updateAvailable: false,
        checkedAt: now
      };
      await writeJsonFile(datMetaPath(slug), next);
    }
  });

  return getSystemList({ force: false });
}

function zipEntryToDatFilename(zipName: string): string {
  const base = path.basename(zipName);
  return base.replace(/\.zip$/i, '.dat');
}

function extractDatFromZip(buffer: Buffer): { xml: string; datFilename: string } {
  const unzipped = unzipSync(new Uint8Array(buffer));
  const entries = Object.keys(unzipped).filter((name) => !name.endsWith('/'));
  const datEntry =
    entries.find((name) => /\.dat$/i.test(name)) ??
    entries.find((name) => /\.xml$/i.test(name)) ??
    entries[0];

  if (!datEntry) {
    throw new Error('Downloaded ZIP did not contain a DAT file.');
  }

  const bytes = unzipped[datEntry];
  const xml = Buffer.from(bytes).toString('utf-8');
  return {
    xml,
    datFilename: zipEntryToDatFilename(datEntry)
  };
}

async function downloadAndCacheDat(slug: string): Promise<DownloadSystemResult> {
  const response = await fetchWithTimeout(datfileUrl(slug), {
    method: 'GET',
    timeoutMs: 120_000
  });
  if (!response.ok) {
    throw new Error(`Failed to download DAT for ${slug} (${response.status}).`);
  }

  const disposition = parseContentDispositionFilename(response.headers.get('content-disposition'));
  const lengthHeader = response.headers.get('content-length');
  const contentLength = lengthHeader ? Number(lengthHeader) : undefined;
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  let xml: string;
  let datFilename: string;

  const looksLikeZip =
    buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b
      ? true
      : (disposition ?? '').toLowerCase().endsWith('.zip') ||
        (response.headers.get('content-type') ?? '').includes('zip');

  if (looksLikeZip) {
    const extracted = extractDatFromZip(buffer);
    xml = extracted.xml;
    datFilename = disposition
      ? disposition.replace(/\.zip$/i, '.dat')
      : extracted.datFilename;
  } else {
    xml = buffer.toString('utf-8');
    datFilename = disposition?.replace(/\.zip$/i, '.dat') ?? `${slug}.dat`;
  }

  const sourcePath = datFilePath(slug);
  await ensureDir(datDir(slug));
  await fs.writeFile(sourcePath, xml, 'utf-8');

  const meta: DatCacheMeta = {
    slug,
    filename: disposition ?? datFilename,
    contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
    fetchedAt: new Date().toISOString(),
    updateAvailable: false,
    remoteFilename: disposition ?? datFilename,
    checkedAt: new Date().toISOString()
  };
  await writeJsonFile(datMetaPath(slug), meta);

  return {
    xml,
    originalFilename: datFilename,
    sourcePath,
    fromCache: false
  };
}

export async function downloadOrLoadSystem(
  slug: string,
  options: { force?: boolean } = {}
): Promise<DownloadSystemResult> {
  const normalized = slug.trim();
  if (!normalized) {
    throw new Error('No system slug provided.');
  }

  const meta = await readDatMeta(normalized);
  const cachedPath = datFilePath(normalized);

  if (!options.force && meta?.filename) {
    try {
      const remote = await headDatInfo(normalized);
      const remoteFilename = remote.filename;
      if (remoteFilename && remoteFilename === meta.filename) {
        const xml = await fs.readFile(cachedPath, 'utf-8');
        const next: DatCacheMeta = {
          ...meta,
          updateAvailable: false,
          remoteFilename,
          checkedAt: new Date().toISOString(),
          contentLength: remote.contentLength ?? meta.contentLength
        };
        await writeJsonFile(datMetaPath(normalized), next);
        return {
          xml,
          originalFilename: meta.filename.replace(/\.zip$/i, '.dat'),
          sourcePath: cachedPath,
          fromCache: true
        };
      }
    } catch (error) {
      console.warn(`HEAD check failed for ${normalized}; trying cached DAT`, error);
      try {
        const xml = await fs.readFile(cachedPath, 'utf-8');
        return {
          xml,
          originalFilename: meta.filename.replace(/\.zip$/i, '.dat'),
          sourcePath: cachedPath,
          fromCache: true
        };
      } catch {
        // fall through to full download
      }
    }
  }

  if (options.force || !meta?.filename) {
    return downloadAndCacheDat(normalized);
  }

  // Filename differs (update available) or HEAD returned a different name
  return downloadAndCacheDat(normalized);
}
