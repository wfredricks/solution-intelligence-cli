# @solution-intelligence/cli 🖇️

**SI/CLI — the `si` command-line interface: project lifecycle (`si init`, `si add`, `si destroy`) for Solution Intelligence v0.1.**

![version](https://img.shields.io/badge/version-0.1.0--pre-orange)
![status](https://img.shields.io/badge/status-Stage%201b%20scaffold-yellow)
![license](https://img.shields.io/badge/license-Apache--2.0-blue)

Part of [Solution Intelligence v0.1](https://github.com/wfredricks/solution-intelligence). This package is the operator-facing entrypoint to SI: it provisions a new project's four-service Docker stack, allocates ports per REQ-SI-007, and tears stacks down cleanly.

## Status

**Stage 1b scaffold — `0.1.0-pre`.** No functional code yet. The real command tree (`init`, `add`, `destroy`) lands in **Stage 2** of the SI v0.1 build (see [BUILD-PLAN.md](https://github.com/wfredricks/solution-intelligence/blob/main/BUILD-PLAN.md) in the bookend).

What is shipped today:

- The package builds (`npm run build`) and produces `dist/index.js` plus a runnable `dist/cli.js`.
- The smoke test passes (`npm test`).
- CI is green on Node 20.x and 22.x.
- `si --version` prints `0.1.0-pre` once installed.

Nothing else. Treat this release as an *infrastructure receipt*: the toolchain, the bin wiring, the CI matrix, and the governance layer are all verified end-to-end so Stage 2 can land real behavior without first having to debug scaffolding.

## Eventual role

The `si` CLI is the **operator's single entrypoint** to a Solution Intelligence engagement:

- `si init <project>` — clones a project skeleton from [`@solution-intelligence/templates`](https://github.com/wfredricks/solution-intelligence-templates), allocates a port range, writes the four-service Docker compose stack (Studio, Graph, Window, Identity), and starts it.
- `si add <component>` — adds parsers, analysts, or deliverable generators to an existing project.
- `si destroy <project>` — tears the stack down, archives the SIG and the chainblocks audit ledger, releases the port range.

Per REQ-SI-007, every state-changing operation is recorded as a chainblocks audit block attributed to the logged-in operator (via [`@solution-intelligence/identity`](https://github.com/wfredricks/solution-intelligence-identity)).

## Install

```bash
npm install -g @solution-intelligence/cli
```

> Not yet published to npm. Until Stage 7, install from the git repo:
>
> ```bash
> git clone https://github.com/wfredricks/solution-intelligence-cli
> cd solution-intelligence-cli && npm install && npm run build
> npm link   # makes `si` available globally for local development
> ```

## Development

```bash
npm install
npm run build
npm test
```

## Where this fits in SI

| Component | Role |
|-----------|------|
| **SI/CLI** *(this)* | Operator entrypoint — project lifecycle, port allocation, stack provisioning |
| **SI/S** Studio | Blackboard substrate + parser/analyst host |
| **SI/G** Graph | Durable graph adapter + chainblocks audit |
| **SI/W** Window | Consumer-facing role-scoped views |
| **SI/I** Identity | bangauth wrapper for SI's 5-role model |

See the [Solution Intelligence bookend](https://github.com/wfredricks/solution-intelligence) for the full architecture.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The doctrinaire stance: SI is methodology-grade engineering, not a generic CLI. PRs that align with the doctrine in the bookend's `STORY.md` are welcomed.

## License

Apache-2.0. See [LICENSE](./LICENSE).
