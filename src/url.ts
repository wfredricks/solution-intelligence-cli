/**
 * URL resolution for the `si` CLI.
 *
 * // Why: Three legal places to specify the SI/I base URL — `--url` flag,
 * // `SI_URL` env var, or a `.si/config.yaml` discovered by walking up from
 * // the current working directory. Precedence is flag > env > config; if
 * // none yield a URL we return a typed "none" outcome and let the caller
 * // decide whether to surface a usage error. Centralizing the precedence
 * // here means every command behaves identically.
 *
 * `.si/config.yaml` shape (v0.1):
 *
 *   si:
 *     url: http://localhost:3001
 *
 * @module url
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Outcome of {@link resolveUrl}. `source` tells the caller where the URL came
 * from, which is useful both for diagnostics (`source: 'env'` is a hint to
 * check `SI_URL`) and for tests.
 *
 * @requirement REQ-SI-NF-052
 */
export interface UrlResolution {
  /** Resolved URL string, or empty when `source === 'none'`. */
  url: string;
  /** Which input layer won. */
  source: 'flag' | 'env' | 'config' | 'none';
  /** Path to the `.si/config.yaml` that supplied the URL (when applicable). */
  configPath?: string;
}

// ─── Project-config walk-up ──────────────────────────────────────────────────

/**
 * Walk up from `startDir` (defaults to cwd) looking for `.si/config.yaml`.
 *
 * // Why: A user may run `si` from anywhere inside a project tree. We mimic
 * // `git`'s "find the project root" pattern so the closest config wins. The
 * // first `.si/config.yaml` encountered while walking toward the filesystem
 * // root is returned. We stop at the root rather than ascending into HOME so
 * // a stray `~/.si/config.yaml` doesn't accidentally apply to every command.
 *
 * Returns the discovered path + parsed URL, or `null` if nothing found or the
 * file is present but has no `si.url` key.
 */
export async function findProjectConfig(
  startDir?: string,
): Promise<{ path: string; url: string } | null> {
  let cur = path.resolve(startDir ?? process.cwd());
  // Loop until the parent equals the current path (i.e. we hit "/").
  // Bounded to ~50 hops as a paranoia guard against symlink loops.
  for (let i = 0; i < 50; i++) {
    const candidate = path.join(cur, '.si', 'config.yaml');
    let raw: string | null = null;
    try {
      raw = await fs.readFile(candidate, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
    if (raw !== null) {
      let parsed: unknown;
      try {
        parsed = parseYaml(raw);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to parse ${candidate}: ${msg}`);
      }
      const url = readSiUrl(parsed);
      if (url) return { path: candidate, url };
      // Why: A config file with no si.url is "found but unusable". We
      // continue the walk so a parent config can supply the URL — matches
      // user intuition ("the child config narrows, doesn't blank out").
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

/**
 * Extract `si.url` from a parsed YAML document.
 *
 * // Why: Split out so a future enrichment (e.g. supporting `si: { profile:
 * // ... }`) has one obvious place to grow. Returns null for any shape that
 * // isn't `{ si: { url: string } }`.
 */
function readSiUrl(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const si = (parsed as Record<string, unknown>).si;
  if (typeof si !== 'object' || si === null) return null;
  const url = (si as Record<string, unknown>).url;
  if (typeof url !== 'string' || url.trim().length === 0) return null;
  return url.trim();
}

// ─── Top-level resolution ────────────────────────────────────────────────────

/**
 * Resolve the SI/I base URL according to the documented precedence.
 *
 * // Why: Commands call this once at start-of-flow. The returned `source`
 * // lets us print "using URL from $SI_URL" diagnostics when verbose mode
 * // arrives later without duplicating the logic in every command.
 *
 * @param flagUrl The `--url <url>` value, if the user passed one.
 *
 * @requirement REQ-SI-NF-052
 */
export async function resolveUrl(flagUrl?: string): Promise<UrlResolution> {
  if (flagUrl && flagUrl.trim().length > 0) {
    return { url: flagUrl.trim(), source: 'flag' };
  }
  const envUrl = process.env.SI_URL;
  if (envUrl && envUrl.trim().length > 0) {
    return { url: envUrl.trim(), source: 'env' };
  }
  const config = await findProjectConfig();
  if (config) {
    return { url: config.url, source: 'config', configPath: config.path };
  }
  return { url: '', source: 'none' };
}
