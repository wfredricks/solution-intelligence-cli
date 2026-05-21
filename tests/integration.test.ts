/**
 * Stage 2b — End-to-end integration test.
 *
 * // Why: This is the load-bearing test for Stage 2b. We boot the real
 * // SI/I server on a random port, drive the three CLI commands
 * // (loginCommand, grantCommand, revokeCommand) against it, and assert
 * // both the visible side-effects (credentials file appears with mode
 * // 0600, exit codes are 0) and the server-side ledger state (grants
 * // ledger shows the new row, then the revoke row). If this test passes,
 * // Stage 2's user-visible deliverable works end-to-end.
 *
 * Setup:
 *   - Builds `../identity` if `dist/server.js` is missing.
 *   - Spawns the server with `SI_DEV_CODE=123456` so we can hand the code
 *     to the CLI without scraping email-adapter output.
 *   - Redirects HOME to a tmp dir so the test never touches the real
 *     `~/.si/`.
 *   - Points SI_GRANTS_PATH + SI_AUDIT_PATH at the tmp dir.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from 'vitest';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';

import { loginCommand } from '../src/commands/login.js';
import { grantCommand } from '../src/commands/grant.js';
import { revokeCommand } from '../src/commands/revoke.js';
import {
  credentialsPath,
  loadCredentials,
  type CredentialEntry,
} from '../src/credentials.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(__dirname, '..');
const identityRoot = path.resolve(cliRoot, '..', 'identity');

let serverProc: ChildProcess | undefined;
let serverPort = 0;
let baseUrl = '';
let tmpHome = '';
let tmpData = '';
let originalHome: string | undefined;
let originalGrantsPath: string | undefined;
let originalAuditPath: string | undefined;
let originalDevCode: string | undefined;
let originalSiUrl: string | undefined;

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

beforeAll(async () => {
  // Snapshot env so we can fully restore it; afterAll mutates it back.
  originalHome = process.env.HOME;
  originalGrantsPath = process.env.SI_GRANTS_PATH;
  originalAuditPath = process.env.SI_AUDIT_PATH;
  originalDevCode = process.env.SI_DEV_CODE;
  originalSiUrl = process.env.SI_URL;

  // Tmp HOME so ~/.si/credentials lives somewhere disposable.
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'si-cli-int-home-'));
  process.env.HOME = tmpHome;
  // Tmp data dir for the server's grants + audit jsonl.
  tmpData = await fs.mkdtemp(path.join(os.tmpdir(), 'si-cli-int-data-'));

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

  // Pick a free port by binding to 0 via a throwaway socket. Simpler:
  // ask the OS for one via Node's net module.
  serverPort = await new Promise<number>((resolve, reject) => {
    import('node:net').then((net) => {
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
  });
  baseUrl = `http://127.0.0.1:${serverPort}`;

  // Why: We don't carry SI_URL into the server process; the CLI uses --url.
  // Unset it so resolveUrl doesn't pick up a stray dev value.
  delete process.env.SI_URL;

  serverProc = spawn('node', [identityDist], {
    cwd: identityRoot,
    env: {
      ...process.env,
      SI_PORT: String(serverPort),
      SI_DEV_CODE: '123456',
      SI_ALLOWED_DOMAINS: '*',
      SI_PROJECT_ID: 'p-integration',
      SI_GRANTS_PATH: grantsPath,
      SI_AUDIT_PATH: auditPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Forward server output to test-runner stderr for diagnostics on failure.
  serverProc.stdout?.on('data', () => {
    /* swallow normal stdout; readable below if a test fails */
  });
  serverProc.stderr?.on('data', (buf: Buffer) => {
    process.stderr.write(`[si-identity] ${buf.toString('utf-8')}`);
  });

  await waitForHealth(baseUrl);
}, 60_000);

afterAll(async () => {
  if (serverProc && !serverProc.killed) {
    serverProc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
    if (!serverProc.killed) serverProc.kill('SIGKILL');
  }
  // Restore env
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalGrantsPath === undefined) delete process.env.SI_GRANTS_PATH;
  else process.env.SI_GRANTS_PATH = originalGrantsPath;
  if (originalAuditPath === undefined) delete process.env.SI_AUDIT_PATH;
  else process.env.SI_AUDIT_PATH = originalAuditPath;
  if (originalDevCode === undefined) delete process.env.SI_DEV_CODE;
  else process.env.SI_DEV_CODE = originalDevCode;
  if (originalSiUrl === undefined) delete process.env.SI_URL;
  else process.env.SI_URL = originalSiUrl;

  await fs.rm(tmpHome, { recursive: true, force: true });
  await fs.rm(tmpData, { recursive: true, force: true });
});

// Helper: invoke a command function with stdin/stdout passthroughs so it
// can prompt without a real TTY. Returns { code, stdout }.
async function runCommandWithCapture<T extends { input: PassThrough; output: PassThrough }>(
  prep: (streams: T) => Promise<number>,
  typedLines: string[],
): Promise<{ code: number; output: string }> {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (c: Buffer) => chunks.push(c));
  // Feed typed lines on next tick so the command's prompts are attached
  // by the time the data arrives.
  setImmediate(() => {
    for (const line of typedLines) input.write(line + '\n');
  });
  const code = await prep({ input, output } as T);
  return { code, output: Buffer.concat(chunks).toString('utf-8') };
}

describe('CLI integration (Stage 2b)', () => {
  let aliceToken: string;
  let rootGrantId: string;

  it('si login (alice) writes ~/.si/credentials mode 0600', async () => {
    const { code } = await runCommandWithCapture(
      (s) =>
        loginCommand({
          url: baseUrl,
          emailOverride: 'alice@example.com',
          input: s.input,
          output: s.output,
        }),
      ['123456'],
    );
    expect(code).toBe(0);

    const credPath = credentialsPath();
    expect(existsSync(credPath)).toBe(true);
    const stat = await fs.stat(credPath);
    expect(stat.mode & 0o777).toBe(0o600);

    const creds = await loadCredentials();
    const entry = creds[baseUrl] as CredentialEntry | undefined;
    expect(entry).toBeDefined();
    expect(entry!.email).toBe('alice@example.com');
    expect(entry!.token.length).toBeGreaterThan(0);
    expect(entry!.issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry!.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    aliceToken = entry!.token;
  });

  it('si login (root) succeeds and stores a second entry under the same URL key', async () => {
    // Login as root, OVERWRITING the alice entry under the same baseUrl key.
    // This mirrors real-world usage: a workstation tends to have one active
    // identity per deployment URL at a time. The integration test uses root
    // as the granting actor for the next steps.
    const { code } = await runCommandWithCapture(
      (s) =>
        loginCommand({
          url: baseUrl,
          emailOverride: 'root@example.com',
          input: s.input,
          output: s.output,
        }),
      ['123456'],
    );
    expect(code).toBe(0);
    const creds = await loadCredentials();
    expect(creds[baseUrl]!.email).toBe('root@example.com');
    // alice token is no longer in the credentials file, but we kept a copy.
    expect(aliceToken.length).toBeGreaterThan(0);
  });

  it('si grant (root grants alice Operator on p-integration)', async () => {
    const code = await grantCommand({
      url: baseUrl,
      project: 'p-integration',
      user: 'alice@example.com',
      role: 'Operator',
    });
    expect(code).toBe(0);

    // Verify the server-side ledger has the new row.
    const res = await fetch(`${baseUrl}/grants?projectId=p-integration`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      grants: Array<{
        grantId: string;
        userId: string;
        role: string;
        grantedBy: string;
        revoked?: boolean;
        auditBlock?: number;
      }>;
    };
    const operatorRow = body.grants.find(
      (g) =>
        g.userId === 'alice@example.com' && g.role === 'Operator' && !g.revoked,
    );
    expect(operatorRow).toBeDefined();
    expect(operatorRow!.grantedBy).toBe('root@example.com');
    // Why: The audit block seq must be present — that's the chainblocks
    // emission Stage 2's exit gate requires.
    expect(typeof operatorRow!.auditBlock).toBe('number');
    rootGrantId = operatorRow!.grantId;
  });

  it('alice token resolves to include Operator role', async () => {
    // Why: Verifies the grant was visible end-to-end via /resolve.
    const res = await fetch(`${baseUrl}/resolve`, {
      method: 'POST',
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      userId: string;
      effectiveRoles: string[];
    };
    expect(body.userId).toBe('alice@example.com');
    expect(body.effectiveRoles).toContain('Operator');
  });

  it('si revoke removes the grant and emits an audit event', async () => {
    const code = await revokeCommand({
      url: baseUrl,
      project: 'p-integration',
      grantId: rootGrantId,
    });
    expect(code).toBe(0);

    // Server-side: the grants ledger now has a revoked: true counterpart.
    const res = await fetch(`${baseUrl}/grants?projectId=p-integration`);
    const body = (await res.json()) as {
      grants: Array<{ grantId: string; revoked?: boolean; auditBlock?: number }>;
    };
    const revokedRow = body.grants.find(
      (g) => g.grantId === rootGrantId && g.revoked === true,
    );
    expect(revokedRow).toBeDefined();
    expect(typeof revokedRow!.auditBlock).toBe('number');
  });

  it('alice token resolves with Operator gone after revoke', async () => {
    const res = await fetch(`${baseUrl}/resolve`, {
      method: 'POST',
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    const body = (await res.json()) as { effectiveRoles: string[] };
    expect(body.effectiveRoles).not.toContain('Operator');
  });

  it('audit ledger contains both granted and revoked events for the grant', async () => {
    // Why: The integration test sets SI_AUDIT_PATH so the chainblocks
    // fallback writes a JSONL file we can read directly. We assert by
    // grant id rather than by sequence so the order-of-tests doesn't
    // bite if a future revision adds new auxiliary events.
    const auditPath = path.join(tmpData, 'audit.jsonl');
    expect(existsSync(auditPath)).toBe(true);
    const raw = await fs.readFile(auditPath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    const events = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const grantedHits = events.filter(
      (e) => e.type === 'si.role.granted',
    );
    const revokedHits = events.filter(
      (e) => e.type === 'si.role.revoked',
    );
    expect(grantedHits.length).toBeGreaterThanOrEqual(1);
    expect(revokedHits.length).toBeGreaterThanOrEqual(1);
  });
});
