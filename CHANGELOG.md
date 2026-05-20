# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
### Changed
### Deprecated
### Removed
### Fixed
### Security

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

[Unreleased]: https://github.com/wfredricks/solution-intelligence-cli/compare/v0.1.0-pre...HEAD
[0.1.0-pre]: https://github.com/wfredricks/solution-intelligence-cli/releases/tag/v0.1.0-pre
