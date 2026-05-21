/**
 * Shared integration-test harness for the `si` CLI.
 *
 * // Why: Stage 2b's integration test boots SI/I, redirects HOME, sets
 * // grants/audit paths, and tears everything down. Stage 3 will add
 * // more integration tests that need the same setup. Lifting boot and
 * // teardown here means new tests describe what they want to exercise
 * // without re-implementing the harness.
 *
 * Setup the harness performs:
 *   - Snapshots the relevant env vars (HOME, SI_GRANTS_PATH,
 *     SI_AUDIT_PATH, SI_DEV_CODE, SI_URL) so {@link HarnessHandle.stop}
 *     can restore them exactly.
 *   - Builds `../identity/dist/server.js` if it is missing.
 *   - Picks a free TCP port via Node's net module.
 *   - Spawns the SI/I server with `SI_DEV_CODE=123456` (overridable),
 *     pointed at tmp grants + audit jsonl paths.
 *   - Redirects HOME to a tmp dir so the test never touches the real
 *     `~/.si/credentials`.
 *   - Waits for `/health` to return 200.
 *
 * Teardown (via {@link HarnessHandle.stop}):
 *   - SIGTERMs the server, then SIGKILLs after a brief grace window.
 *   - Restores every env var to its pre-harness value (including the
 *     "was unset" state).
 *   - Removes both tmp directories.
 *
 * @module _harness
 */

import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(__dirname, '..');
const identityRoot = path.resolve(cliRoot, '..', 'identity');

/**
 * Snapshot of the env-var values the harness mutates, so teardown can
 * restore them precisely (including the difference between "was unset"
 * and "was empty string").
 */
interface EnvSnapshot {
  HOME: string | undefined;
  SI_GRANTS_PATH: string | undefined;
  SI_AUDIT_PATH: string | undefined;
  SI_DEV_CODE: string | undefined;
  SI_URL: string | undefined;
}

/**
 * Live harness handle. Tests use `baseUrl` to drive the CLI commands,
 * `tmpHome` + `tmpData` to inspect filesystem side effects, and `stop()`
 * from afterAll to release the resources.
 */
export interface HarnessHandle {
  /** The `http://127.0.0.1:<port>` base URL the server is listening on. */
  baseUrl: string;
  /** Tmp directory pointed to by `HOME` for the duration of the test run. */
  tmpHome: string;
  /** Tmp directory holding the grants + audit jsonl files. */
  tmpData: string;
  /** Tear down the harness: kill the server, restore env, remove tmp dirs. */
  stop: () => Promise<void>;
}

/**
 * Options accepted by {@link bootIdentityHarness}.
 */
export interface HarnessOptions {
  /**
   * Deterministic verification code the SI/I server should accept.
   * Defaults to `'123456'` so tests can feed it directly to
   * `loginCommand` without scraping the email adapter.
   */
  devCode?: string;
}

/**
 * Wait for the SI/I `/health` endpoint to return 200, polling every
 * 100ms up to `timeoutMs`.
 *
 * // Why: Spawning the server is asynchronous from Node's perspective —
 * // the process is alive long before it binds the port. Polling
 * // `/health` is the simplest signal that boot is complete.
 */
async function waitForHealth(url: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `Server at ${url} never became healthy: ${(lastErr as Error)?.message ?? 'no error'}`,
  );
}

/**
 * Pick a free TCP port by asking the OS for an ephemeral binding.
 *
 * // Why: Random-port allocation is the only way two test files (or two
 * // CI lanes on the same runner) can boot SI/I in parallel without
 * // colliding. We bind, capture the assigned port, and close the
 * // listener immediately; there is a tiny race window before the spawn
 * // claims the port, but it is small enough in practice that the
 * // health-check loop absorbs any miss.
 */
async function pickFreePort(): Promise<number> {
  const net = await import('node:net');
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      if (typeof addr === 'object' && addr !== null) {
        const p = addr.port;
        srv.close(() => resolve(p));
      } else {
        srv.close(() => reject(new Error('No port returned')));
      }
    });
  });
}

/**
 * Boot SI/I on a random port with a deterministic dev code, redirect
 * HOME to a tmp dir, and point grants/audit paths at a second tmp dir.
 *
 * // Why: The Stage 2b integration test does all of this inline. Every
 * // future integration test will need the same setup; lifting it into
 * // a shared helper means new tests only describe what they want to
 * // exercise, not how to stand up the world.
 *
 * Returns a {@link HarnessHandle} the test holds for the lifetime of
 * the suite. Always call `handle.stop()` in `afterAll` — the harness
 * intentionally does not auto-clean on process exit because tests that
 * leak the handle should fail visibly rather than silently re-use a
 * dead server.
 *
 * @param opts {@link HarnessOptions}
 */
export async function bootIdentityHarness(
  opts?: HarnessOptions,
): Promise<HarnessHandle> {
  const devCode = opts?.devCode ?? '123456';

  // Snapshot env so teardown can restore exactly.
  const envSnapshot: EnvSnapshot = {
    HOME: process.env.HOME,
    SI_GRANTS_PATH: process.env.SI_GRANTS_PATH,
    SI_AUDIT_PATH: process.env.SI_AUDIT_PATH,
    SI_DEV_CODE: process.env.SI_DEV_CODE,
    SI_URL: process.env.SI_URL,
  };

  // Tmp HOME so ~/.si/credentials lives somewhere disposable.
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'si-cli-int-home-'));
  process.env.HOME = tmpHome;
  // Tmp data dir for the server's grants + audit jsonl.
  const tmpData = await fs.mkdtemp(path.join(os.tmpdir(), 'si-cli-int-data-'));

  // Server-side env. The identity service reads these at boot.
  const grantsPath = path.join(tmpData, 'grants.jsonl');
  const auditPath = path.join(tmpData, 'audit.jsonl');

  // Build identity if its dist is missing.
  const identityDist = path.join(identityRoot, 'dist', 'server.js');
  if (!existsSync(identityDist)) {
    const build = spawnSync('npm', ['run', 'build'], {
      cwd: identityRoot,
      stdio: 'inherit',
    });
    if (build.status !== 0) {
      throw new Error('Failed to build identity dist');
    }
  }

  const serverPort = await pickFreePort();
  const baseUrl = `http://127.0.0.1:${serverPort}`;

  // Why: We do not carry SI_URL into the server process; the CLI uses
  // --url. Unset it so resolveUrl does not pick up a stray dev value.
  delete process.env.SI_URL;

  const serverProc: ChildProcess = spawn('node', [identityDist], {
    cwd: identityRoot,
    env: {
      ...process.env,
      SI_PORT: String(serverPort),
      SI_DEV_CODE: devCode,
      SI_ALLOWED_DOMAINS: '*',
      SI_PROJECT_ID: 'p-integration',
      SI_GRANTS_PATH: grantsPath,
      SI_AUDIT_PATH: auditPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Forward server output to test-runner stderr for diagnostics on failure.
  serverProc.stdout?.on('data', () => {
    // Why: swallow normal stdout; stderr below is enough for diagnostics.
  });
  serverProc.stderr?.on('data', (buf: Buffer) => {
    process.stderr.write(`[si-identity] ${buf.toString('utf-8')}`);
  });

  try {
    await waitForHealth(baseUrl);
  } catch (err) {
    // Boot failed; tear down what we did set up so the test does not
    // leak resources.
    if (!serverProc.killed) serverProc.kill('SIGKILL');
    restoreEnv(envSnapshot);
    await fs.rm(tmpHome, { recursive: true, force: true });
    await fs.rm(tmpData, { recursive: true, force: true });
    throw err;
  }

  const stop = async (): Promise<void> => {
    if (serverProc && !serverProc.killed) {
      serverProc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 200));
      if (!serverProc.killed) serverProc.kill('SIGKILL');
    }
    restoreEnv(envSnapshot);
    await fs.rm(tmpHome, { recursive: true, force: true });
    await fs.rm(tmpData, { recursive: true, force: true });
  };

  return { baseUrl, tmpHome, tmpData, stop };
}

/**
 * Restore a snapshot taken at harness-boot time, including the
 * "previously unset" state.
 */
function restoreEnv(snapshot: EnvSnapshot): void {
  for (const key of Object.keys(snapshot) as Array<keyof EnvSnapshot>) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
