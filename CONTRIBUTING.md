# Contributing to solution-intelligence-cli

Thanks for your interest. Chainblocks is a small, doctrinaire library:
contributions that fit the doctrine in `STORY.md` are welcomed; contributions
that try to make solution-intelligence-cli something else (a distributed system, a query
engine, a SaaS) are not.

## Quick Start for Contributors

```bash
git clone https://github.com/wfredricks/solution-intelligence-cli.git
cd solution-intelligence-cli
npm install
npm test
```

The full local quality gate:

```bash
npm run typecheck
npm test
npm run test:coverage
npm run jsdoc-coverage
npm run build
```

## How to Contribute

1. **File an issue first** for any non-trivial change. Discuss the design
   before writing code. This is especially important because the
   bookend documents (`STORY.md`, `REQUIREMENTS.md`, `MODEL.md`,
   `docs/USE-CASES.md`, `docs/FEATURES.md`) are the contract; code conforms
   to them, not the other way around.
2. **Branch naming:** `feature/<short-description>` or `fix/<short-description>`.
3. **Commit conventions:** Conventional Commits — `feat:`, `fix:`,
   `docs:`, `test:`, `refactor:`, `chore:`, `perf:`, `build:`.
4. **PR target:** `main`. Major version development uses a `next` branch
   when a major release is in flight.

## Development Setup

- Node.js 20.x or 22.x (matches `engines` in `package.json`)
- npm (no pnpm, no yarn)
- No system dependencies — solution-intelligence-cli is pure JS/TS with one runtime
  dependency (`canonicalize`)

## Running Tests

```bash
npm test                   # all tests (unit + integration + requirements + scenario)
npm run test:unit          # pure-logic tests only
npm run test:integration   # tests that touch the filesystem
npm run test:requirements  # REQ-CB-* traceability
npm run test:scenario      # UC-* end-to-end scenarios
npm run test:coverage      # with coverage report; gates at 80%
npm run test:bench         # performance benchmarks (run on-demand)
```

Coverage must stay **≥80%** (lines, branches, functions, statements) on
every PR. JSDoc coverage must stay **≥90%** on exported symbols.

## Documentation Requirements

Every PR that adds a public API must:

1. Add JSDoc to the exported symbol, including:
   - One-sentence summary
   - `@param`, `@returns`, `@throws` as applicable
   - `@requirement REQ-CB-NNN` tag pointing at the requirement(s) the
     symbol satisfies
   - `@example` for non-trivial APIs
2. Update `docs/API.md` so every exported symbol has a section.
3. Add an entry to `CHANGELOG.md` under `[Unreleased]`.
4. Add or update an `examples/` entry if the API is non-trivial.

PRs that change the bookend documents (`STORY.md`, `REQUIREMENTS.md`,
`MODEL.md`, `docs/USE-CASES.md`, `docs/FEATURES.md`) require explicit
maintainer review. These are the contract.

## Code Style

- TypeScript strict mode is on; do not relax it
- No `any` without a justification comment (`// Why: ...`)
- No `console.log` in shipped code — solution-intelligence-cli emits no logs
- No magic strings or numbers — use a named `const X = ... as const;`
- Tests describe real behaviors; do not write tests purely to pad coverage
- Pure-logic ↔ I/O separation: `src/core/` is the pure-logic side,
  `src/stores/` is where I/O lives. Don't drag I/O into core.

## Pull Request Process

1. Ensure CI is green: `typecheck`, `test`, `test:coverage`,
   `jsdoc-coverage`, `examples` (all jobs in `.github/workflows/ci.yml`).
2. Add JSDoc and CHANGELOG entry per above.
3. Request review. New features that don't trace to an existing
   `docs/USE-CASES.md` use case need a discussion of whether the use case
   should be added.
4. Squash on merge.

## What We Will Not Accept

- Distributed-consensus features (multi-writer, gossip, etc.)
- Query / indexing / search of payloads (project to a database)
- Encryption of payloads in core
- Public-blockchain anchoring as a core feature (plugin only)
- A SaaS / hosted-service shim
- New runtime dependencies (the dep list is `canonicalize`, period — adding
  one requires a SECURITY.md update and maintainer sign-off)
- Format changes to the on-disk JSONL without a major version bump

The full doctrine is in `STORY.md` §"What we will not build". If your
contribution is in that list, it does not mean it's a bad idea — it means
it should ship as a separate package.

## License

By contributing, you agree your contributions are licensed under the
[Apache License 2.0](LICENSE).
