# BUILD-STAGE-02C-FINDINGS.md

*Wall-clock 2026-05-21 08:17 → 08:27 EDT. ~10 minutes elapsed. Build executed by a single sub-agent under OpenClaw following BUILD-STAGE-02C-PLAN.md literally.*

---

## What shipped

### `wfredricks/solution-intelligence-graph-client` — new repo, `v0.1.0-pre`

A scaffold-only package laying down the build/test/lint/CI pipeline for what becomes `@solution-intelligence/graph-client` in Stage 3.

| Surface | File | Notes |
|---|---|---|
| Package skeleton | `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts` | Mirrors the cli's shape; coverage thresholds set to 0 for the scaffold (Stage 3 raises to 80/80/80/80). |
| Lint + format | `.eslintrc.json`, `.prettierrc.json`, `tsconfig.eslint.json` | Copied verbatim from cli. |
| Entrypoint | `src/index.ts` | Empty `export {};` with a JSDoc header explaining Stage 3 fills it in. |
| Smoke test | `tests/smoke.test.ts` | Single test asserting the package imports cleanly and exports an empty surface. |
| Docs | `README.md`, `CHANGELOG.md`, `ARCHETYPE.md` | README explains scaffold state, points at `SIIdentityClient`/`SIHttpError` as the patterns Stage 3 will mirror. ARCHETYPE.md is a placeholder cross-reference to `solution-intelligence-identity/ARCHETYPE.md` — no archetypes adopted yet. |
| CI | `.github/workflows/ci.yml` | Same shape as cli's CI WITHOUT the sibling-checkout for identity (graph-client has no sibling deps yet). Lint, typecheck, build, coverage on Node 20.x + 22.x. |

Tagged `v0.1.0-pre` with a GitHub release: <https://github.com/wfredricks/solution-intelligence-graph-client/releases/tag/v0.1.0-pre>

### `wfredricks/solution-intelligence-cli` — `v0.2.1-pre`

Two non-breaking refactors bundled into one PR (#2, squash-merged).

**1. `resolveProjectConfig()` generalizes `src/url.ts`.**

| Surface | File | Lines (incl. JSDoc) |
|---|---|---|
| New types + function | `src/url.ts` | 11 → 246 (net +109 over Stage 2b) |
| Re-exports | `src/index.ts` | added `resolveProjectConfig`, `ProjectConfig`, `ProjectConfigResolution` |
| Tests | `tests/url.test.ts` | 11 tests → 18 tests (+7) |

- New `resolveProjectConfig(flagUrl)` returns the full `.si/config.yaml` record (`ProjectConfig`) plus a `urlSource`.
- Walk-up logic centralized in a private `readProjectConfig()` that returns the full `si:` block.
- `resolveUrl()` retained as a thin wrapper. Same precedence (flag > env > config), same `UrlResolution` shape, `configPath` surfaced only when the URL itself came from a discovered config file.
- `findProjectConfig()` retained as a public surface, implemented atop `readProjectConfig()`.

**2. Integration-test harness lifted into `tests/_harness.ts`.**

| Surface | File | Lines (incl. JSDoc) |
|---|---|---|
| Harness | `tests/_harness.ts` | new (~250) |
| Integration test | `tests/integration.test.ts` | 270 → 195 (net −75; ~60 lines of plumbing collapse into one helper call) |

- `bootIdentityHarness()` returns `{ baseUrl, tmpHome, tmpData, stop }`.
- Encapsulates: SI/I dist build (when missing), random-port allocation, env snapshot/restore (including `was unset` state), `/health` wait, SIGTERM-then-SIGKILL shutdown, tmpdir cleanup.
- Boot-failure path tears down what it set up so flake-free tests don't leak.
- `tests/integration.test.ts` `beforeAll`/`afterAll` reduce to one harness call each; test bodies unchanged.

**59 tests pass** (52 unit/smoke + 7 integration). Coverage on the gated surface: 96.26% statements / 86.84% branches / 100% functions / 96.26% lines — above the 80/80/80/80 threshold.

Tagged `v0.2.1-pre` with a GitHub release: <https://github.com/wfredricks/solution-intelligence-cli/releases/tag/v0.2.1-pre>

### SI/I (identity)

**Not touched.** Per the plan's hard constraint, the identity repo is untouched in Stage 2c.

---

## What worked smoothly

1. **The Stage 2b harness pattern was already clean enough to lift verbatim.** The `beforeAll` body in `tests/integration.test.ts` was 60-ish lines of: snapshot env, mkdtemp home, mkdtemp data, build identity if needed, pick port, spawn server, wait for health. Each block had a single purpose. Lifting was almost mechanical: extract function, replace module-scope locals with `harness.X` references, add a try/catch around `waitForHealth` so boot failure tears down the half-built world. Net effect: the integration test reads like a description of what's being tested instead of a description of how SI/I gets stood up.

2. **The `resolveProjectConfig` refactor was a pure widening.** The walk-up logic stayed exactly where it was; the change was "return the whole `si:` block instead of just `si.url`". The legacy `findProjectConfig` and `resolveUrl` public surfaces still exist with byte-for-byte identical behavior — pre-Stage-2c tests all 11 pass with zero edits to the assertions.

3. **The graph-client scaffold was a 15-minute job.** Almost everything was copy-and-rename from cli/: package.json, tsconfig, vitest, eslint, prettier, gitignore. The deliberate decision was: do not invent shape now. The README + ARCHETYPE.md are explicit that Stage 3 makes the design calls (single client vs. multiple, SIHttpError sharing, credentials-store wiring).

4. **CI on the new repo was a single round-trip.** Without the cli's sibling-identity-checkout complication, graph-client's CI is the plain "checkout, install, lint, typecheck, build, test" sequence and went green on both Node 20.x and 22.x first try.

5. **No esbuild trap encountered.** Heeded the warning from 02B-FINDINGS — never wrote `*/` inside a `//` line comment inside a `/** */` block. Used prose like "the matching closing block-comment marker" or "the chainblocks emission Stage 2's exit gate requires" where the `*/` literal sequence would otherwise have appeared.

6. **The macOS `/var` → `/private/var` wart was a no-op this round.** The new `resolveProjectConfig` tests reused the same `process.chdir(tmp); const realRoot = process.cwd()` idiom the Stage 2b tests already established. No re-discovery.

---

## What surprised

1. **`configPath` semantics needed sharpening as part of the wrapper.** The Stage 2b `resolveUrl` set `configPath` only when the URL came from a discovered config file (because that was the only path that constructed a `findProjectConfig` result). Once `resolveProjectConfig` discovers the config file independently of which precedence rung wins, the wrapper could in principle pass `configPath` through even when the flag/env wins. Re-reading the existing `url.test.ts` made the intended contract obvious: `configPath` is the URL's provenance, not a generic "a config exists" hint. The wrapper explicitly drops `configPath` when `urlSource !== 'config'`, and a new test (`configPath is only set when the URL came from the config file`) pins this behavior. One sentence in `src/url.ts` documents the why.

2. **The empty-`si.url` walk-up rule is subtle but matters.** A child config with `si: { url: "   " }` should NOT block a parent's `si.url`. The Stage 2b `findProjectConfig` already had this behavior (whitespace-stripped, falsy → continue the walk). I preserved it in `readSiBlock` by deleting `url` from the parsed block when its trimmed value is empty, then treating the whole block as unusable iff zero remaining keys. Added a regression test (`whitespace-only url in config is treated as unset`) to pin this.

3. **Vitest globbing happily ignores `_harness.ts`.** The `include: ['tests/**/*.test.ts']` pattern means the harness file isn't picked up as a test, but I almost named it `tests/harness.ts` and would have gotten lucky for the wrong reason. The underscore prefix is the conventional signal that a file in `tests/` is shared infrastructure, not a test itself.

4. **Coverage exclude for the harness was unnecessary.** The vitest config's coverage `include: ['src/**/*.ts']` already restricts collection to source files, so `tests/_harness.ts` is naturally outside the gated surface. No config change needed.

5. **Package-version bump merits its own commit.** The PR landed at the (still) `v0.2.0-pre` version since the squash-merge body described the behavior changes, not the version metadata. A separate `Stage 2c: bump version to 0.2.1-pre + CHANGELOG entry` commit on main keeps the tag pointing at a commit whose `package.json#version` matches the tag string. Matches the Stage 2b pattern.

---

## Wall-clock breakdown

Total elapsed: ~10 minutes (vs. the plan's 25-45 minute estimate, and far under the 90-minute hard cap).

| Phase | Plan estimate | Actual |
|---|---|---|
| A. graph-client scaffold | 8-12 min | ~4 min |
| B. resolveProjectConfig refactor | 5-8 min | ~2 min |
| C. _harness.ts lift | 5-8 min | ~1 min |
| D. PR + CI + tag + release | 5-10 min | ~3 min (mostly CI wait) |
| E. FINDINGS + Signal | 3-5 min | this writeup |

The CI wait on PR #2 was ~25-30 seconds for both Node 20.x and 22.x. The graph-client CI ran similarly fast on the initial push (no PR required since the repo started empty — direct main push + the v0.1.0-pre tag).

---

## Recommendations for Stage 3 (Graph + GraphLoader)

1. **`SIGraphClient` should consume `resolveProjectConfig`, not `resolveUrl`.** The Stage 3 graph client will want `graphUrl` from the same `.si/config.yaml` that supplies the SI/I URL. Calling `resolveProjectConfig` once at command entry and threading both URLs through the command surface is cleaner than two parallel walk-ups.

2. **Decide the SIHttpError lift early in Stage 3.** Right now `SIHttpError` lives in `cli/src/http.ts`. Stage 3 has two clean options: (a) move it to graph-client and have the cli depend on graph-client for the type, or (b) keep it in cli and have graph-client define a structurally-identical type. Option (a) is the right long-term shape but requires a graph-client publish (or a `file:../graph-client` cross-repo dep). Pick the option in the Stage 3 decision sheet, not at implementation time.

3. **Add a graph-client integration test that reuses `bootIdentityHarness`.** Stage 3's graph client will (eventually) need to bear a token from `~/.si/credentials` against an SI/I-authenticated SI/G. The cli's harness already stands up SI/I; lift it again (or expose it as a third package) when SI/G boot needs to layer on top.

4. **The scaffold's coverage thresholds will need to rise.** `graph-client/vitest.config.ts` has thresholds set to `0/0/0/0` for Stage 2c. Stage 3 should raise them to `80/80/80/80` (matching cli) in the same PR that lands the implementation. Don't ship a green Stage 3 PR with thresholds still at 0.

5. **`tests/_harness.ts` is a candidate for its own package eventually.** When graph-client (and Studio, and later services) need the same boot/teardown pattern, lifting the harness into `@solution-intelligence/test-harness` (or similar) makes more sense than copying it three ways. Not urgent — Stage 3 is fine consuming it via a `file:../cli` test-utility import or by copy-paste. Worth revisiting in Stage 4.

6. **`ProjectConfig.si` is open-typed for a reason.** Stage 3 should add named fields (`graphUrl?`, `studioUrl?`) to the `si` block instead of relying on the `[key: string]: unknown` index signature. The index signature is the escape hatch for unknown keys; named fields are the supported surface.

---

## Hard constraints — compliance check

- [x] DO NOT modify SI/I. Untouched.
- [x] DO NOT publish to npm. Tags + GitHub releases only on both repos.
- [x] DO NOT skip integration tests. All 7 integration tests pass via the refactored harness; full suite is 59 tests.
- [x] DO NOT log tokens or codes. No new logging in `src/url.ts`, `tests/_harness.ts`, or the graph-client scaffold. `grep -r 'console.log.*token' src tests` finds nothing in either repo.
- [x] DO NOT batch source files into one write. Each file written and verified individually; `npx tsc --noEmit` run at every major boundary.
- [x] DO NOT use `/tmp/`. `tests/_harness.ts` and `tests/url.test.ts` both use `os.tmpdir()` + `fs.mkdtemp` exclusively. `grep -rn "'/tmp/" tests` returns no matches in either repo.
- [x] Watch for the esbuild trap (no `*/` inside `//` inside `/** */`). Reviewed every new comment; none contain the literal `*/` sequence inside a line comment.
- [x] Wall-clock under 90 minutes. Actual: ~10 minutes.

---

## Output checklist

- [x] New repo `wfredricks/solution-intelligence-graph-client` exists, main branch initialized.
- [x] graph-client scaffold pushed to main with all files listed in Phase A3 (`package.json`, `tsconfig.json`, `tsconfig.eslint.json`, `tsup.config.ts`, `vitest.config.ts`, `.eslintrc.json`, `.prettierrc.json`, `.gitignore`, `src/index.ts`, `tests/smoke.test.ts`, `README.md`, `CHANGELOG.md`, `ARCHETYPE.md`, `.github/workflows/ci.yml`).
- [x] graph-client tagged `v0.1.0-pre` with GitHub release.
- [x] cli PR (#2) merged for Stage 2c (single PR bundling B + C).
- [x] cli tagged `v0.2.1-pre` with GitHub release.
- [x] All cli tests pass: 59 tests total (7 integration + 22 credentials + 18 url + 8 prompts + 4 smoke = 59), exceeding the plan's 52+ target.
- [x] graph-client smoke test passes (1 test).
- [x] `BUILD-STAGE-02C-FINDINGS.md` committed to cli repo (this file).
- [x] Signal message sent to +17176608721.

Stage 2c is complete. The runtime is ready for the Stage 3 decision sheet.
