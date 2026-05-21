/**
 * Credentials store for the `si` CLI.
 *
 * // Why: After `si login` succeeds, the user holds a long-form SI/I token
 * // they shouldn't have to retype for every subsequent command. We persist
 * // it on disk under `~/.si/credentials` keyed by SI/I base URL so a single
 * // workstation can hold tokens for multiple SI deployments (dev box,
 * // staging, prod) concurrently. JSON over a binary keyring is intentional:
 * // human-inspectable, grep-able, copy-able. The mode-0600 / 0700
 * // enforcement and atomic-write pattern keep the security posture honest
 * // without dragging in a system-keychain dependency at v0.2.
 *
 * Layout on disk:
 *
 *   ~/.si/                    (dir, mode 0700)
 *     credentials             (file, mode 0600, JSON)
 *     credentials.tmp.<rand>  (transient during atomic writes)
 *
 * File shape:
 *
 *   {
 *     "http://localhost:3001": {
 *       "token": "...",
 *       "email": "alice@example.com",
 *       "issuedAt": "2026-05-20T23:59:00.000Z",
 *       "expiresAt": "2026-06-23T03:00:00.000Z"
 *     }
 *   }
 *
 * @module credentials
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A single saved credential keyed by SI/I base URL.
 *
 * @requirement REQ-SI-NF-052 (JSDoc on exported symbols)
 */
export interface CredentialEntry {
  /** The full SI/I bearer token returned by `/auth/verify-code`. */
  token: string;
  /** Email the token was issued to. Echoed for human-readable identification. */
  email: string;
  /** When the token was acquired. ISO-8601 UTC. */
  issuedAt: string;
  /** When the token is expected to expire. ISO-8601 UTC. Best-effort hint. */
  expiresAt: string;
}

/**
 * The on-disk credentials map. Keys are normalized SI/I base URLs.
 *
 * // Why: Map shape rather than array because lookups happen on every
 * // authenticated command and URL keys are naturally unique.
 *
 * @requirement REQ-SI-NF-052
 */
export interface Credentials {
  [siUrl: string]: CredentialEntry;
}

// ─── Path resolution ─────────────────────────────────────────────────────────

/**
 * Directory holding the credentials file. Override `HOME` to redirect in tests.
 *
 * // Why: Exported as a function (not a constant) so tests that mutate
 * // `process.env.HOME` between cases see the change. Node caches `os.homedir()`
 * // per call so this is correct.
 */
export function credentialsDir(): string {
  return path.join(os.homedir(), '.si');
}

/** Absolute path to the credentials JSON file. */
export function credentialsPath(): string {
  return path.join(credentialsDir(), 'credentials');
}

// ─── URL normalization ───────────────────────────────────────────────────────

/**
 * Normalize an SI/I base URL into a stable map key.
 *
 * // Why: `http://LocalHost:3001/`, `http://localhost:3001`, and
 * // `http://localhost:3001/` all point at the same service. Without a
 * // canonical form, a user could `si login` against one form and find their
 * // token missing when a later command uses the other. Normalization rules:
 * //   - lowercase scheme + host
 * //   - default ports stripped (http:80, https:443)
 * //   - trailing slash on the pathname removed (except for "/")
 * //   - query/fragment dropped entirely (these aren't meaningful for an SI/I base)
 *
 * Throws if the input isn't a parseable URL.
 */
export function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hostname = url.hostname.toLowerCase();
  url.protocol = url.protocol.toLowerCase();
  url.hash = '';
  url.search = '';
  // Strip default ports
  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = '';
  }
  let serialized = url.toString();
  // URL serialization always appends "/" for the root; preserve it for "/"
  // alone but strip any other trailing "/".
  if (serialized.endsWith('/') && url.pathname !== '/') {
    serialized = serialized.slice(0, -1);
  }
  // For root path, drop the trailing slash so "http://localhost:3001/" →
  // "http://localhost:3001". Matches what users will type most often.
  if (url.pathname === '/' && serialized.endsWith('/')) {
    serialized = serialized.slice(0, -1);
  }
  return serialized;
}

// ─── Mode-guard helpers ──────────────────────────────────────────────────────

/**
 * Ensure the credentials directory exists with mode 0700.
 *
 * // Why: First-time login on a fresh workstation has no `~/.si/`. We create
 * // it lazily and lock it down to the owner. On re-runs we still chmod to
 * // 0700 defensively so a user who relaxed perms by hand gets corrected.
 */
async function ensureCredentialsDir(): Promise<string> {
  const dir = credentialsDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  // mkdir's `mode` is ignored when the dir already exists; enforce.
  try {
    await fs.chmod(dir, 0o700);
  } catch {
    // Why: chmod can fail on some filesystems (e.g. SMB shares). Log nothing
    // and trust the warning path in `loadCredentials` to surface it later.
  }
  return dir;
}

/**
 * Warn (to stderr) if the credentials file is world- or group-readable.
 *
 * // Why: A token leaking via reading credentials files on a shared host is a real
 * // concern on shared workstations. We can't always fix the perms (the file
 * // may belong to another user), but we can shout about it.
 */
function warnIfPermissive(filePath: string, mode: number): void {
  // mode is the file's permission bits; we only care about the low 9.
  const low = mode & 0o777;
  // Allow exactly 0600 silently. Anything more permissive earns a warning.
  if (low !== 0o600) {
    const octal = low.toString(8).padStart(3, '0');
    process.stderr.write(
      `warning: ${filePath} has mode 0${octal}; expected 0600. Run: chmod 600 "${filePath}"\n`,
    );
  }
}

// ─── Read / write ────────────────────────────────────────────────────────────

/**
 * Load the credentials map from disk. Returns `{}` if the file is absent.
 *
 * // Why: Absence is the normal first-run state, not an error. Anything else
 * // (parse failure, permission denied) does throw so we don't silently lose
 * // tokens to a corrupted file.
 *
 * @requirement REQ-SI-NF-052
 */
export async function loadCredentials(): Promise<Credentials> {
  const filePath = credentialsPath();
  let raw: string;
  try {
    const stat = await fs.stat(filePath);
    warnIfPermissive(filePath, stat.mode);
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  if (raw.trim().length === 0) return {};
  const parsed = JSON.parse(raw) as Credentials;
  // Defensive: ensure it's an object, not an array or scalar smuggled in.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`credentials file at ${filePath} is not a JSON object`);
  }
  return parsed;
}

/**
 * Atomically replace the credentials file with the given map.
 *
 * // Why: Write-then-rename is the only reliable way to avoid leaving a
 * // half-written file if the process is killed mid-flush. We write to a
 * // sibling temp file (same directory so `rename` is a metadata-only
 * // operation on POSIX), fsync the contents, then rename into place. The
 * // temp file name carries random bytes so concurrent calls don't clobber
 * // each other.
 *
 * @requirement REQ-SI-NF-052
 */
export async function saveCredentials(creds: Credentials): Promise<void> {
  const dir = await ensureCredentialsDir();
  const filePath = credentialsPath();
  const tmpName = `credentials.tmp.${randomBytes(6).toString('hex')}`;
  const tmpPath = path.join(dir, tmpName);

  const json = JSON.stringify(creds, null, 2);
  // open + write + fsync + close, then rename. Mode 0600 from the start.
  const handle = await fs.open(tmpPath, 'w', 0o600);
  try {
    await handle.writeFile(json, { encoding: 'utf-8' });
    await handle.sync();
  } finally {
    await handle.close();
  }
  // Enforce mode 0600 in case the umask narrowed perms further; chmod is a
  // no-op if perms already match.
  try {
    await fs.chmod(tmpPath, 0o600);
  } catch {
    // Why: As with the directory chmod above, some filesystems reject this;
    // the rename below still succeeds and the file is owner-private by
    // virtue of having been created with mode 0600.
  }
  await fs.rename(tmpPath, filePath);
}

// ─── Single-entry convenience ────────────────────────────────────────────────

/**
 * Look up the credential entry for a given SI/I URL.
 *
 * // Why: Callers (login, grant, revoke) all care about exactly one URL at
 * // a time. This wraps the full-file load + lookup so the call sites stay
 * // one-liners.
 */
export async function getEntry(siUrl: string): Promise<CredentialEntry | null> {
  const key = normalizeUrl(siUrl);
  const creds = await loadCredentials();
  return creds[key] ?? null;
}

/**
 * Insert or overwrite the credential entry for a given SI/I URL, then save.
 *
 * // Why: Used by `si login` on success. Read-modify-write is fine here —
 * // we don't expect concurrent logins from the same workstation in the
 * // common case, and the atomic rename keeps any pathological concurrency
 * // from corrupting the file (the loser of the race just loses their write).
 */
export async function setEntry(
  siUrl: string,
  entry: CredentialEntry,
): Promise<void> {
  const key = normalizeUrl(siUrl);
  const creds = await loadCredentials();
  creds[key] = entry;
  await saveCredentials(creds);
}

/**
 * Remove the credential entry for a given SI/I URL.
 *
 * // Why: Future `si logout` will use this. Exported now so tests can clean
 * // up between cases without poking at the JSON directly.
 */
export async function clearEntry(siUrl: string): Promise<void> {
  const key = normalizeUrl(siUrl);
  const creds = await loadCredentials();
  if (!(key in creds)) return;
  delete creds[key];
  await saveCredentials(creds);
}
