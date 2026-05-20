import { defineConfig } from 'tsup';

// Why: cli builds two entrypoints — the library export (src/index.ts)
//      and the runnable bin (src/cli.ts) wired in package.json#bin.
//      Stage 2 will replace the cli.ts stub with the real command tree
//      (init / add / destroy per REQ-SI-007).
export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
});
