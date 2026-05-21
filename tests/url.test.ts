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

import {
  resolveUrl,
  resolveProjectConfig,
  findProjectConfig,
} from '../src/url.js';

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

/**
 * Write a `.si/config.yaml` with a custom YAML body.
 *
 * // Why: The Stage 2c tests need configs with multiple keys under `si:`
 * // (e.g. `si.url` AND `si.graphUrl`) to verify that `resolveProjectConfig`
 * // surfaces the full block. `writeConfig` above only produces the
 * // single-key shape.
 */
async function writeConfigRaw(dir: string, body: string): Promise<string> {
  const cfgDir = path.join(dir, '.si');
  await fs.mkdir(cfgDir, { recursive: true });
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

describe('resolveProjectConfig (Stage 2c)', () => {
  it('returns the full si: block when the config has multiple keys', async () => {
    await writeConfigRaw(
      tmp,
      'si:\n  url: http://from-config:1\n  graphUrl: http://graph:2\n  studioUrl: http://studio:3\n',
    );
    process.chdir(tmp);
    const out = await resolveProjectConfig();
    expect(out.urlSource).toBe('config');
    expect(out.config.si.url).toBe('http://from-config:1');
    expect(out.config.si.graphUrl).toBe('http://graph:2');
    expect(out.config.si.studioUrl).toBe('http://studio:3');
    // path is set because the URL came from the discovered config file.
    const realRoot = process.cwd();
    expect(out.config.path).toBe(path.join(realRoot, '.si', 'config.yaml'));
  });

  it('returns empty si: {} when no config file is found and no flag/env supplied', async () => {
    process.chdir(tmp);
    const out = await resolveProjectConfig();
    expect(out).toEqual({ config: { si: {} }, urlSource: 'none' });
  });

  it('urlSource respects flag > env > config precedence', async () => {
    process.env.SI_URL = 'http://from-env:1';
    await writeConfig(tmp, 'http://from-config:1');
    process.chdir(tmp);

    // flag wins over env + config
    const withFlag = await resolveProjectConfig('http://from-flag:1');
    expect(withFlag.urlSource).toBe('flag');
    expect(withFlag.config.si.url).toBe('http://from-flag:1');

    // env wins over config when no flag
    const withEnv = await resolveProjectConfig();
    expect(withEnv.urlSource).toBe('env');
    expect(withEnv.config.si.url).toBe('http://from-env:1');

    // config wins when no flag, no env
    delete process.env.SI_URL;
    const withConfig = await resolveProjectConfig();
    expect(withConfig.urlSource).toBe('config');
    expect(withConfig.config.si.url).toBe('http://from-config:1');
  });

  it('preserves non-URL si: keys when flag overrides the URL', async () => {
    // Why: Stage 3 will read graphUrl/studioUrl from the config even when
    // the URL itself comes from --url. The on-disk graphUrl must survive
    // the flag override.
    await writeConfigRaw(
      tmp,
      'si:\n  url: http://from-config:1\n  graphUrl: http://graph:2\n',
    );
    process.chdir(tmp);
    const out = await resolveProjectConfig('http://from-flag:1');
    expect(out.urlSource).toBe('flag');
    expect(out.config.si.url).toBe('http://from-flag:1');
    expect(out.config.si.graphUrl).toBe('http://graph:2');
    // path is still set because the file was discovered, even though the
    // URL did not come from it.
    const realRoot = process.cwd();
    expect(out.config.path).toBe(path.join(realRoot, '.si', 'config.yaml'));
  });

  it('config.path is undefined when no config file is found', async () => {
    process.env.SI_URL = 'http://from-env:1';
    process.chdir(tmp);
    const out = await resolveProjectConfig();
    expect(out.urlSource).toBe('env');
    expect(out.config.si.url).toBe('http://from-env:1');
    expect(out.config.path).toBeUndefined();
  });

  it('whitespace-only url in config is treated as unset', async () => {
    // Why: matches the existing resolveUrl behavior of ignoring blank URLs.
    // The walk-up should fall through to a parent config rather than
    // locking in an empty string.
    await writeConfig(tmp, 'http://parent');
    const childDir = path.join(tmp, 'child');
    await fs.mkdir(childDir);
    await writeConfigRaw(childDir, 'si:\n  url: "   "\n');
    process.chdir(childDir);
    const out = await resolveProjectConfig();
    expect(out.urlSource).toBe('config');
    expect(out.config.si.url).toBe('http://parent');
  });
});

describe('resolveUrl wrapper backward-compat (Stage 2c)', () => {
  it('configPath is only set when the URL came from the config file', async () => {
    // Why: Pre-Stage-2c, configPath was the URL's provenance, not a
    // generic "a config file existed somewhere" hint. When the flag wins,
    // configPath must be undefined even if a config file exists.
    process.env.SI_URL = 'http://from-env:1';
    await writeConfig(tmp, 'http://from-config:1');
    process.chdir(tmp);

    const fromFlag = await resolveUrl('http://from-flag:1');
    expect(fromFlag.source).toBe('flag');
    expect(fromFlag.configPath).toBeUndefined();

    const fromEnv = await resolveUrl();
    expect(fromEnv.source).toBe('env');
    expect(fromEnv.configPath).toBeUndefined();

    delete process.env.SI_URL;
    const fromConfig = await resolveUrl();
    expect(fromConfig.source).toBe('config');
    expect(fromConfig.configPath).toBeDefined();
  });
});
