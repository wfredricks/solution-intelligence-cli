# BUILD-STAGE-02C-PLAN.md

*Stage 2c — Pre-work for Stage 3. Three small, sequenced items that prevent churn once Stage 3 momentum starts. Same recipe-file pattern as Stage 2a/2b.*

---

## Scope

Three deliverables on three repos:

1. **NEW REPO:** `wfredricks/solution-intelligence-graph-client` — scaffold for `@solution-intelligence/graph-client` package (Stage 1b-style empty scaffold; no graph client code yet). v0.1.0-pre tag.

2. **EXISTING REPO:** `wfredricks/solution-intelligence-cli` — refactor `src/url.ts` to expose `resolveProjectConfig()` returning the full `.si/config.yaml` record, with `resolveUrl()` as a thin wrapper. Non-breaking. Updates `url.test.ts`. v0.2.1-pre tag.

3. **EXISTING REPO (same as #2):** `wfredricks/solution-intelligence-cli` — lift integration-test boot/teardown into `tests/_harness.ts`. Existing `tests/integration.test.ts` refactored to use the harness. No behavioral change. Same v0.2.1-pre tag (bundled with #2).

## Out of scope

- NO graph client code. The graph-client repo is scaffold-only — package.json, tsconfig, vitest config, ARCHETYPE.md cross-reference, README, CHANGELOG, CI workflow. Stage 3 will fill it in.
- NO changes to SI/I (identity repo).
- NO changes to command behavior in cli.
- NO npm publishes. Tags only.

## Hard constraints

- DO NOT modify SI/I.
- DO NOT publish to npm. Tags + GitHub releases only.
- DO NOT skip integration tests; the refactored integration test in #3 must pass.
- DO NOT log tokens or codes (no new logging anywhere).
- DO NOT batch source files into one write. Each file written individually; `npx tsc --noEmit` at every boundary.
- DO NOT use `/tmp/`; use `os.tmpdir()` / `fs.mkdtemp` only.
- If wall-clock exceeds 90 minutes, stop and report.

## Phases

### Phase A — graph-client repo scaffold (new repo)

A1. **Create repo:** `gh repo create wfredricks/solution-intelligence-graph-client --public --description "Typed HTTP client for Solution Intelligence Graph (SI/G). Part of the solution-intelligence runtime."`

A2. **Clone locally** to `~/.openclaw/workspace/artifacts/si-runtime/graph-client/`. Sibling to cli/ and identity/.

A3. **Scaffold files** (copy-adapt the structure from cli/ stage-1b scaffold):
- `package.json` — name `@solution-intelligence/graph-client`, version `0.1.0-pre`, type module, scripts (build, test, test:coverage, lint, typecheck), devDeps matching cli (vitest, typescript, eslint, prettier). NO runtime deps yet; Stage 3 adds them.
- `tsconfig.json` — same shape as cli.
- `vitest.config.ts` — coverage thresholds set to 0 for now (no source to cover); Stage 3 raises them.
- `.eslintrc.cjs`, `.prettierrc` — copy from cli.
- `.gitignore` — copy from cli.
- `src/index.ts` — empty re-export file with a JSDoc header explaining the package is scaffolded and Stage 3 fills it in. ONE file. No graph client code.
- `tests/smoke.test.ts` — single test asserting the package exports from `src/index.ts` (will be empty re-exports for now, but the smoke test confirms the build/test pipeline works).
- `README.md` — short README explaining: this is a scaffold, points at cli's `SIHttpError` and `SIIdentityClient` patterns it will follow, references the archetype-methodology paper.
- `CHANGELOG.md` — `## 0.1.0-pre — 2026-05-21` entry noting "Scaffold only. Stage 3 lands the graph client implementation."
- `ARCHETYPE.md` — note: this package will follow the same bangauth-derived patterns as identity (atomic writes if it grows a store, `SIHttpError` shape, etc.). Reference identity/ARCHETYPE.md.
- `.github/workflows/ci.yml` — same shape as cli's CI but WITHOUT the sibling-checkout for identity (graph-client has no sibling deps yet). Runs lint, typecheck, test, coverage.

A4. **Initial commit + push to main.**

A5. **Tag `v0.1.0-pre`** with GitHub release. Release body: "Scaffold for @solution-intelligence/graph-client. No code yet — Stage 3 fills it in."

### Phase B — cli `resolveProjectConfig()` refactor

B1. **Branch:** `git checkout -b stage-2c-resolve-project-config` on cli repo.

B2. **Refactor `src/url.ts`:**

The current shape returns just `{ url, source, configPath? }`. The new shape needs to return the full `.si/config.yaml` record (or what would have been read) plus a derived `url` accessor.

**New types:**

```ts
/**
 * Parsed `.si/config.yaml` record. Stage 3 will extend this with
 * graphUrl, studioUrl, etc.
 */
export interface ProjectConfig {
  /** Path to the `.si/config.yaml` file when discovered via walk-up. */
  path?: string;
  /** The full `si:` block from the config. */
  si: {
    url?: string;
    // Future: graphUrl?: string; studioUrl?: string;
    [key: string]: unknown;
  };
}

/**
 * Outcome of {@link resolveProjectConfig}.
 */
export interface ProjectConfigResolution {
  /** The resolved project config record. Empty `si: {}` when source === 'none'. */
  config: ProjectConfig;
  /** Which input layer the URL (if any) came from. */
  urlSource: 'flag' | 'env' | 'config' | 'none';
}
```

**New function:**

```ts
/**
 * Resolve the full project config + URL precedence in one call.
 *
 * // Why: Stage 3 needs more than just the SI/I URL — it needs the entire
 * // `.si/config.yaml` record so it can pull graphUrl, studioUrl, etc.
 * // without duplicating the walk-up logic. The URL precedence (flag > env
 * // > config) still applies to the SI/I URL; other config keys come purely
 * // from the discovered config file.
 *
 * @param flagUrl The `--url <url>` value, if the user passed one.
 */
export async function resolveProjectConfig(
  flagUrl?: string,
): Promise<ProjectConfigResolution> {
  // 1. Walk up to find .si/config.yaml; parse the full si: block.
  // 2. Apply flag > env > config precedence to determine the URL.
  // 3. Return { config: { path?, si: {...} }, urlSource }.
  // 4. If flag or env wins, the config object's si.url is set to that value
  //    (so callers reading config.si.url get the effective URL).
}
```

**Backwards-compat wrapper:**

```ts
export async function resolveUrl(flagUrl?: string): Promise<UrlResolution> {
  const { config, urlSource } = await resolveProjectConfig(flagUrl);
  return {
    url: config.si.url ?? '',
    source: urlSource,
    configPath: config.path,
  };
}
```

The existing `UrlResolution` interface stays exported as-is. The `findProjectConfig()` helper can stay private but its return type widens to surface the full parsed si: block (rename internally to `readProjectConfig` if useful).

B3. **Update `tests/url.test.ts`:**
- Keep all existing `resolveUrl()` tests (they still pass via the wrapper).
- Add new tests for `resolveProjectConfig()`:
  - Returns full `si:` block when config has multiple keys (e.g. `si: { url, graphUrl }`)
  - Returns empty `si: {}` when no config found
  - urlSource respects flag > env > config precedence
  - config.path is set when discovered via walk-up; undefined when flag/env supplies URL only

B4. **Run gates:** `npm run build`, `npm test`, `npm run lint`, `npx tsc --noEmit`. All green.

B5. **Commit:** `Stage 2c: resolveProjectConfig() generalizes url.ts for Stage 3 consumers`

### Phase C — cli `tests/_harness.ts` lift

C1. **Same branch as Phase B** (`stage-2c-resolve-project-config` — both refactors ship in one PR; if size is a concern, split here, but I expect they're small enough to bundle).

C2. **Create `tests/_harness.ts`** with exported helpers:

```ts
/**
 * Shared integration-test harness for the si CLI.
 *
 * // Why: Stage 2b's integration test boots SI/I, redirects HOME, sets
 * // grants/audit paths, and tears everything down. Stage 3 will add more
 * // integration tests that need the same setup. Lifting boot/teardown
 * // here means new tests describe what they want to exercise without
 * // re-implementing the harness.
 */

export interface HarnessHandle {
  baseUrl: string;
  tmpHome: string;
  tmpData: string;
  stop: () => Promise<void>;
}

/**
 * Boot SI/I on a random port with SI_DEV_CODE set, redirect HOME to a
 * tmp dir, and point grants/audit paths at another tmp dir. Returns a
 * handle the test uses to assert side effects and a stop() to tear down.
 */
export async function bootIdentityHarness(opts?: {
  devCode?: string; // defaults to '123456'
}): Promise<HarnessHandle>;
```

The implementation lifts the existing `beforeAll`/`afterAll` body verbatim from `tests/integration.test.ts`. Env-var snapshot/restore stays in the harness; tests don't need to know about it.

C3. **Refactor `tests/integration.test.ts`:**
- Replace inline `beforeAll`/`afterAll` with `bootIdentityHarness()` + handle.stop().
- Test bodies unchanged. The `baseUrl`, `tmpHome`, `tmpData` references now come from the harness handle.
- All 7 integration tests must still pass.

C4. **Run gates:** `npm test` (full suite, including integration). All 52+ tests pass.

C5. **Commit:** `Stage 2c: lift integration-test harness into tests/_harness.ts`

### Phase D — PR + merge + tag (cli)

D1. **Push branch + open PR:** `Stage 2c: resolveProjectConfig + integration harness`. PR body summarizes both refactors as non-breaking pre-work for Stage 3.

D2. **Wait for CI green.** If CI fails, fix forward; do not merge red.

D3. **Squash-merge with branch delete.**

D4. **Tag main:** `v0.2.1-pre`. Push tag.

D5. **GitHub release** for `v0.2.1-pre`. Release body:
- Refactor: `resolveProjectConfig()` exposed for Stage 3 consumers. `resolveUrl()` retained as backward-compatible wrapper.
- Refactor: integration-test boot/teardown lifted into shared `tests/_harness.ts`.
- No behavioral changes; all 52+ tests pass.

### Phase E — FINDINGS + Signal

E1. **Write `BUILD-STAGE-02C-FINDINGS.md`** at `artifacts/si-runtime/cli/build-history/`. Same shape as 02B-FINDINGS: what shipped, what worked, what surprised, wall-clock, recommendations for Stage 3, compliance check, output checklist.

E2. **Commit FINDINGS to main** on the cli repo.

E3. **Signal Bill at +17176608721** with a one-line completion message. Example: "Stage 2c complete. graph-client scaffolded (v0.1.0-pre), cli at v0.2.1-pre with resolveProjectConfig + tests/_harness. FINDINGS committed. Ready for Stage 3 decision sheet."

## Output checklist (for FINDINGS)

- [ ] New repo `wfredricks/solution-intelligence-graph-client` exists, main branch initialized
- [ ] graph-client scaffold pushed to main with all files listed in Phase A3
- [ ] graph-client tagged `v0.1.0-pre` with GitHub release
- [ ] cli PR merged for Stage 2c (single PR bundling B + C)
- [ ] cli tagged `v0.2.1-pre` with GitHub release
- [ ] All cli tests pass (52+ tests including 7 integration tests)
- [ ] graph-client smoke test passes (1 test)
- [ ] `BUILD-STAGE-02C-FINDINGS.md` committed to cli repo
- [ ] Signal message sent to +17176608721

## Wall-clock estimate

- Phase A (graph-client scaffold): ~8-12 min
- Phase B (resolveProjectConfig refactor): ~5-8 min
- Phase C (_harness.ts lift): ~5-8 min
- Phase D (PR + CI + tag + release): ~5-10 min
- Phase E (FINDINGS + Signal): ~3-5 min

Total expected: **~25-45 minutes**. Hard cap: **90 minutes**. Stop and report if exceeded.

## Notes for the sub-agent

- Recipe files are load-bearing. Read this file end to end before starting.
- If the recipe deviates from server reality (as Stage 2b found with `userId` vs `targetUserId`), follow server reality and note the deviation in FINDINGS.
- ARCHETYPE.md in graph-client should be a stub pointing at identity/ARCHETYPE.md as the canonical example. We're not deriving from bangauth in graph-client *yet* — Stage 3 will determine whether the graph-client borrows the `SIHttpError` shape directly (which is now SI-original) or some bangauth pattern; whichever happens, the marking conventions apply.
- The `esbuild trap` from 02B-FINDINGS: do not write `*/` inside `//` line comments inside `/** */` blocks. The lexer treats it as closing the surrounding block. Use prose like "matching the closing block-comment marker" instead.
- Mode 0600, atomic writes, no `/tmp/`, no token logging — these apply across the entire SI runtime, not just identity. Maintain them in graph-client even though it has no store yet.
