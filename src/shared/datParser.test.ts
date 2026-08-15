import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { filterDatByRegions, parseDat } from './datParser';

const SAMPLE_DAT = `<?xml version="1.0"?>
<!DOCTYPE datafile PUBLIC "-//Logiqx//DTD ROM Management Datafile//EN" "http://www.logiqx.com/Dats/datafile.dtd">
<datafile>
  <header>
    <name>Microsoft - Xbox</name>
    <description>Microsoft - Xbox - Datfile (4) (2025-11-07 05-38-55)</description>
    <version>2025-11-07 05-38-55</version>
    <date>2025-11-07</date>
    <author>Redump</author>
  </header>
  <game name="Halo (USA)">
    <rom name="Halo (USA)" size="1" crc="11111111"/>
  </game>
  <game name="Forza Motorsport (Europe)">
    <rom name="Forza Motorsport (Europe)" size="1" crc="22222222"/>
  </game>
  <game name="Project Gotham Racing 2 (Japan)">
    <rom name="Project Gotham Racing 2 (Japan)" size="1" crc="33333333"/>
  </game>
  <game name="Generic Title">
    <rom name="Generic Title" size="1" crc="44444444"/>
  </game>
</datafile>`;

describe('parseDat', () => {
  it('parses header, regions, and descriptors', () => {
    const parsed = parseDat(SAMPLE_DAT);

    assert.equal(parsed.header.name, 'Microsoft - Xbox');
    assert.equal(parsed.games.length, 4);
    assert.deepEqual(parsed.availableRegions, ['Europe', 'Japan', 'Unknown', 'USA']);
    assert.equal(parsed.descriptor, 'Datfile');
    assert.equal(parsed.versionLabel, '2025-11-07 05-38-55');
  });

  it('normalizes region synonyms from game titles', () => {
    const parsed = parseDat(`<?xml version="1.0"?>
<datafile>
  <header><name>Test System</name></header>
  <game name="Example (US)"><rom name="Example (US)" size="1" crc="aaaaaaaa"/></game>
  <game name="Other (USA, Europe)"><rom name="Other (USA, Europe)" size="1" crc="bbbbbbbb"/></game>
</datafile>`);

    assert.deepEqual(parsed.games[0]?.regions, ['USA']);
    assert.deepEqual(parsed.games[1]?.regions, ['USA', 'Europe']);
  });

  it('throws when the datafile root is missing', () => {
    assert.throws(() => parseDat('<root></root>'), /missing <datafile>/);
  });
});

describe('filterDatByRegions', () => {
  it('filters games to the selected regions', () => {
    const parsed = parseDat(SAMPLE_DAT);
    const result = filterDatByRegions(parsed, ['USA'], 'Microsoft - Xbox - Datfile (4) (2025-11-07).dat');

    assert.equal(result.games.length, 1);
    assert.equal(result.games[0]?.name, 'Halo (USA)');
    assert.equal(result.summary.filteredGames, 1);
    assert.equal(result.summary.removedGames, 3);
    assert.match(result.header.name!, /\(USA\)/);
    assert.match(result.header.description!, /\(1\)/);
    assert.match(result.filename, /Microsoft - Xbox \(USA\) - Datfile \(1\)/);
    assert.match(result.xml, /<game name="Halo \(USA\)">/);
    assert.doesNotMatch(result.xml, /Forza Motorsport/);
  });

  it('preserves serial/version descriptors, tags, and filenames', () => {
    const xml = `<?xml version="1.0"?>
<!DOCTYPE datafile PUBLIC "-//Logiqx//DTD ROM Management Datafile//EN" "http://www.logiqx.com/Dats/datafile.dtd">
<datafile>
  <header>
    <name>Sony - PlayStation</name>
    <description>Sony - PlayStation - Datfile (serial,version) (2) (2026-08-15 10-57-09)</description>
    <version>2026-08-15 10-57-09</version>
    <date>2026-08-15</date>
    <author>redump.org</author>
  </header>
  <game name="Ridge Racer (USA)">
    <category>Games</category>
    <description>Ridge Racer (USA)</description>
    <id>1</id>
    <serial>SCUS-94300</serial>
    <rom name="Ridge Racer (USA)" size="1" crc="aaaaaaaa"/>
  </game>
  <game name="Tekken (Europe)">
    <category>Games</category>
    <description>Tekken (Europe)</description>
    <id>2</id>
    <serial>SCES-00005</serial>
    <rom name="Tekken (Europe)" size="1" crc="bbbbbbbb"/>
  </game>
</datafile>`;
    const parsed = parseDat(xml);
    assert.equal(parsed.descriptor, 'Datfile (serial,version)');
    assert.equal(parsed.normalizedDescriptor, 'Datfile (serial,version)');

    const result = filterDatByRegions(
      parsed,
      ['USA'],
      'Sony - PlayStation - Datfile (serial,version) (2) (2026-08-15 10-57-09).dat'
    );

    assert.equal(result.games.length, 1);
    assert.match(result.header.description!, /Datfile \(serial,version\)/);
    assert.match(result.filename, /Datfile \(serial,version\)/);
    assert.match(result.xml, /<serial>SCUS-94300<\/serial>/);
    assert.doesNotMatch(result.xml, /Tekken/);
  });

  it('returns all games when no regions are selected', () => {
    const parsed = parseDat(SAMPLE_DAT);
    const result = filterDatByRegions(parsed, [], 'source.dat');

    assert.equal(result.games.length, 4);
    assert.equal(result.summary.selectedRegions.length, 0);
  });

  it('throws when no games match the selected regions', () => {
    const parsed = parseDat(SAMPLE_DAT);

    assert.throws(
      () => filterDatByRegions(parsed, ['Brazil'], 'source.dat'),
      /No games match the selected region filters/
    );
  });

  it('rewrites XML with CRLF line endings and preserves doctype', () => {
    const parsed = parseDat(SAMPLE_DAT);
    const result = filterDatByRegions(parsed, ['Europe'], 'source.dat');

    assert.match(result.xml, /^<\?xml version="1.0"\?>\r\n<!DOCTYPE datafile/);
    assert.match(result.xml, /\r\n\t<game name="Forza Motorsport \(Europe\)">/);
  });
});
