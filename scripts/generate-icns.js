const fs = require('fs');
const path = require('path');

const iconDir = path.resolve(__dirname, '../build');

const entries = [
  { type: 'icp4', file: 'icon_16.png' },
  { type: 'icp5', file: 'icon_32.png' },
  { type: 'icp6', file: 'icon_64.png' },
  { type: 'ic07', file: 'icon_128.png' },
  { type: 'ic08', file: 'icon_256.png' },
  { type: 'ic09', file: 'icon_512.png' },
  { type: 'ic10', file: 'icon_1024.png' }
];

const chunks = [];

for (const entry of entries) {
  const filePath = path.join(iconDir, entry.file);
  if (!fs.existsSync(filePath)) {
    continue;
  }

  const data = fs.readFileSync(filePath);
  const header = Buffer.alloc(8);
  header.write(entry.type, 0, 'ascii');
  header.writeUInt32BE(data.length + 8, 4);

  chunks.push(Buffer.concat([header, data]));
}

if (chunks.length === 0) {
  console.error('No icon PNGs found to build icns.');
  process.exit(1);
}

const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 8);
const icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns', 0, 'ascii');
icnsHeader.writeUInt32BE(totalLength, 4);

const output = Buffer.concat([icnsHeader, ...chunks]);
const outputPath = path.join(iconDir, 'icon.icns');
fs.writeFileSync(outputPath, output);

console.log(`Generated ${outputPath} (${output.length} bytes).`);

