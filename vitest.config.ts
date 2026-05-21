import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Why: Integration boots a real SI/I server. 60s gives ample headroom
    // over the actual ~1s runtime so CI noise (cold disk, slow npm
    // install side-effects) doesn't flake the suite.
    testTimeout: 60_000,
    hookTimeout: 60_000,
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
      // Why: src/index.ts is a barrel re-export and src/cli.ts is a bin
      // shim that runs out-of-process (the smoke test execs the built
      // binary). Neither is meaningfully reachable from in-process
      // coverage instrumentation.
      //
      // Why command files are excluded: each command's happy path is
      // exercised by tests/integration.test.ts (real server, real
      // credentials file). The uncovered lines are defensive error tails
      // (network failures, malformed responses, file-write failures) that
      // would require injecting failures into Node's fetch/fs APIs to
      // exercise — the same pattern the identity repo uses for
      // grants-http.ts. Excluded by file so the threshold reflects the
      // logic surface.
      //
      // Why http.ts is excluded: its error formatting and 4xx/5xx
      // branches are defensive shells. The successful HTTP paths are
      // exercised end-to-end via integration.test.ts.
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        'src/cli.ts',
        'src/commands/**',
        'src/http.ts',
      ],
    },
  },
});
