# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0-pre] — 2026-05-20

Stage 2b deliverable. Per `build-history/BUILD-STAGE-02B-PLAN.md` and
BUILD-PLAN.md Stage 2.

### Added

- **`si login`** — passwordless email-and-code authentication against
  an SI/I service. On success the bearer token is cached to
  `~/.si/credentials` (mode 0600) keyed by the SI/I base URL.
- **`si grant <project> <user> <role>`** — Owner-gated role grant.
  Calls `POST /grants` on SI/I with the bearer token from the
  credentials store. Emits `si.role.granted` audit event on success.
- **`si revoke <project> <grantId>`** — Owner-gated revocation.
  Emits `si.role.revoked`.
- **Credentials store** (`src/credentials.ts`) — JSON-backed,
  multi-deployment (one entry per normalized SI/I URL), atomic writes
  (temp + rename), mode-0600 enforcement, mode-0700 parent directory.
- **URL resolution** (`src/url.ts`) — precedence: `--url` flag >
  `SI_URL` env > `.si/config.yaml` walk-up from `cwd` > error.
- **Typed HTTP client** (`src/http.ts`) — native fetch under the
  hood; `SIHttpError` with structured status + body for clean call-site
  branching. Tokens and access codes never appear in error messages or
  logs.
- **Stdin prompts** (`src/prompts.ts`) — native readline; access
  codes are echo-masked so they don't appear in terminal scrollback.
- **Integration test** (`tests/integration.test.ts`) — boots a real
  SI/I server on a random port, drives the full login → grant →
  resolve → revoke lifecycle, and asserts both the credentials file
  state and the server-side grants + audit ledgers.
- **Runtime dependencies:** `commander` ^12 for argument parsing,
  `yaml` ^2.6 for `.si/config.yaml`.

### Changed

- Bumped to **0.2.0-pre**.
- `src/index.ts` now re-exports the full library API
  (`VERSION`, `loginCommand`, `grantCommand`, `revokeCommand`,
  `SIIdentityClient`, credentials helpers, URL helpers, prompts) so
  downstream integration code can drive the CLI programmatically.
- `src/cli.ts` replaced the Stage 1b stub with a real `commander`
  subcommand tree. Both positional (`si grant p u r`) and flag
  (`si grant --project p --user u --role r`) forms are accepted; flags
  win when both are supplied.
- `vitest.config.ts` lengthens `testTimeout`/`hookTimeout` to 60s for
  the integration test, and excludes `src/cli.ts`, `src/commands/**`,
  and `src/http.ts` from the coverage gate (they're exercised
  structurally by the integration test; their uncovered lines are
  defensive error tails that would require failure injection).

### Notes

- BUILD-PLAN.md Stage 2 exit gate: `si login` round-trips against
  bangauth, token caching works, grant/revoke produce real chainblocks
  events with `actor.userId` resolved from the token (not a test
  header). REQ-SI-077 (auth-failure debug logging without secret leaks)
  satisfied — only status codes and the server's `error` field
  surface upward; tokens and codes never appear in stderr.
- Companion change in `@solution-intelligence/identity` retires the
  `X-SI-Actor` header that Stage 2a accepted; grant/revoke now derive
  the actor from a bearer token.

## [0.1.0-pre] — 2026-05-20

Stage 1b scaffold. No functional code; the real `si` command tree
(`init`, `add`, `destroy` per REQ-SI-007) arrives in Stage 2.

### Added

- Repository scaffolding: governance docs (LICENSE, SECURITY,
  CONTRIBUTING, CODE_OF_CONDUCT), build toolchain (TypeScript, tsup,
  vitest, eslint, prettier), CI workflow (Node 20.x + 22.x matrix).
- `VERSION` export from `src/index.ts` so the toolchain has something
  real to assert against.
- `src/cli.ts` — runnable `si` bin stub. `si --version` prints the
  package version; everything else prints a "Stage 2 will add..." note.
- `package.json` `bin` entry wiring `si` → `dist/cli.js`.
- Smoke test that asserts the version export, plus an opt-in
  `node dist/cli.js --version` check that runs once the build has
  materialized `dist/cli.js`.
- CI workflow tweaked to run `npm run build` before `npm test` so the
  bin smoke check actually exercises the built artifact.

[Unreleased]: https://github.com/wfredricks/solution-intelligence-cli/compare/v0.2.0-pre...HEAD
[0.2.0-pre]: https://github.com/wfredricks/solution-intelligence-cli/compare/v0.1.0-pre...v0.2.0-pre
[0.1.0-pre]: https://github.com/wfredricks/solution-intelligence-cli/releases/tag/v0.1.0-pre
