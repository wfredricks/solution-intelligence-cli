/**
 * Package version. Single source of truth for `si --version` and library
 * consumers.
 *
 * // Why: Hoisted out of `src/index.ts` in Stage 2b so the CLI bin
 * // (`src/cli.ts`) can import the version without pulling in the rest of
 * // the library surface (credentials, http client, prompts). Keeps the
 * // bin's startup footprint minimal.
 *
 * @requirement REQ-SI-NF-052 (JSDoc on exported symbols)
 */
export const VERSION = '0.2.0-pre';
