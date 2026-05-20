# Security Policy

## Supported Versions

| Version | Supported                                                  |
|---------|------------------------------------------------------------|
| 0.x     | ✅ Current development; security fixes on best-effort basis |
| 1.x     | (future) Active support                                    |
| <1.0    | ❌ Upgrade to latest                                        |

## Reporting a Vulnerability

**Please do not file public GitHub issues for security vulnerabilities.**

Report privately via:

- **GitHub Security Advisories:**
  <https://github.com/wfredricks/solution-intelligence-cli/security/advisories/new>

You should receive an acknowledgment within 5 business days. We'll work
with you to:

1. Reproduce and assess the issue.
2. Develop and test a fix.
3. Disclose responsibly with credit (unless you prefer anonymity).

## Threat Model

Chainblocks is **tamper-evident, not tamper-proof.** This distinction is
load-bearing; it must be understood before solution-intelligence-cli is adopted.

### What solution-intelligence-cli protects against

- **Silent tampering of historical entries.** Any change to a stored block
  invalidates that block's hash AND every subsequent block's `prev` link.
  A single `verify()` call surfaces the exact failing seq.
- **Reordering entries.** `seq` is monotonically assigned by the ledger
  and bound into every hash; rearranging blocks breaks the chain.
- **Backdating entries.** Timestamps are server-assigned at append time;
  callers cannot supply them.
- **Substituting one ledger's blocks for another's.** The ledger's
  `(name, writer)` identity is bound into every hash via RFC 8785
  canonicalization; cross-ledger graft is detected by the verifier.

### What solution-intelligence-cli does NOT protect against

- **Write access to the storage substrate.** Anyone with write access to
  the ledger file (or backing database / S3 bucket / etc.) can overwrite
  history. Chainblocks makes that change *detectable*, not *impossible*.
  Access control is the substrate's responsibility — filesystem
  permissions, IAM, etc.
- **Loss of the head hash.** The integrity guarantee assumes the verifier
  knows what the head should be. If an attacker can rewrite both the
  ledger and your record of the head hash, the chain looks intact.
  Preserve the head hash out-of-band — print it on a deployment record,
  email it to compliance, anchor it to a separate substrate, etc.
- **Compromise of the writer before append.** If an attacker controls the
  writer, they append whatever they want. Chainblocks records what was
  written, not whether it was true.
- **Encryption of payloads.** Payloads are stored as supplied. If you need
  encryption at rest, encrypt before append. (A payload-encryption helper
  may ship as a separate package in the future; it will not be baked into
  the core.)
- **Distributed consensus.** Single writer per ledger. Two writers = two
  ledgers, possibly merged later by a higher-level protocol that is not
  solution-intelligence-cli' concern.

### Trust boundaries

```
+------------------------------------------------------+
|                  Adopter application                 |
|  +------------------------------------------------+  |
|  |    solution-intelligence-cli Ledger (in-process library)     |  |
|  |                                                |  |
|  |   - Bind {name, writer} into every hash        |  |
|  |   - Assign monotonic seq                       |  |
|  |   - Assign server-side ts                      |  |
|  |   - Compute SHA-256(JCS(...))                  |  |
|  +------------------------------------------------+  |
|                       |                              |
|              Store port (interface)                  |
+------------------------|-----------------------------+
                         v
              +-----------------------+
              |   Storage substrate   |   <-- attacker target;
              |   (file / DB / S3)    |       not trusted
              +-----------------------+
```

The library code, the in-process state, and the writing entity are
trusted. The storage substrate is **not** trusted to keep history immutable
on its own — the hash chain is what makes tampering detectable.

## Cryptographic Choices

| Choice | Standard | Why |
|--------|----------|-----|
| Hashing | SHA-256 (FIPS 180-4) | NIST-approved, ubiquitous, well-understood |
| Canonicalization | RFC 8785 JSON Canonicalization Scheme (JCS) | IETF-standardized; deterministic across implementations and languages |
| Signatures | None in v0.1 | Hash-chain integrity does not require signatures. Per-block signatures are a candidate for a v0.3 optional plugin (Ed25519) — see `STORY.md` §"What we will not build". |

No bespoke cryptography. No custom serialization. No private algorithms.
The full algorithm is specified in `MODEL.md` §3; a verifier in any
language can be written from that document.

## Known Limitations

- **No multi-writer support.** Single writer per ledger is the design.
  Two concurrent writers will be detected by the lockfile and the second
  will receive `LockHeldError`.
- **No public-blockchain anchoring in core.** Anchoring the head hash to a
  public chain (Bitcoin, Ethereum) is a useful trust-amplifier and is a
  candidate for a v0.2 optional plugin. It is not part of the core
  doctrine.
- **No payload-content masking in logs.** Chainblocks itself emits no
  logs. If your application logs blocks before appending, that's your
  application's responsibility to redact.
- **Verify is O(N) over the chain length.** A million-entry ledger
  verifies in roughly 100 seconds on consumer SSD. For very large
  ledgers, see incremental verification (REQ-CB-042) — verify from a
  trust anchor forward.

## Dependencies

Chainblocks core has **one** runtime dependency: `canonicalize` (RFC 8785
JCS implementation, ~1 KB, MIT-licensed). All other libraries are
development-only. Critical CVEs in transitive dependencies are addressed
within 7 days.

## Reference

- `STORY.md` — design doctrine and the seven commitments
- `MODEL.md` — exact data model, canonicalization rules, verification
  algorithm
- `docs/SECURITY-MODEL.md` — deeper threat model and adversary scenarios
