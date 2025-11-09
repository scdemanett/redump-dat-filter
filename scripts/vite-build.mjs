process.env.VITE_CJS_IGNORE_WARNING ??= '1';

import { build } from 'vite';

try {
  await build();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

