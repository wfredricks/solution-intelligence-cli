/**
 * Tests for src/credentials.ts.
 *
 * // Why: We exercise the on-disk surface (round-trip, mode enforcement,
 * // URL normalization, atomicity-under-concurrency) because the credentials
 * // store is the only file in the CLI that holds a secret. Subtle bugs here
 * // become "user's token went missing" or, worse, "user's token leaked".
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  loadCredentials,
  saveCredentials,
  getEntry,
  setEntry,
  clearEntry,
  normalizeUrl,
  credentialsDir,
  credentialsPath,
  type CredentialEntry,
} from '../src/credentials.js';

let originalHome: string | undefined;
let tmpHome: string;

beforeEach(async () => {
  originalHome = process.env.HOME;
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'si-cli-creds-'));
  process.env.HOME = tmpHome;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  await fs.rm(tmpHome, { recursive: true, force: true });
});

const sampleEntry = (over: Partial<CredentialEntry> = {}): CredentialEntry => ({
  token: 'tok_abc',
  email: 'alice@example.com',
  issuedAt: '2026-05-20T23:59:00.000Z',
  expiresAt: '2026-06-23T03:00:00.000Z',
  ...over,
});

describe('credentialsDir / credentialsPath', () => {
  it('respects HOME', () => {
    expect(credentialsDir()).toBe(path.join(tmpHome, '.si'));
    expect(credentialsPath()).toBe(path.join(tmpHome, '.si', 'credentials'));
  });
});

describe('normalizeUrl', () => {
  it('lowercases host and strips trailing slash on root', () => {
    expect(normalizeUrl('http://LocalHost:3001/')).toBe(
      'http://localhost:3001',
    );
    expect(normalizeUrl('http://localhost:3001')).toBe(
      'http://localhost:3001',
    );
  });

  it('drops default http port', () => {
    expect(normalizeUrl('http://si.example.com:80/')).toBe(
      'http://si.example.com',
    );
  });

  it('drops default https port', () => {
    expect(normalizeUrl('https://si.example.com:443/')).toBe(
      'https://si.example.com',
    );
  });

  it('keeps non-root path but trims trailing slash', () => {
    expect(normalizeUrl('http://localhost:3001/api/')).toBe(
      'http://localhost:3001/api',
    );
  });

  it('strips query and fragment', () => {
    expect(normalizeUrl('http://localhost:3001/?x=1#frag')).toBe(
      'http://localhost:3001',
    );
  });

  it('throws on invalid url', () => {
    expect(() => normalizeUrl('not a url')).toThrow();
  });
});

describe('loadCredentials', () => {
  it('returns {} when the file is absent', async () => {
    const out = await loadCredentials();
    expect(out).toEqual({});
  });

  it('returns {} for an empty file', async () => {
    await fs.mkdir(credentialsDir(), { recursive: true, mode: 0o700 });
    await fs.writeFile(credentialsPath(), '', { mode: 0o600 });
    const out = await loadCredentials();
    expect(out).toEqual({});
  });

  it('throws on non-object JSON', async () => {
    await fs.mkdir(credentialsDir(), { recursive: true, mode: 0o700 });
    await fs.writeFile(credentialsPath(), JSON.stringify(['arr']), {
      mode: 0o600,
    });
    await expect(loadCredentials()).rejects.toThrow();
  });
});

describe('save / load round-trip', () => {
  it('preserves entries exactly', async () => {
    const url = 'http://localhost:3001';
    const entry = sampleEntry();
    await saveCredentials({ [url]: entry });
    const out = await loadCredentials();
    expect(out).toEqual({ [url]: entry });
  });

  it('enforces mode 0600 on the saved file', async () => {
    await saveCredentials({
      'http://localhost:3001': sampleEntry(),
    });
    const stat = await fs.stat(credentialsPath());
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('creates the parent directory with mode 0700', async () => {
    await saveCredentials({
      'http://localhost:3001': sampleEntry(),
    });
    const stat = await fs.stat(credentialsDir());
    // The high bits include 0o40000 (directory) — only check the low 9.
    expect(stat.mode & 0o777).toBe(0o700);
  });

  it('warns when the existing file is world-readable', async () => {
    await fs.mkdir(credentialsDir(), { recursive: true, mode: 0o700 });
    await fs.writeFile(credentialsPath(), JSON.stringify({}), { mode: 0o600 });
    await fs.chmod(credentialsPath(), 0o644);
    const writes: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    // Capture writes without using a vitest mock; less noise on regression.
    (process.stderr as unknown as { write: typeof original }).write = ((
      chunk: string,
    ): true => {
      writes.push(chunk);
      return true;
    }) as typeof original;
    try {
      await loadCredentials();
    } finally {
      (process.stderr as unknown as { write: typeof original }).write =
        original;
    }
    expect(writes.join('')).toMatch(/expected 0600/);
  });
});

describe('getEntry / setEntry / clearEntry', () => {
  it('returns null when no entry exists', async () => {
    expect(await getEntry('http://localhost:3001')).toBeNull();
  });

  it('round-trips a single entry by URL', async () => {
    await setEntry('http://localhost:3001', sampleEntry());
    const out = await getEntry('http://localhost:3001');
    expect(out).not.toBeNull();
    expect(out!.token).toBe('tok_abc');
  });

  it('treats URL variants as the same key', async () => {
    await setEntry('http://LocalHost:3001/', sampleEntry());
    expect(await getEntry('http://localhost:3001')).not.toBeNull();
    expect(await getEntry('HTTP://LOCALHOST:3001/')).not.toBeNull();
  });

  it('clearEntry removes one entry without disturbing others', async () => {
    await setEntry('http://localhost:3001', sampleEntry({ token: 'a' }));
    await setEntry('http://localhost:4001', sampleEntry({ token: 'b' }));
    await clearEntry('http://localhost:3001');
    expect(await getEntry('http://localhost:3001')).toBeNull();
    expect(await getEntry('http://localhost:4001')).not.toBeNull();
  });

  it('clearEntry on a missing key is a no-op', async () => {
    await expect(
      clearEntry('http://localhost:9999'),
    ).resolves.toBeUndefined();
  });
});

describe('atomicity', () => {
  it('serial writes always yield a parseable file', async () => {
    // Five serial writes, each replacing the entry.
    for (let i = 0; i < 5; i++) {
      await setEntry('http://localhost:3001', sampleEntry({ token: `t${i}` }));
      const out = await loadCredentials();
      expect(out['http://localhost:3001']!.token).toBe(`t${i}`);
    }
  });

  it('concurrent writes never leave a corrupt file', async () => {
    // 10 concurrent writes to distinct URLs. Last writer wins on overlaps,
    // but the file must always be valid JSON afterward.
    const writes = [];
    for (let i = 0; i < 10; i++) {
      writes.push(
        setEntry(`http://host-${i}.example.com:3001`, sampleEntry({ token: `t${i}` })),
      );
    }
    await Promise.all(writes);
    // Whatever the final state, loadCredentials must succeed.
    const out = await loadCredentials();
    expect(typeof out).toBe('object');
    // At least one entry must have survived.
    expect(Object.keys(out).length).toBeGreaterThan(0);
  });

  it('no leftover .tmp files after writes', async () => {
    await setEntry('http://localhost:3001', sampleEntry());
    const files = await fs.readdir(credentialsDir());
    const tmps = files.filter((f) => f.startsWith('credentials.tmp.'));
    expect(tmps).toEqual([]);
  });
});
