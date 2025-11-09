import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: ['electron/main.ts', 'electron/preload.ts'],
  format: ['cjs'],
  dts: true,
  outDir: 'dist-electron',
  sourcemap: false,
  clean: !options.watch,
  splitting: false,
  platform: 'node',
  target: 'node20',
  external: ['electron', 'electron/main', 'electron/common', 'electron/renderer']
}));

