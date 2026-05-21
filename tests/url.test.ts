/**
 * Tests for src/url.ts.
 *
 * // Why: Precedence bugs in URL resolution would let the wrong SI/I
 * // service receive a token — worst case a token meant for a staging URL
 * // landing in a public hosted service. We test every precedence rung
 * // plus the walk-up edge cases.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { resolveUrl, findProjectConfig } from '../src/url.js';

let originalEnv: string | undefined;
let originalCwd: string;
let tmp: string;

beforeEach(async () => {
  originalEnv = process.env.SI_URL;
  delete process.env.SI_URL;
  originalCwd = process.cwd();
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'si-cli-url-'));
});

afterEach(async () => {
  if (originalEnv === undefined) delete process.env.SI_URL;
  else process.env.SI_URL = originalEnv;
  // Restore cwd unconditionally; some tests chdir into the tmp tree.
  try {
    process.chdir(originalCwd);
  } catch {
    /* tolerate cwd loss in pathological cases */
  }
  await fs.rm(tmp, { recursive: true, force: true });
});

async function writeConfig(dir: string, url: string | null): Promise<string> {
  const cfgDir = path.join(dir, '.si');
  await fs.mkdir(cfgDir, { recursive: true });
  const body =
    url === null ? 'unrelated: { key: value }\n' : `si:\n  url: ${url}\n`;
  const cfgPath = path.join(cfgDir, 'config.yaml');
  await fs.writeFile(cfgPath, body);
  return cfgPath;
}

describe('resolveUrl precedence', () => {
  it('returns flag when provided, ignoring env + config', async () => {
    process.env.SI_URL = 'http://from-env:1';
    await writeConfig(tmp, 'http://from-config:1');
    process.chdir(tmp);
    const out = await resolveUrl('http://from-flag:1');
    expect(out).toEqual({ url: 'http://from-flag:1', source: 'flag' });
  });

  it('uses env when flag is absent', async () => {
    process.env.SI_URL = 'http://from-env:1';
    await writeConfig(tmp, 'http://from-config:1');
    process.chdir(tmp);
    const out = await resolveUrl();
    expect(out).toEqual({ url: 'http://from-env:1', source: 'env' });
  });

  it('uses config when flag + env are absent', async () => {
    await writeConfig(tmp, 'http://from-config:1');
    // Why: macOS resolves /var → /private/var via symlink. We chdir into
    // the tmp dir then use process.cwd() to normalize so the path the
    // production code reports matches what the test built.
    process.chdir(tmp);
    const realRoot = process.cwd();
    const realCfg = path.join(realRoot, '.si', 'config.yaml');
    const out = await resolveUrl();
    expect(out.source).toBe('config');
    expect(out.url).toBe('http://from-config:1');
    expect(out.configPath).toBe(realCfg);
  });

  it("returns source: 'none' when nothing is configured", async () => {
    process.chdir(tmp);
    const out = await resolveUrl();
    expect(out).toEqual({ url: '', source: 'none' });
  });

  it('ignores empty/whitespace flag and env', async () => {
    process.env.SI_URL = '   ';
    await writeConfig(tmp, 'http://from-config:1');
    process.chdir(tmp);
    const out = await resolveUrl('   ');
    expect(out.source).toBe('config');
  });
});

describe('findProjectConfig walk-up', () => {
  it('finds config in the start dir itself', async () => {
    const cfg = await writeConfig(tmp, 'http://x');
    const out = await findProjectConfig(tmp);
    expect(out).toEqual({ path: cfg, url: 'http://x' });
  });

  it('finds config in a parent directory', async () => {
    const cfg = await writeConfig(tmp, 'http://x');
    const nested = path.join(tmp, 'a', 'b', 'c');
    await fs.mkdir(nested, { recursive: true });
    const out = await findProjectConfig(nested);
    expect(out).toEqual({ path: cfg, url: 'http://x' });
  });

  it('returns null when no config exists in the chain', async () => {
    const nested = path.join(tmp, 'a', 'b');
    await fs.mkdir(nested, { recursive: true });
    const out = await findProjectConfig(nested);
    expect(out).toBeNull();
  });

  it('child config wins over parent when both exist', async () => {
    await writeConfig(tmp, 'http://parent');
    const childDir = path.join(tmp, 'child');
    await fs.mkdir(childDir);
    const childCfg = await writeConfig(childDir, 'http://child');
    const out = await findProjectConfig(childDir);
    expect(out!.path).toBe(childCfg);
    expect(out!.url).toBe('http://child');
  });

  it('skips a config with no si.url and continues walking', async () => {
    await writeConfig(tmp, 'http://parent');
    const childDir = path.join(tmp, 'child');
    await fs.mkdir(childDir);
    await writeConfig(childDir, null);
    const out = await findProjectConfig(childDir);
    expect(out!.url).toBe('http://parent');
  });

  it('surfaces a clear error when YAML is malformed', async () => {
    const cfgDir = path.join(tmp, '.si');
    await fs.mkdir(cfgDir, { recursive: true });
    await fs.writeFile(path.join(cfgDir, 'config.yaml'), 'si:\n  url: [unterminated\n');
    await expect(findProjectConfig(tmp)).rejects.toThrow(/Failed to parse/);
  });
});
