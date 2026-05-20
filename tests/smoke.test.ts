import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { VERSION } from '../src/index.js';

describe('@solution-intelligence/cli scaffold', () => {
  it('exposes a version string', () => {
    expect(VERSION).toBeTypeOf('string');
    expect(VERSION).toMatch(/^0\.1\.0-pre$/);
  });

  it('cli binary prints version', () => {
    // Why: opt-in check. Only runs after `npm run build` materializes
    // dist/cli.js. CI runs `npm install && npm run build && npm test`,
    // so by the time vitest runs in CI this assertion is exercised.
    // Local `npm test` without a prior build stays green by skipping.
    if (!existsSync('dist/cli.js')) return;
    const out = execSync('node dist/cli.js --version').toString().trim();
    expect(out).toBe(VERSION);
  });
});
