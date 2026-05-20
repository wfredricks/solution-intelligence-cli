// Why: This is the v0.1.0-pre scaffold for @solution-intelligence/cli.
//      Product code will be added in build Stage 2 (the `si` command
//      tree: init, add, destroy per REQ-SI-007). Until then, this
//      module exports only its version so the toolchain can be
//      verified end to end.

/**
 * Package version.
 *
 * Why: Provides a single import-able symbol so Stage 1b's smoke test
 * has something real to assert against, and so the bin stub
 * (`src/cli.ts`) has a single source of truth for `si --version`.
 * Will be joined by real exports in Stage 2.
 *
 * @requirement REQ-SI-NF-052 (JSDoc on exported symbols)
 */
export const VERSION = '0.1.0-pre';
