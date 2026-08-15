import fs from 'node:fs';
import path from 'node:path';

const htmlPath = process.argv[2] || path.join(process.env.TEMP || '/tmp', 'redump-downloads.html');
const outPath = process.argv[3] || path.join(process.cwd(), 'src', 'shared', 'redumpSystems.json');

const html = fs.readFileSync(htmlPath, 'utf8');
const systems = [];
const seen = new Set();

const rowRe = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
const hrefRe = /href="([^"]*)"/gi;

let rowMatch;
while ((rowMatch = rowRe.exec(html))) {
  const name = rowMatch[1]
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) {
    continue;
  }

  const downloadsHtml = rowMatch[2];
  let slug;
  let hasSerialVersion = false;
  let hasCues = false;
  let hasSbi = false;

  let hrefMatch;
  hrefRe.lastIndex = 0;
  while ((hrefMatch = hrefRe.exec(downloadsHtml))) {
    const href = (hrefMatch[1] || '').trim();
    if (!href) {
      continue;
    }
    const pathPart = href.replace(/^https?:\/\/redump\.info/i, '');
    if (pathPart.startsWith('/datfile/')) {
      const rest = pathPart.slice('/datfile/'.length);
      if (rest.endsWith('/serial,version')) {
        hasSerialVersion = true;
        slug ??= rest.slice(0, -'/serial,version'.length);
      } else if (!rest.includes('/')) {
        slug = rest;
      }
    } else if (pathPart.startsWith('/cues/')) {
      hasCues = true;
      const rest = pathPart.slice('/cues/'.length);
      if (!slug && !rest.includes('/')) {
        slug = rest;
      }
    } else if (pathPart.startsWith('/sbi/')) {
      hasSbi = true;
      const rest = pathPart.slice('/sbi/'.length);
      if (!slug && !rest.includes('/')) {
        slug = rest;
      }
    }
  }

  if (!slug || seen.has(slug)) {
    continue;
  }
  seen.add(slug);
  systems.push({
    name,
    slug,
    hasSerialVersion,
    hasCues,
    hasSbi
  });
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(systems, null, 2)}\n`, 'utf8');
console.log(`Wrote ${systems.length} systems to ${outPath}`);
