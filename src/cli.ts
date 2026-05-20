#!/usr/bin/env node
// Why: v0.1.0-pre scaffold for the `si` CLI. The real command tree
// arrives in Stage 2 (lifecycle, port allocation per REQ-SI-007).
// This stub exists so the bin wiring is verifiable end-to-end now.
import { VERSION } from './index.js';

const arg = process.argv[2];
if (arg === '--version' || arg === '-v') {
  console.log(VERSION);
  process.exit(0);
}
console.log(`si v${VERSION} — Solution Intelligence CLI (scaffold)`);
console.log('Stage 2 will add: init, add, destroy.');
process.exit(0);
