import { XMLBuilder, XMLParser } from 'fast-xml-parser';

const XML_DECLARATION = '<?xml version="1.0"?>';
const DATAFILE_DOCTYPE =
  '<!DOCTYPE datafile PUBLIC "-//Logiqx//DTD ROM Management Datafile//EN" "http://www.logiqx.com/Dats/datafile.dtd">';

const REGION_SYNONYMS = new Map<string, string>([
  ['world', 'World'],
  ['worldwide', 'World'],
  ['usa', 'USA'],
  ['u.s.a.', 'USA'],
  ['us', 'USA'],
  ['u.s.', 'USA'],
  ['north america', 'USA'],
  ['europe', 'Europe'],
  ['eur', 'Europe'],
  ['pal', 'Europe'],
  ['japan', 'Japan'],
  ['jpn', 'Japan'],
  ['asia', 'Asia'],
  ['asia pacific', 'Asia'],
  ['asia-pacific', 'Asia'],
  ['australia', 'Australia'],
  ['australasia', 'Australia'],
  ['brazil', 'Brazil'],
  ['canada', 'Canada'],
  ['china', 'China'],
  ['denmark', 'Denmark'],
  ['finland', 'Finland'],
  ['france', 'France'],
  ['germany', 'Germany'],
  ['hong kong', 'Hong Kong'],
  ['italy', 'Italy'],
  ['korea', 'Korea'],
  ['south korea', 'Korea'],
  ['republic of korea', 'Korea'],
  ['mexico', 'Mexico'],
  ['netherlands', 'Netherlands'],
  ['new zealand', 'New Zealand'],
  ['norway', 'Norway'],
  ['russia', 'Russia'],
  ['spain', 'Spain'],
  ['sweden', 'Sweden'],
  ['switzerland', 'Switzerland'],
  ['taiwan', 'Taiwan'],
  ['uk', 'United Kingdom'],
  ['united kingdom', 'United Kingdom'],
  ['england', 'United Kingdom'],
  ['ireland', 'Ireland'],
  ['poland', 'Poland'],
  ['portugal', 'Portugal'],
  ['belgium', 'Belgium'],
  ['greece', 'Greece'],
  ['czech republic', 'Czech Republic'],
  ['south africa', 'South Africa'],
  ['latin america', 'Latin America'],
  ['middle east', 'Middle East'],
  ['africa', 'Africa'],
  ['asia minor', 'Asia'],
  ['united states', 'USA']
]);

const DEFAULT_REGION = 'Unknown';

const CANONICAL_REGIONS = new Set<string>([...new Set(REGION_SYNONYMS.values())]);
CANONICAL_REGIONS.add(DEFAULT_REGION);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false
});

const xmlBuilder = new XMLBuilder({
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  format: true,
  indentBy: '\t',
  suppressEmptyNode: true
});

type RawValue = string | number | boolean | null | undefined;
type RawRecord = Record<string, any>;

export interface DatHeader {
  name: string;
  description?: string;
  version?: string;
  date?: string;
  author?: string;
  homepage?: string;
  url?: string;
  extra: Record<string, string>;
}

export interface DatRom {
  attributes: Record<string, string>;
}

export interface DatGame {
  name: string;
  description?: string;
  category?: string;
  roms: DatRom[];
  regions: string[];
  raw: RawRecord;
}

export interface ParsedDat {
  header: DatHeader;
  games: DatGame[];
  availableRegions: string[];
  descriptor: string;
  normalizedDescriptor: string;
  versionLabel?: string;
  rawRootExtras: Record<string, unknown>;
}

export interface FilterSummary {
  initialGames: number;
  filteredGames: number;
  removedGames: number;
  selectedRegions: string[];
  regionLabel: string;
  descriptor: string;
  normalizedDescriptor: string;
  versionLabel?: string;
}

export interface FilteredDatResult {
  xml: string;
  filename: string;
  header: DatHeader;
  games: DatGame[];
  summary: FilterSummary;
}

export function parseDat(xmlInput: string): ParsedDat {
  const parsed = xmlParser.parse(xmlInput);
  if (!parsed?.datafile) {
    throw new Error('Invalid DAT: missing <datafile> root node.');
  }

  const { header: rawHeader = {}, game: rawGame = [], ...rootExtras } = parsed.datafile as RawRecord;

  const header = normalizeHeader(rawHeader);
  const versionLabel = header.version ?? header.date;

  const gamesArray = toArray(rawGame).map((entry) => normalizeGame(entry));

  const availableRegionSet = new Set<string>();
  for (const game of gamesArray) {
    if (game.regions.length === 0) {
      availableRegionSet.add(DEFAULT_REGION);
    } else {
      game.regions.forEach((region) => availableRegionSet.add(region));
    }
  }

  const { originalDescriptor, normalizedDescriptor } = deriveDescriptors(header, gamesArray.length);

  const availableRegions = Array.from(availableRegionSet).sort((a, b) => a.localeCompare(b));

  return {
    header,
    games: gamesArray,
    availableRegions,
    descriptor: originalDescriptor,
    normalizedDescriptor,
    versionLabel,
    rawRootExtras: rootExtras
  };
}

export function filterDatByRegions(
  parsed: ParsedDat,
  selectedRegions: string[],
  baseFilename?: string
): FilteredDatResult {
  const canonicalSelections = Array.from(
    new Set(
      (selectedRegions ?? [])
        .map((value) => normalizeRegionToken(value) ?? value)
        .filter((value): value is string => !!value)
    )
  );

  const normalizedSelection = new Set(canonicalSelections);
  const selectionActive = normalizedSelection.size > 0;

  const games = selectionActive
    ? parsed.games.filter((game) => game.regions.some((region) => normalizedSelection.has(region)))
    : parsed.games.slice();

  if (games.length === 0) {
    throw new Error('No games match the selected region filters.');
  }

  const descriptorOriginal = parsed.descriptor || 'Datfile';
  const descriptorNormalized =
    parsed.normalizedDescriptor || normalizeDescriptorLabel(descriptorOriginal);

  const header = buildFilteredHeader(
    parsed.header,
    games.length,
    canonicalSelections,
    descriptorOriginal,
    parsed.versionLabel
  );

  const filteredDatafile = {
    ...parsed.rawRootExtras,
    header: headerToXmlNode(header),
    game: games.map((game) => cloneDeep(game.raw))
  };

  const xmlContent = xmlBuilder.build({ datafile: filteredDatafile });
  let xml = [XML_DECLARATION, DATAFILE_DOCTYPE, xmlContent].join('\n');
  xml = xml.replace(/&apos;/g, "'");
  xml = xml.replace(/\r?\n/g, '\r\n');

  const filename = deriveFilteredFilename(
    baseFilename,
    header.description,
    header.name,
    descriptorNormalized,
    games.length,
    parsed.versionLabel
  );

  const summary: FilterSummary = {
    initialGames: parsed.games.length,
    filteredGames: games.length,
    removedGames: parsed.games.length - games.length,
    selectedRegions: canonicalSelections,
    regionLabel: createRegionLabel(canonicalSelections),
    descriptor: descriptorOriginal,
    normalizedDescriptor: descriptorNormalized,
    versionLabel: parsed.versionLabel
  };

  return {
    xml,
    filename,
    header,
    games,
    summary
  };
}

export function getAvailableRegions(parsed: ParsedDat): string[] {
  return parsed.availableRegions;
}

function normalizeHeader(rawHeader: RawRecord): DatHeader {
  const headerEntries: DatHeader['extra'] = {};
  const header: DatHeader = {
    name: '',
    extra: headerEntries
  };

  for (const [key, value] of Object.entries(rawHeader ?? {})) {
    const textValue = coerceText(value);
    switch (key) {
      case 'name':
        header.name = textValue;
        break;
      case 'description':
        header.description = textValue;
        break;
      case 'version':
        header.version = textValue;
        break;
      case 'date':
        header.date = textValue;
        break;
      case 'author':
        header.author = textValue;
        break;
      case 'homepage':
        header.homepage = textValue;
        break;
      case 'url':
        header.url = textValue;
        break;
      default:
        headerEntries[key] = textValue;
    }
  }

  if (!header.name) {
    throw new Error('Invalid DAT header: missing <name>.');
  }

  return header;
}

function normalizeGame(rawGame: RawRecord): DatGame {
  const name = typeof rawGame?.['@_name'] === 'string' ? rawGame['@_name'] : coerceText(rawGame.name);
  const description = coerceText(rawGame.description);
  const category = coerceText(rawGame.category);
  const romEntries = toArray(rawGame.rom).map((rom) => ({
    attributes: mapRomAttributes(rom)
  }));

  const regions =
    extractRegions(name) ??
    extractRegions(description) ??
    (romEntries.length > 0 ? extractRegions(romEntries[0].attributes.name) : null) ??
    [];

  return {
    name,
    description,
    category,
    roms: romEntries,
    regions: regions.length > 0 ? regions : [],
    raw: rawGame
  };
}

function mapRomAttributes(rawRom: RawRecord): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (!rawRom) {
    return attributes;
  }

  for (const [key, value] of Object.entries(rawRom)) {
    if (key.startsWith('@_')) {
      const attributeName = key.slice(2);
      attributes[attributeName] = coerceText(value);
    }
  }

  return attributes;
}

function extractRegions(input?: string): string[] | null {
  if (!input) {
    return null;
  }

  const matches = Array.from(input.matchAll(/\(([^()]+)\)/g));
  for (const match of matches) {
    const inside = match[1];
    const tokens = tokenizeRegionSegment(inside);
    if (tokens.length === 0) {
      continue;
    }

    const normalizedTokens = tokens.map((token) => normalizeRegionToken(token)).filter((token): token is string => !!token);
    if (normalizedTokens.length > 0) {
      const unique = Array.from(new Set(normalizedTokens));
      return unique;
    }
  }

  return null;
}

function tokenizeRegionSegment(segment: string): string[] {
  return segment
    .split(/[/,&]/g)
    .map((part) => part.trim())
    .flatMap((part) => part.split(/\s{2,}/g))
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeRegionToken(token: string | undefined): string | null {
  if (!token) {
    return null;
  }
  const cleaned = token.replace(/\.+/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return null;
  }

  const lower = cleaned.toLowerCase();
  const synonym = REGION_SYNONYMS.get(lower);
  if (synonym) {
    return synonym;
  }

  if (CANONICAL_REGIONS.has(cleaned)) {
    return cleaned;
  }

  return null;
}

function deriveDescriptors(
  header: DatHeader,
  totalGames: number
): { originalDescriptor: string; normalizedDescriptor: string } {
  const description = header.description ?? '';

  const candidate = tryExtractDescriptor(description, header.name, totalGames);
  const generic = candidate ?? extractGenericDescriptor(description);

  const normalized = normalizeDescriptorLabel(generic ?? 'Datfile');
  const originalDescriptor = generic ?? normalized;

  return { originalDescriptor, normalizedDescriptor: normalized };
}

function tryExtractDescriptor(description: string, systemName: string, totalGames: number): string | null {
  if (!description) {
    return null;
  }

  const escapedSystem = escapeRegExp(systemName);
  const countPattern = escapeRegExp(String(totalGames));
  const regex = new RegExp(`^${escapedSystem}\\s*-\\s*(.+?)\\s*\\(${countPattern}\\)`);
  const match = description.match(regex);
  if (match && match[1]) {
    return match[1].trim();
  }

  return null;
}

function extractGenericDescriptor(description: string): string | null {
  const fallbackMatch = description.match(/-\s*([^-()]+)\s*\(\d+\)/);
  if (fallbackMatch && fallbackMatch[1]) {
    return fallbackMatch[1].trim();
  }
  if (/datfile/i.test(description)) {
    return 'Datfile';
  }
  return null;
}

function normalizeDescriptorLabel(label: string): string {
  if (/datfile/i.test(label)) {
    return 'Datfile';
  }
  if (/disc/i.test(label)) {
    return 'Datfile';
  }
  return label;
}

function buildFilteredHeader(
  header: DatHeader,
  filteredCount: number,
  selectedRegions: string[],
  descriptorOriginal: string,
  versionLabel?: string
): DatHeader {
  const regionLabel = createRegionLabel(selectedRegions);
  const systemName = header.name;
  const version = versionLabel ?? header.version ?? header.date ?? new Date().toISOString().split('T')[0];
  const decoratedSystem = regionLabel ? `${systemName} (${regionLabel})` : systemName;
  const description = `${decoratedSystem} - ${descriptorOriginal} (${filteredCount}) (${version})`;

  return {
    ...header,
    name: decoratedSystem,
    description,
    extra: { ...header.extra }
  };
}

function headerToXmlNode(header: DatHeader): RawRecord {
  const { extra, ...known } = header;
  const node: RawRecord = {};
  for (const [key, value] of Object.entries({
    ...extra,
    ...known
  })) {
    if (key === 'extra') {
      continue;
    }
    if (value !== undefined && value !== null) {
      node[key] = value;
    }
  }
  return node;
}

function createRegionLabel(selectedRegions: string[]): string {
  if (!selectedRegions || selectedRegions.length === 0) {
    return '';
  }

  return selectedRegions.join(', ');
}

function sanitizeFilename(input: string): string {
  return input
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function deriveFilteredFilename(
  baseFilename: string | undefined,
  headerDescription: string | undefined,
  decoratedSystem: string,
  descriptorNormalized: string,
  filteredCount: number,
  versionLabel?: string
): string {
  const extensionMatch = baseFilename?.match(/(\.[^.]+)$/);
  const extension = extensionMatch ? extensionMatch[1] : '.dat';
  const baseWithoutExtension =
    baseFilename && extensionMatch ? baseFilename.slice(0, -extensionMatch[1].length) : baseFilename;

  if (baseWithoutExtension) {
    const pattern = /^(.*?)\s*-\s*([^-()]+?)\s*\((\d+)\)(.*)$/;
    const match = baseWithoutExtension.match(pattern);
    if (match) {
      const rest = match[4] ?? '';
      const restTrimmed = rest.trim();
      const suffix = restTrimmed
        ? ` ${restTrimmed}`
        : versionLabel
          ? ` (${versionLabel})`
          : '';
      const baseName = `${decoratedSystem} - ${descriptorNormalized} (${filteredCount})${suffix}`;
      return `${sanitizeFilename(baseName)}${extension}`;
    }
  }

  if (headerDescription) {
    return `${sanitizeFilename(headerDescription)}${extension}`;
  }

  const versionSegment = versionLabel ? ` (${versionLabel})` : '';
  const fallback = `${decoratedSystem} - ${descriptorNormalized} (${filteredCount})${versionSegment}`;
  return `${sanitizeFilename(fallback)}${extension}`;
}

function coerceText(value: RawValue | RawRecord): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? coerceText(value[0]) : '';
  }
  if (typeof value === 'object' && '#text' in value) {
    return coerceText((value as RawRecord)['#text']);
  }
  return '';
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
}

function cloneDeep<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

