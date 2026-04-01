import { buildSync } from 'esbuild';

buildSync({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/index.js',
  external: ['eventsource', 'node:fs', 'node:path'],
});
