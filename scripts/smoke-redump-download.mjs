import { unzipSync } from 'fflate';
import fs from 'node:fs';

const slug = process.argv[2] || 'QIS';
const url = `https://redump.info/datfile/${slug}`;

const head = await fetch(url, { method: 'HEAD' });
console.log('HEAD', head.status, head.headers.get('content-disposition'));

const res = await fetch(url);
const buf = Buffer.from(await res.arrayBuffer());
console.log('GET', res.status, buf.length, 'bytes');

const unzipped = unzipSync(new Uint8Array(buf));
const names = Object.keys(unzipped).filter((n) => !n.endsWith('/'));
console.log('zip entries', names);
const dat = names.find((n) => /\.dat$/i.test(n));
if (!dat) throw new Error('no dat');
const xml = Buffer.from(unzipped[dat]).toString('utf8');
console.log('dat starts', xml.slice(0, 80).replace(/\s+/g, ' '));
console.log('ok');
