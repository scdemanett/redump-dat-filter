import fs from 'node:fs';
import path from 'node:path';

const htmlPath = process.argv[2] || path.join(process.env.TEMP || '/tmp', 'redump-downloads.html');
const outPath = process.argv[3] || path.join(process.cwd(), 'src', 'shared', 'redumpSystems.json');

const html = fs.readFileSync(htmlPath, 'utf8');
const systems = [];
const seen = new Set();

const rowRe =
  /<tr[^>]*>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?href="(\/datfile\/([^"/?#]+))(?:\/serial,version)?"/gi;

let match;
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

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(systems, null, 2)}\n`, 'utf8');
console.log(`Wrote ${systems.length} systems to ${outPath}`);
