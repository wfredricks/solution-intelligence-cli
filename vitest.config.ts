import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
      include: ['src/**/*.ts'],
      // Why: src/index.ts is just a VERSION export; src/cli.ts is a thin
      // bin shim that runs as a subprocess (the smoke test execs the built
      // dist/cli.js). Neither is meaningfully reachable from in-process
      // coverage instrumentation at v0.1.0-pre, so both are excluded from
      // the 80% gate. Stage 2 will reintroduce coverage for the real CLI
      // command tree.
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/cli.ts'],
    },
  },
});
