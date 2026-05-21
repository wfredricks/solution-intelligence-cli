/**
 * URL + project-config resolution for the `si` CLI.
 *
 * // Why: Three legal places to specify the SI/I base URL — `--url` flag,
 * // `SI_URL` env var, or a `.si/config.yaml` discovered by walking up from
 * // the current working directory. Precedence is flag > env > config; if
 * // none yield a URL we return a typed "none" outcome and let the caller
 * // decide whether to surface a usage error. Centralizing the precedence
 * // here means every command behaves identically.
 *
 * // Why two surfaces: Stage 2b shipped only the URL slice as
 * // `resolveUrl()`. Stage 3 (Graph + GraphLoader) will want more keys
 * // from `.si/config.yaml` — `si.graphUrl`, `si.studioUrl`, etc. —
 * // without duplicating the walk-up logic. The new top-level surface is
 * // `resolveProjectConfig()`, which returns the full `.si/config.yaml`
 * // record plus the URL precedence outcome. `resolveUrl()` is retained
 * // as a thin backward-compatible wrapper so existing callers (the
 * // commands) keep working unchanged.
 *
 * `.si/config.yaml` shape (v0.1):
 *
 *   si:
 *     url: http://localhost:3001
 *
 * Future Stage 3 shape (forward-compatible — extra keys are preserved on
 * the returned `config.si` record but not interpreted yet):
 *
 *   si:
 *     url:      http://localhost:3001
 *     graphUrl: http://localhost:3002
 *     studioUrl: http://localhost:3003
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

/**
 * Parsed `.si/config.yaml` record.
 *
 * // Why: Stage 3 will extend the `si:` block with `graphUrl`, `studioUrl`,
 * // and other keys. Modeling `si` as an open record with `url?` typed
 * // explicitly keeps Stage 2 callers strongly typed for the URL slice
 * // while letting Stage 3 consumers read additional keys with a one-line
 * // type cast at the call site.
 */
export interface ProjectConfig {
  /** Path to the `.si/config.yaml` file when discovered via walk-up. */
  path?: string;
  /** The full `si:` block from the config. */
  si: {
    url?: string;
    // Future Stage 3 keys land here as named fields (graphUrl, studioUrl).
    [key: string]: unknown;
  };
}

/**
 * Outcome of {@link resolveProjectConfig}.
 *
 * // Why: The same precedence rules (flag > env > config) that applied to
 * // the bare URL still apply to `config.si.url`. Callers that only need
 * // the URL use the legacy {@link resolveUrl} wrapper; callers that
 * // need the full record (Stage 3) read `config.si.*` directly and use
 * // `urlSource` for the same diagnostics the URL-only surface provided.
 */
export interface ProjectConfigResolution {
  /** The resolved project config record. Empty `si: {}` when `urlSource === 'none'` and no config file was found. */
  config: ProjectConfig;
  /** Which input layer the URL (if any) came from. */
  urlSource: 'flag' | 'env' | 'config' | 'none';
}

// ─── Project-config walk-up ──────────────────────────────────────────────────

/**
 * Internal: walk up from `startDir` (defaults to cwd) looking for
 * `.si/config.yaml` and return the discovered path + parsed `si:` block.
 *
 * // Why: A user may run `si` from anywhere inside a project tree. We mimic
 * // git's "find the project root" pattern so the closest config wins. The
 * // first `.si/config.yaml` encountered while walking toward the filesystem
 * // root is returned. We stop at the root rather than ascending into HOME so
 * // a stray `~/.si/config.yaml` does not accidentally apply to every command.
 *
 * // Why surface the full `si:` block here (Stage 2c change): the old
 * // helper returned only `{ path, url }`. Stage 3 needs `graphUrl`,
 * // `studioUrl`, etc. Returning the full parsed `si:` block keeps the
 * // walk-up logic single-sourced and lets the top-level resolvers slice
 * // what they need.
 *
 * Returns the discovered path + parsed `si:` block, or `null` if no
 * `.si/config.yaml` with a non-empty `si:` block is found.
 */
async function readProjectConfig(
  startDir?: string,
): Promise<{ path: string; si: ProjectConfig['si'] } | null> {
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
      const si = readSiBlock(parsed);
      if (si) return { path: candidate, si };
      // Why: A config file with no usable `si:` block is "found but
      // unusable". We continue the walk so a parent config can supply
      // the data — matches user intuition (a child config narrows, it
      // does not blank out the parent).
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

/**
 * Walk up looking for `.si/config.yaml` and return `{ path, url }`.
 *
 * // Why: Kept as a public surface because Stage 2b tests and a small
 * // number of downstream callers exercise it directly. Implemented in
 * // terms of {@link readProjectConfig}: the file must have a usable
 * // `si.url` string for this helper to return non-null, matching the
 * // pre-Stage-2c behavior exactly.
 */
export async function findProjectConfig(
  startDir?: string,
): Promise<{ path: string; url: string } | null> {
  const found = await readProjectConfig(startDir);
  if (!found) return null;
  const url = typeof found.si.url === 'string' ? found.si.url.trim() : '';
  if (url.length === 0) return null;
  return { path: found.path, url };
}

/**
 * Extract the `si:` block from a parsed YAML document.
 *
 * // Why: Split out so a future enrichment (e.g. validating that `si.url`
 * // is well-formed, or surfacing typed warnings for unknown keys) has
 * // one obvious place to grow. Returns null for any shape that is not
 * // `{ si: { ... } }` with at least one key. The url field is normalized
 * // (trimmed) when present.
 */
function readSiBlock(parsed: unknown): ProjectConfig['si'] | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const si = (parsed as Record<string, unknown>).si;
  if (typeof si !== 'object' || si === null) return null;
  const block: ProjectConfig['si'] = { ...(si as Record<string, unknown>) };
  if (typeof block.url === 'string') {
    const trimmed = block.url.trim();
    if (trimmed.length === 0) {
      delete block.url;
    } else {
      block.url = trimmed;
    }
  } else if (block.url !== undefined) {
    // Non-string url is unusable; drop it.
    delete block.url;
  }
  // Empty block is unusable.
  if (Object.keys(block).length === 0) return null;
  return block;
}

// ─── Top-level resolution ────────────────────────────────────────────────────

/**
 * Resolve the full project config + URL precedence in one call.
 *
 * // Why: Stage 3 needs more than just the SI/I URL — it needs the entire
 * // `.si/config.yaml` record so it can pull graphUrl, studioUrl, etc.
 * // without duplicating the walk-up logic. The URL precedence (flag > env
 * // > config) still applies to the SI/I URL; other config keys come
 * // purely from the discovered config file.
 *
 * Behavior:
 * - Walks up looking for `.si/config.yaml` (via {@link readProjectConfig}).
 *   If found, the discovered `si:` block populates `config.si` and
 *   `config.path` records the file location.
 * - Applies precedence flag > env > config to determine the effective URL.
 * - If flag or env wins, the returned `config.si.url` is overwritten with
 *   that winning value so callers reading `config.si.url` see the
 *   effective URL (not the on-disk one).
 * - When no config file was found AND no flag/env URL was supplied,
 *   returns `{ config: { si: {} }, urlSource: 'none' }`.
 *
 * @param flagUrl The `--url <url>` value, if the user passed one.
 *
 * @requirement REQ-SI-NF-052
 */
export async function resolveProjectConfig(
  flagUrl?: string,
): Promise<ProjectConfigResolution> {
  // 1. Walk up to find .si/config.yaml; parse the full si: block.
  const onDisk = await readProjectConfig();
  const config: ProjectConfig = onDisk
    ? { path: onDisk.path, si: { ...onDisk.si } }
    : { si: {} };

  // 2. Apply flag > env > config precedence to the URL.
  const trimmedFlag = flagUrl?.trim();
  if (trimmedFlag && trimmedFlag.length > 0) {
    config.si.url = trimmedFlag;
    return { config, urlSource: 'flag' };
  }
  const envUrl = process.env.SI_URL?.trim();
  if (envUrl && envUrl.length > 0) {
    config.si.url = envUrl;
    return { config, urlSource: 'env' };
  }
  if (typeof config.si.url === 'string' && config.si.url.length > 0) {
    return { config, urlSource: 'config' };
  }
  return { config, urlSource: 'none' };
}

/**
 * Resolve the SI/I base URL according to the documented precedence.
 *
 * // Why: Backward-compatible wrapper around {@link resolveProjectConfig}.
 * // Stage 2b callers (the login/grant/revoke commands) want just the
 * // URL slice; they keep using this shape unchanged. Stage 3 callers
 * // that need more keys call `resolveProjectConfig` directly.
 *
 * @param flagUrl The `--url <url>` value, if the user passed one.
 *
 * @requirement REQ-SI-NF-052
 */
export async function resolveUrl(flagUrl?: string): Promise<UrlResolution> {
  const { config, urlSource } = await resolveProjectConfig(flagUrl);
  const url =
    typeof config.si.url === 'string' && config.si.url.length > 0
      ? config.si.url
      : '';
  const result: UrlResolution = { url, source: urlSource };
  // Why: only surface configPath when the URL itself came from the
  // discovered config file. If flag or env wins, the config file may
  // exist but is not the source of the URL — matching the pre-Stage-2c
  // contract that configPath is the URL provenance, not a generic
  // "config was found here" hint.
  if (urlSource === 'config' && config.path) {
    result.configPath = config.path;
  }
  return result;
}
