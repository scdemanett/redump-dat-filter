import fs from 'node:fs';
import path from 'node:path';

const releaseDir = path.resolve('release');

if (!fs.existsSync(releaseDir)) {
  console.error('Release directory not found:', releaseDir);
  process.exit(1);
}

let renamed = 0;

for (const fileName of fs.readdirSync(releaseDir)) {
  if (!fileName.includes('-setup-') || !fileName.endsWith('.zip')) {
    continue;
  }

  const nextName = fileName.replace('-setup-', '-unpacked-');
  fs.renameSync(path.join(releaseDir, fileName), path.join(releaseDir, nextName));
  console.log(`Renamed ${fileName} -> ${nextName}`);
  renamed += 1;
}

console.log(`Renamed ${renamed} portable zip artifact(s).`);
