# BUILD-STAGE-02B-PLAN.md — `si login`, `si grant`, `si revoke`

*Written 2026-05-20 20:00 EDT after Stage 2a merged (`5caf551`). This is the file-by-file mechanical recipe for the Stage 2b sub-agent. Decisions: A1 (JSON credentials), B3 (both arg shapes), C4 (env + flag + project config). Time budget: 4-6 hours; hard cap 7 hours.*

---

## Objective

Add three real commands to `@solution-intelligence/cli`:

1. `si login` — passwordless email-and-code authentication against SI/I
2. `si grant <project> <user> <role>` — Owner-only role grant
3. `si revoke <project> <grantId>` — Owner-only revocation

Plus the supporting infrastructure:

- **Credentials store** at `~/.si/credentials` (JSON, mode 0600, keyed by SI/I base URL)
- **URL resolution** with precedence: `--url` flag > `SI_URL` env > `.si/config.yaml` walk-up > error
- **Integration tests** that boot SI/I from the identity repo and exercise the full flow

And **retire the `X-SI-Actor` header shortcut** in SI/I — replace with token-based actor resolution.

## Source pinning

- **SI/I source:** `/Users/williamfredricks/.openclaw/workspace/artifacts/si-runtime/identity/` at current `main` (commit `5caf551` from Stage 2a merge)
- **CLI source:** `/Users/williamfredricks/.openclaw/workspace/artifacts/si-runtime/cli/` at current `main` (Stage 1b scaffold; `0.1.0-pre`)

Both repos are local. SI/I gets ONE modification in this stage (the `X-SI-Actor` retirement). Everything else lands in the CLI repo.

## Destination + structure

After this stage, `si-runtime/cli/` looks like:

```
si-runtime/cli/
├── CHANGELOG.md
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── LICENSE
├── README.md
├── SECURITY.md
├── build-history/
│   ├── BUILD-STAGE-02B-PLAN.md          ← already here
│   └── BUILD-STAGE-02B-FINDINGS.md      ← NEW (written at end)
├── src/
│   ├── index.ts                          ← MODIFIED: exports VERSION + library API
│   ├── cli.ts                            ← MODIFIED: real command tree using commander
│   ├── version.ts                        ← NEW: VERSION const lives here
│   ├── credentials.ts                    ← NEW: ~/.si/credentials read/write
│   ├── url.ts                            ← NEW: URL resolution (flag/env/config)
│   ├── http.ts                           ← NEW: typed HTTP client for SI/I
│   ├── prompts.ts                        ← NEW: stdin prompts (email, code)
│   └── commands/
│       ├── login.ts                      ← NEW
│       ├── grant.ts                      ← NEW
│       └── revoke.ts                     ← NEW
├── tests/
│   ├── smoke.test.ts                     ← Already exists; lightly extended
│   ├── credentials.test.ts               ← NEW
│   ├── url.test.ts                       ← NEW
│   ├── prompts.test.ts                   ← NEW
│   └── integration.test.ts               ← NEW: boots SI/I, exercises all 3 commands
├── package.json                          ← MODIFIED: deps + version bump to 0.2.0-pre
├── tsconfig.json
├── tsconfig.eslint.json
├── tsup.config.ts                        ← MODIFIED if needed
├── vitest.config.ts                      ← MODIFIED if needed (longer timeout for integration)
└── .github/workflows/ci.yml              ← May need tweak for integration test env
```

And `si-runtime/identity/` gets a tightly-scoped change:

```
si-runtime/identity/
├── src/
│   └── grants-http.ts                    ← MODIFIED: retire X-SI-Actor; use token-resolved actor
└── tests/
    └── integration.test.ts               ← MODIFIED: update to match new actor source
```

## Dependencies to add

In `si-runtime/cli/package.json` `dependencies` (currently empty):

- **`commander` ^12.0.0** — argument parsing. Mature, federally-acceptable, no transitive surprises. Supports positional + flag forms simultaneously per Decision B3.
- **`yaml` ^2.6.1** — for `.si/config.yaml` parsing (Decision C4). Same version SI/I uses.

No other dependencies. Native Node for everything else (fs, http, crypto, readline).

## Architecture: command flow

### `si login` flow

```
1. Resolve SI/I URL via url.ts (precedence: --url > SI_URL > .si/config.yaml > error)
2. Prompt for email (prompts.ts)
3. POST <url>/auth/request-code with { email }
4. Server says "code sent" (console adapter prints to its own stdout in dev; real email in prod)
5. Prompt for code (prompts.ts)
6. POST <url>/auth/verify-code with { email, code }
7. Receive { authenticated: true, email, token } or { authenticated: false, error }
8. On success: write token to ~/.si/credentials via credentials.ts (mode 0600)
9. Print success message
10. Exit 0 (success) or 1 (auth failure) or 2 (network/config error)
```

### `si grant` flow

```
1. Resolve URL
2. Load credentials; find token for this URL; error if missing
3. Parse args: positional <project> <user> <role> OR --project/--user/--role flags
   Validate role is one of: Owner, Operator, Analyst, Reviewer, Customer
4. POST <url>/grants with Authorization: Bearer <token>
   Body: { projectId, targetUserId: <user>, role }
5. Server resolves actor from token → checks Owner role → appends grant → emits audit
6. Print grant id + audit-block seq on success
7. Exit 0 / 1 (authz) / 2 (network/config)
```

### `si revoke` flow

```
1. Resolve URL
2. Load credentials; find token
3. Parse args: positional <project> <grantId> OR --project/--grant flags
4. POST <url>/grants/:grantId/revoke with Authorization: Bearer <token>
   Body: { projectId } (defensive — server cross-checks against the grant record)
5. Server resolves actor → checks Owner role → marks grant revoked → emits audit
6. Print revoke confirmation + audit-block seq
7. Exit 0 / 1 / 2
```

## File-by-file spec

### `src/version.ts` (NEW)

```ts
/**
 * Package version. Single source of truth for `si --version` and library consumers.
 *
 * @requirement REQ-SI-NF-052 (JSDoc on exported symbols)
 */
export const VERSION = '0.2.0-pre';
```

### `src/index.ts` (MODIFIED)

Replace the scaffold content with:

```ts
export { VERSION } from './version.js';
// Library exports for downstream tooling (e.g. integration tests)
export { loadCredentials, saveCredentials, type Credentials } from './credentials.js';
export { resolveUrl, type UrlResolution } from './url.js';
export { SIIdentityClient } from './http.js';
```

### `src/credentials.ts` (NEW)

Manages `~/.si/credentials`. JSON file, mode 0600, keyed by SI/I base URL.

Exports:

```ts
export interface CredentialEntry {
  token: string;
  email: string;
  issuedAt: string;     // ISO-8601 UTC
  expiresAt: string;    // ISO-8601 UTC
}

export interface Credentials {
  [siUrl: string]: CredentialEntry;
}

export async function loadCredentials(): Promise<Credentials>;
export async function saveCredentials(creds: Credentials): Promise<void>;
export async function getEntry(siUrl: string): Promise<CredentialEntry | null>;
export async function setEntry(siUrl: string, entry: CredentialEntry): Promise<void>;
export async function clearEntry(siUrl: string): Promise<void>;
```

Implementation requirements:

- File path: `path.join(os.homedir(), '.si', 'credentials')`
- Parent directory created with mode 0700 if missing
- File created with mode 0600
- Atomic writes: write to `credentials.tmp` in the same dir, then `fs.rename` to `credentials`
- If file doesn't exist, `loadCredentials()` returns `{}`
- If file mode is too permissive, log a warning to stderr but proceed
- URL keys are normalized: lower-case scheme + host, strip trailing slash. So `http://LocalHost:3001/` and `http://localhost:3001` map to the same entry.

Test coverage requirements (`tests/credentials.test.ts`):
- Round-trip save/load
- Missing-file returns empty
- Mode 0600 enforced after save
- URL normalization works
- Atomic write doesn't leave half-written content on simulated crash mid-write
- Concurrent writes don't corrupt (use a temp dir + multiple parallel writes)

### `src/url.ts` (NEW)

Resolves which SI/I URL to talk to. Precedence:

1. `--url <url>` flag (highest)
2. `SI_URL` env var
3. `.si/config.yaml` discovered by walking up from `process.cwd()` (lowest)
4. Error if none found

Exports:

```ts
export interface UrlResolution {
  url: string;
  source: 'flag' | 'env' | 'config' | 'none';
  configPath?: string;   // if source === 'config'
}

export async function resolveUrl(flagUrl?: string): Promise<UrlResolution>;
export async function findProjectConfig(startDir?: string): Promise<{ path: string; url: string } | null>;
```

`.si/config.yaml` shape (v0.1):

```yaml
si:
  url: http://localhost:3001
```

Walk-up logic: starting from `startDir ?? process.cwd()`, check `.si/config.yaml`. If not found, go to parent. Stop at root. Cache misses are fine — this is per-process.

Test coverage (`tests/url.test.ts`):
- Flag wins over env wins over config
- Env wins over config when no flag
- Config found via walk-up from nested directory
- No source returns `{ url: '', source: 'none' }` — caller must error
- Invalid YAML in config surfaces a clear error message

### `src/http.ts` (NEW)

Typed HTTP client for SI/I. Native `fetch` (Node 20+ has it). No axios.

```ts
export interface LoginRequestResponse {
  message: string;
  expiresIn?: number;
}

export interface LoginVerifyResponse {
  authenticated: boolean;
  email?: string;
  token?: string;
  error?: string;
}

export interface GrantResponse {
  grantId: string;
  auditBlockSeq: number;
  grant: {
    projectId: string;
    userId: string;
    role: string;
    grantedAt: string;
  };
}

export interface RevokeResponse {
  grantId: string;
  auditBlockSeq: number;
  revokedAt: string;
}

export class SIIdentityClient {
  constructor(baseUrl: string, token?: string);

  async requestCode(email: string): Promise<LoginRequestResponse>;
  async verifyCode(email: string, code: string): Promise<LoginVerifyResponse>;
  async grant(projectId: string, targetUserId: string, role: string): Promise<GrantResponse>;
  async revoke(projectId: string, grantId: string): Promise<RevokeResponse>;
  async resolve(): Promise<{ userId: string; displayName: string; effectiveRoles: string[] }>;
  async health(): Promise<{ ok: boolean; service: string; version: string }>;
}
```

- Errors are thrown as `class SIHttpError extends Error { status: number; bodyJson?: unknown }`.
- Token, when present, goes in `Authorization: Bearer <token>` for grant/revoke/resolve calls.
- Auth endpoints (`requestCode`, `verifyCode`) do NOT require a token.
- Sensitive request/response details (tokens, codes) MUST NOT be logged anywhere. Only status codes and error messages.

### `src/prompts.ts` (NEW)

Minimal stdin prompting using Node's built-in `readline`. No `inquirer` dep.

```ts
export async function promptText(question: string, opts?: { mask?: boolean }): Promise<string>;
export async function promptEmail(question?: string): Promise<string>;
export async function promptCode(question?: string): Promise<string>;
```

- `promptText` with `mask: true` suppresses terminal echo (for the code; codes shouldn't appear in terminal scrollback).
- Email prompt validates basic shape (`/^.+@.+\..+$/`); re-prompts on invalid up to 3 times then throws.
- Code prompt validates 6-digit numeric (the bangauth default code shape).

Test coverage (`tests/prompts.test.ts`): use stream mocking; verify the masked-echo behavior; verify re-prompt loops.

### `src/commands/login.ts` (NEW)

```ts
export interface LoginOptions { url?: string; emailOverride?: string; }
export async function loginCommand(opts: LoginOptions): Promise<number>;  // returns exit code
```

Flow per the §"`si login` flow" above. `emailOverride` is for non-interactive use (`si login --email alice@example.com` skips the email prompt; code prompt still happens because of the email round-trip).

### `src/commands/grant.ts` (NEW)

```ts
export interface GrantOptions {
  url?: string;
  project: string;
  user: string;
  role: string;
}
export async function grantCommand(opts: GrantOptions): Promise<number>;
```

### `src/commands/revoke.ts` (NEW)

```ts
export interface RevokeOptions {
  url?: string;
  project: string;
  grantId: string;
}
export async function revokeCommand(opts: RevokeOptions): Promise<number>;
```

### `src/cli.ts` (MODIFIED — replaces scaffold)

Uses `commander` for argument parsing. Supports both positional and flag forms per Decision B3.

```ts
#!/usr/bin/env node
import { Command } from 'commander';
import { VERSION } from './version.js';
import { loginCommand } from './commands/login.js';
import { grantCommand } from './commands/grant.js';
import { revokeCommand } from './commands/revoke.js';
import { pathToFileURL } from 'node:url';

const program = new Command();

program
  .name('si')
  .description('Solution Intelligence CLI')
  .version(VERSION, '-v, --version');

program
  .command('login')
  .description('Authenticate with an SI/I service via email and access code')
  .option('--url <url>', 'SI/I base URL (overrides SI_URL env and project config)')
  .option('--email <email>', 'Email address (skip the email prompt)')
  .action(async (options) => {
    process.exit(await loginCommand({ url: options.url, emailOverride: options.email }));
  });

program
  .command('grant [project] [user] [role]')
  .description('Grant a role to a user on a project (Owner only)')
  .option('--url <url>', 'SI/I base URL')
  .option('--project <project>', 'Project id')
  .option('--user <user>', 'Target user id (typically an email)')
  .option('--role <role>', 'Role: Owner | Operator | Analyst | Reviewer | Customer')
  .action(async (project, user, role, options) => {
    const merged = {
      url: options.url,
      project: options.project ?? project,
      user: options.user ?? user,
      role: options.role ?? role,
    };
    if (!merged.project || !merged.user || !merged.role) {
      console.error('si grant: --project, --user, and --role are required (or pass as positional args)');
      process.exit(2);
    }
    process.exit(await grantCommand(merged as Required<typeof merged>));
  });

program
  .command('revoke [project] [grantId]')
  .description('Revoke a previously-granted role (Owner only)')
  .option('--url <url>', 'SI/I base URL')
  .option('--project <project>', 'Project id')
  .option('--grant <grantId>', 'Grant id to revoke')
  .action(async (project, grantId, options) => {
    const merged = {
      url: options.url,
      project: options.project ?? project,
      grantId: options.grant ?? grantId,
    };
    if (!merged.project || !merged.grantId) {
      console.error('si revoke: --project and --grant are required (or pass as positional args)');
      process.exit(2);
    }
    process.exit(await revokeCommand(merged as Required<typeof merged>));
  });

// Only run when invoked directly, not when imported by tests
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  program.parseAsync(process.argv).catch((err) => {
    console.error(err.message);
    process.exit(2);
  });
}

export { program };
```

### `tests/integration.test.ts` (NEW — the load-bearing test)

This is the critical test. It must do the full lifecycle:

1. **Setup:**
   - Resolve path to SI/I dist via `path.resolve(__dirname, '../../identity/dist/server.js')`
   - Build SI/I if needed: `execSync('npm run build', { cwd: '../identity' })` (or skip if dist exists)
   - Spawn SI/I on a random port via `node identity/dist/server.js` with `SI_PORT=<port>` env
   - Wait for `/health` to respond OK
   - Set `HOME` env to a temp dir so credentials don't pollute the real `~/.si/`
   - Capture bangauth's emitted codes (the console email adapter prints them to stdout — parse them out)

2. **Login flow:**
   - Call `loginCommand({ url, emailOverride: 'alice@example.com' })` with mocked code prompt that reads from the captured stdout
   - Assert exit code 0
   - Assert `~/.si/credentials` exists with mode 0600
   - Assert the entry has email + token + issuedAt + expiresAt

3. **Grant flow:**
   - Call `grantCommand({ url, project: 'p1', user: 'bob@example.com', role: 'Operator' })`
   - Assert exit code 0
   - Assert SI/I's grants ledger has a new line via `GET /grants?projectId=p1`
   - Assert audit ledger has an `si.role.granted` block (read via `GET /audit` or by direct file read of the JSONL)

4. **Resolve verification:**
   - Call `SIIdentityClient.resolve()` with bob's hypothetical token (skip if we can't synthesize it cleanly — instead, verify via `listGrants` that bob is now an Operator)

5. **Revoke flow:**
   - Call `revokeCommand({ url, project: 'p1', grantId: <captured-grant-id> })`
   - Assert exit code 0
   - Assert grants ledger has the revoke record
   - Assert audit ledger has `si.role.revoked`

6. **Teardown:**
   - Kill SI/I process
   - `rm -rf` the temp HOME dir

If any step fails, surface clearly with logs. Don't silent-retry.

Use vitest's `beforeAll`/`afterAll` for setup/teardown. Test timeout: 60 seconds (extend vitest config if needed).

### SI/I change: retire `X-SI-Actor`

The Stage 2a `grants-http.ts` accepts `X-SI-Actor: <userId>` as a test-fixture shortcut. Replace with token-derived actor:

**Current behavior:** Handler reads `X-SI-Actor` header, uses that as the acting user, checks Owner role via grants ledger.

**New behavior:** Handler reads `Authorization: Bearer <token>` header, calls SI/I's own `/resolve` (or the underlying functions directly to avoid an HTTP self-call), gets `userId`, checks Owner role on the target project.

Implementation: in `si-runtime/identity/src/grants-http.ts`, replace the actor-from-header code with:

```ts
// OLD (retire):
// const actorUserId = c.req.header('X-SI-Actor');

// NEW:
const authHeader = c.req.header('Authorization');
if (!authHeader?.startsWith('Bearer ')) {
  return c.json({ error: 'Authentication required' }, 401);
}
const token = authHeader.slice('Bearer '.length);
const verified = await verifyToken(token, keyStore);
if (!verified.valid) {
  return c.json({ error: 'Invalid token' }, 401);
}
const actorUserId = verified.payload.email;
```

Update SI/I's integration test (`si-runtime/identity/tests/integration.test.ts`) to match: instead of sending `X-SI-Actor`, the test does a full login → token → grant flow. **This becomes part of Stage 2b's work** because Stage 2b's integration test does this end-to-end anyway. So the SI/I test change is small.

Add a one-line note to `si-runtime/identity/CHANGELOG.md` under `## [Unreleased]`:

```
- **`X-SI-Actor` header retired.** Grant/revoke endpoints now derive the acting user from the bearer token (via the same token-verification path as `/resolve`). The header is no longer read; passing it is silently ignored.
```

## Sub-agent execution order

### Phase A — Setup

1. `cd /Users/williamfredricks/.openclaw/workspace/artifacts/si-runtime/cli`
2. `git checkout -b stage-2b`
3. Confirm Stage 1b scaffold state via `git log --oneline -3`

### Phase B — Dependencies

4. Update `package.json`: bump version to `0.2.0-pre`; add `commander` and `yaml` to dependencies
5. `npm install`
6. Verify install succeeded; `node_modules/commander` and `node_modules/yaml` exist

### Phase C — Library modules (in dependency order)

7. Write `src/version.ts`
8. Write `src/credentials.ts` + `tests/credentials.test.ts`; `npm test -- credentials.test` green
9. Write `src/url.ts` + `tests/url.test.ts`; tests green
10. Write `src/prompts.ts` + `tests/prompts.test.ts`; tests green
11. Write `src/http.ts` (no standalone test; exercised by integration)

### Phase D — Commands

12. Write `src/commands/login.ts`
13. Write `src/commands/grant.ts`
14. Write `src/commands/revoke.ts`

### Phase E — CLI entry

15. Rewrite `src/cli.ts` with the commander tree
16. Modify `src/index.ts` per spec
17. Extend `tests/smoke.test.ts` minimally (just verify the new exports load)

### Phase F — SI/I `X-SI-Actor` retirement

18. `cd ../identity`
19. `git checkout -b stage-2b` (parallel branch in identity repo)
20. Modify `src/grants-http.ts` per §"SI/I change" above
21. Update `tests/integration.test.ts` in identity to use a real token-based flow (small change — most of the existing test logic is reusable)
22. Update `CHANGELOG.md` in identity per spec
23. `npm test` in identity: all green
24. `npm run build` in identity: dist produced
25. Commit + push: `git push origin stage-2b`
26. Open PR: `gh pr create --base main --title "Stage 2b prep: retire X-SI-Actor header" --body "Replace X-SI-Actor test-fixture with token-derived actor resolution. Required by Stage 2b CLI integration."`
27. Wait for CI green
28. Merge: `gh pr merge --squash --delete-branch`
29. `git checkout main && git pull`

### Phase G — Integration test

30. `cd ../cli`
31. Write `tests/integration.test.ts` per spec
32. Run it: `npm run build && npm test -- integration.test`
33. **All steps must pass.** If a step is flaky (port conflicts, race with SI/I startup), add retries / explicit waits, not blanket skips.

### Phase H — Gates

34. `npm run typecheck` — clean
35. `npm run lint` — clean
36. `npm test` — full suite green
37. `npm run build` — `dist/cli.js` produced; smoke-test it: `node dist/cli.js --version` prints `0.2.0-pre`
38. `node dist/cli.js --help` — help text shows login, grant, revoke

### Phase I — Repo metadata

39. Update `CHANGELOG.md` per spec (see below)
40. README: add a "Commands" section listing login/grant/revoke with one-line descriptions. Keep concise.

### Phase J — Commit + push + PR

41. `git add -A`
42. `git commit -m "Stage 2b: si login, si grant, si revoke commands + credentials store + integration tests"`
43. `git push origin stage-2b`
44. Open PR via `gh pr create --base main --title "Stage 2b: CLI commands (login, grant, revoke)" --body "Completes Stage 2 per BUILD-PLAN.md. Adds the three foundational CLI commands and the supporting credentials store + URL resolution. Retires X-SI-Actor (merged separately as identity-side prep PR)."`
45. Wait for CI green via `gh run watch`
46. Merge: `gh pr merge --squash --delete-branch`

### Phase K — Final tags + release

47. After both Stage 2a and Stage 2b are on `main`:
   - Tag identity repo: `cd ../identity && git tag -a v0.2.0-pre -m "v0.2.0-pre — Stage 2 (SI/I service)" && git push origin v0.2.0-pre`
   - Tag cli repo: `cd ../cli && git tag -a v0.2.0-pre -m "v0.2.0-pre — Stage 2 (CLI commands)" && git push origin v0.2.0-pre`
   - Create releases on both: `gh release create v0.2.0-pre --title "v0.2.0-pre — Stage 2" --notes "<short notes>"`

### Phase L — FINDINGS

48. Write `build-history/BUILD-STAGE-02B-FINDINGS.md` with:
   - What shipped (3 commands + supporting libs + integration tests)
   - What worked smoothly
   - What surprised (bugs in SI/I surfaced, edge cases in credentials, etc.)
   - Wall-clock breakdown per phase
   - Recommendations for Stage 3 (Graph + GraphLoader)

49. Send Signal message to Bill at +17176608721 with 10-line status summary. Use `message` tool: `action: send`, `channel: signal`, `target: +17176608721`. Plain-text format.

## CHANGELOG entries

### `si-runtime/cli/CHANGELOG.md` — add under `## [Unreleased]` (rename to `## [0.2.0-pre] — 2026-05-20`)

```
### Added

- **`si login`** — passwordless email-and-code authentication against SI/I. Token cached to `~/.si/credentials` (mode 0600).
- **`si grant <project> <user> <role>`** — Owner-gated role grant. Emits `si.role.granted` audit event via SI/I.
- **`si revoke <project> <grantId>`** — Owner-gated revocation. Emits `si.role.revoked`.
- **Credentials store** — JSON-backed, multi-deployment, atomic writes, mode-0600 enforcement.
- **URL resolution** — precedence: `--url` flag > `SI_URL` env > `.si/config.yaml` walk-up.
- **Integration tests** — full lifecycle exercised against a real SI/I instance.
- **`commander` and `yaml` runtime dependencies.**

### Notes

- Per BUILD-PLAN.md Stage 2 exit gate: `si login` round-trips against bangauth, token caching works, grant/revoke produce real chainblocks events with `actor.userId` (resolved from the token, not a test header). REQ-SI-077 (auth-failure debug logging without secret leaks) satisfied.
```

### `si-runtime/identity/CHANGELOG.md` — add under `## [Unreleased]`:

```
- **`X-SI-Actor` header retired.** Grant/revoke endpoints now derive the acting user from the bearer token via the same token-verification path as `/resolve`. Passing the header is silently ignored.
```

## Hard constraints

- **DO NOT modify SI/I beyond the `X-SI-Actor` retirement.** That one targeted change is in scope; everything else in SI/I stays as Stage 2a left it.
- **DO NOT publish to npm** for either repo.
- **DO NOT skip integration tests.** They're the load-bearing assertion that Stage 2 actually works end-to-end. If they're flaky, fix the flakiness; don't skip.
- **DO NOT log tokens or codes anywhere** — not in `console.log`, not in error messages, not in audit events. Only `userId` propagates.
- **DO NOT batch all source files into one write.** Per-file writes; verify each compiles before moving on.
- **DO NOT use `/tmp/`** for staging.
- **DO use atomic write patterns** for `~/.si/credentials` (write-temp + rename).
- **If `commander` arg-parsing semantics conflict with the spec** (positional + flag both populated, or neither populated), prefer the flag value; error if neither.
- **If a content filter blocks output mid-stream**, surface explicitly.
- **If a test fails because of a real defect in Stage 2a's SI/I code**, surface it as a FINDINGS entry — don't patch SI/I beyond the planned `X-SI-Actor` change.
- **If wall-clock exceeds 7 hours total**, stop and report.

## Time budget

Target: 4-6 hours.
- Phases A-B (setup + deps): ~20 min
- Phase C (library modules + their tests): ~90 min
- Phase D (3 command files): ~30 min
- Phase E (cli.ts + index.ts + smoke): ~20 min
- Phase F (SI/I X-SI-Actor retirement + its PR + merge): ~30 min
- Phase G (integration test): ~60 min
- Phase H (gates): ~15 min
- Phase I (changelog + README): ~15 min
- Phases J-K (PR + merge + tags + release): ~30 min
- Phase L (FINDINGS + Signal): ~20 min

Total: ~5 hours.

## Output expected at the end

1. PR merged on `wfredricks/solution-intelligence-cli` for Stage 2b
2. PR merged on `wfredricks/solution-intelligence-identity` for `X-SI-Actor` retirement
3. Both repos tagged `v0.2.0-pre` with GitHub releases
4. `BUILD-STAGE-02B-FINDINGS.md` committed
5. Signal message sent to Bill with status summary

## What success looks like

After Stage 2b lands, a fresh checkout of either repo + the commands `npm install && npm run build && npm test` produces:

- All gates green (typecheck, lint, test, build)
- A working `dist/cli.js` binary that exposes `si login`, `si grant`, `si revoke`
- An integration test that boots SI/I and exercises the full grant lifecycle
- CI green on both Node 20.x and 22.x

A user with bangauth running locally can:

```bash
si login --url http://localhost:3001
# Email: alice@example.com
# Code: 123456 (from email)
# ✓ Authenticated as alice@example.com

si grant dla-stores bob@example.com Operator --url http://localhost:3001
# ✓ Granted Operator on dla-stores to bob@example.com (grant id: g_01HX..., audit seq: 47)

si revoke dla-stores g_01HX... --url http://localhost:3001
# ✓ Revoked grant g_01HX... (audit seq: 48)
```

That's the user-visible deliverable. Everything else is implementation in service of that flow.
