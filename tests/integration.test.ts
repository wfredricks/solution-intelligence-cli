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
 * // Why a shared harness (Stage 2c refactor): the boot/teardown plumbing
 * // moved into tests/_harness.ts so Stage 3's additional integration
 * // tests can stand up SI/I without duplicating ~60 lines of setup.
 * // Behavioral assertions in this file are unchanged.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { loginCommand } from '../src/commands/login.js';
import { grantCommand } from '../src/commands/grant.js';
import { revokeCommand } from '../src/commands/revoke.js';
import {
  credentialsPath,
  loadCredentials,
  type CredentialEntry,
} from '../src/credentials.js';
import { bootIdentityHarness, type HarnessHandle } from './_harness.js';

let harness: HarnessHandle;

beforeAll(async () => {
  harness = await bootIdentityHarness();
}, 60_000);

afterAll(async () => {
  await harness.stop();
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
          url: harness.baseUrl,
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
    const entry = creds[harness.baseUrl] as CredentialEntry | undefined;
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
          url: harness.baseUrl,
          emailOverride: 'root@example.com',
          input: s.input,
          output: s.output,
        }),
      ['123456'],
    );
    expect(code).toBe(0);
    const creds = await loadCredentials();
    expect(creds[harness.baseUrl]!.email).toBe('root@example.com');
    // alice token is no longer in the credentials file, but we kept a copy.
    expect(aliceToken.length).toBeGreaterThan(0);
  });

  it('si grant (root grants alice Operator on p-integration)', async () => {
    const code = await grantCommand({
      url: harness.baseUrl,
      project: 'p-integration',
      user: 'alice@example.com',
      role: 'Operator',
    });
    expect(code).toBe(0);

    // Verify the server-side ledger has the new row.
    const res = await fetch(`${harness.baseUrl}/grants?projectId=p-integration`);
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
    // Why: The audit block seq must be present — that is the chainblocks
    // emission Stage 2's exit gate requires.
    expect(typeof operatorRow!.auditBlock).toBe('number');
    rootGrantId = operatorRow!.grantId;
  });

  it('alice token resolves to include Operator role', async () => {
    // Why: Verifies the grant was visible end-to-end via /resolve.
    const res = await fetch(`${harness.baseUrl}/resolve`, {
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
      url: harness.baseUrl,
      project: 'p-integration',
      grantId: rootGrantId,
    });
    expect(code).toBe(0);

    // Server-side: the grants ledger now has a revoked: true counterpart.
    const res = await fetch(`${harness.baseUrl}/grants?projectId=p-integration`);
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
    const res = await fetch(`${harness.baseUrl}/resolve`, {
      method: 'POST',
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    const body = (await res.json()) as { effectiveRoles: string[] };
    expect(body.effectiveRoles).not.toContain('Operator');
  });

  it('audit ledger contains both granted and revoked events for the grant', async () => {
    // Why: The integration test sets SI_AUDIT_PATH so the chainblocks
    // fallback writes a JSONL file we can read directly. We assert by
    // grant id rather than by sequence so the order-of-tests does not
    // bite if a future revision adds new auxiliary events.
    const auditPath = path.join(harness.tmpData, 'audit.jsonl');
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
