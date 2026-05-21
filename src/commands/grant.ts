/**
 * `si grant <project> <user> <role>` — Owner-gated role grant.
 *
 * // Why: This is the daily-driver command for project owners. It calls
 * // `POST /grants` on SI/I with the bearer token loaded from the
 * // credentials store; SI/I derives the actor from the token and enforces
 * // the Owner gate server-side. We do client-side role validation as a
 * // courtesy so a typo doesn't even reach the server.
 *
 * Exit codes:
 *   0 — granted
 *   1 — authz failure (not Owner, expired token)
 *   2 — config/network/usage error
 *
 * @module commands/grant
 */

import { resolveUrl } from '../url.js';
import { getEntry } from '../credentials.js';
import { SIIdentityClient, SIHttpError } from '../http.js';

/**
 * Valid roles per MODEL.md §6.
 *
 * // Why: Mirrors `ROLES` in `@solution-intelligence/identity` so we can
 * // pre-validate without taking a runtime dep on that package.
 */
const ROLES = ['Owner', 'Operator', 'Analyst', 'Reviewer', 'Customer'] as const;

/**
 * Options for {@link grantCommand}.
 *
 * @requirement REQ-SI-NF-052
 */
export interface GrantOptions {
  url?: string;
  project: string;
  user: string;
  role: string;
}

/**
 * Execute the grant flow. Returns the exit code.
 *
 * @requirement REQ-SI-NF-052
 */
export async function grantCommand(opts: GrantOptions): Promise<number> {
  const out = process.stdout;
  const err = process.stderr;

  // 1) Resolve URL
  const resolution = await resolveUrl(opts.url);
  if (resolution.source === 'none') {
    err.write(
      'si grant: no SI/I URL configured. Pass --url, set SI_URL, or create .si/config.yaml.\n',
    );
    return 2;
  }
  const url = resolution.url;

  // 2) Validate role early
  if (!(ROLES as readonly string[]).includes(opts.role)) {
    err.write(
      `si grant: invalid role "${opts.role}"; expected one of ${ROLES.join(', ')}\n`,
    );
    return 2;
  }

  // 3) Load credentials
  const entry = await getEntry(url);
  if (!entry) {
    err.write(`si grant: not logged in for ${url}. Run: si login --url ${url}\n`);
    return 1;
  }

  // 4) Call /grants
  const client = new SIIdentityClient(url, entry.token);
  try {
    const result = await client.grant(opts.project, opts.user, opts.role);
    const auditSegment =
      typeof result.auditBlock === 'number'
        ? ` (audit seq: ${result.auditBlock})`
        : '';
    out.write(
      `\u2713 Granted ${result.role} on ${result.projectId} to ${result.userId}${auditSegment}\n`,
    );
    out.write(`  grant id: ${result.grantId}\n`);
    return 0;
  } catch (e) {
    if (e instanceof SIHttpError) {
      err.write(`si grant: ${e.message}\n`);
      if (e.status === 401 || e.status === 403) return 1;
      if (e.status >= 400 && e.status < 500) return 2;
      return 2;
    }
    err.write(`si grant: ${(e as Error).message}\n`);
    return 2;
  }
}
