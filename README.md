# @solution-intelligence/cli 🖇️

**SI/CLI — the `si` command-line interface: project lifecycle (`si init`, `si add`, `si destroy`) for Solution Intelligence v0.1.**

![version](https://img.shields.io/badge/version-0.2.0--pre-orange)
![status](https://img.shields.io/badge/status-Stage%202b-yellow)
![license](https://img.shields.io/badge/license-Apache--2.0-blue)

Part of [Solution Intelligence v0.1](https://github.com/wfredricks/solution-intelligence). This package is the operator-facing entrypoint to SI: it provisions a new project's four-service Docker stack, allocates ports per REQ-SI-007, and tears stacks down cleanly.

## Status

**Stage 2b — `0.2.0-pre`.** Three foundational commands shipped: `si login`, `si grant`, `si revoke`. The project-lifecycle commands (`init`, `add`, `destroy` per REQ-SI-007) land in later Stage 2 work.

What is shipped today:

- `si login` round-trips email-and-code authentication against an SI/I service and caches the resulting bearer token under `~/.si/credentials` (mode 0600, keyed by SI/I URL).
- `si grant` and `si revoke` carry that token to the SI/I `/grants` endpoint; SI/I derives the actor from the token and enforces the Owner gate server-side.
- The package builds (`npm run build`) and produces `dist/index.js` plus a runnable `dist/cli.js`.
- Unit + integration tests pass against a real SI/I instance.
- CI is green on Node 20.x and 22.x.

## Commands

```
si login   [--url <url>] [--email <email>]
si grant   [project] [user] [role] [--url <url>] [--project <project>] [--user <user>] [--role <role>]
si revoke  [project] [grantId] [--url <url>] [--project <project>] [--grant <grantId>]
```

- **`si login`** — prompts for email and access code, then verifies against `POST /auth/verify-code` on SI/I. On success, writes a credential entry under `~/.si/credentials` (mode 0600) keyed by the normalized SI/I URL.
- **`si grant <project> <user> <role>`** — grants a role on a project to a target user. Valid roles: `Owner`, `Operator`, `Analyst`, `Reviewer`, `Customer`. Owner-gated server-side.
- **`si revoke <project> <grantId>`** — revokes a previously-granted role by grant id. Owner-gated server-side.

Both positional and `--flag` forms are accepted; flags win when both are supplied.

### URL resolution

The SI/I base URL is resolved in this order:

1. `--url <url>` flag (highest)
2. `SI_URL` environment variable
3. `.si/config.yaml` discovered by walking up from `cwd`. Shape:
   ```yaml
   si:
     url: http://localhost:3001
   ```
4. Error if none found.

### Example

```bash
si login --url http://localhost:3001
# Email: alice@example.com
# (server emits a 6-digit code)
# Access code: ******
# ✓ Authenticated as alice@example.com
#   Credentials saved for http://localhost:3001

si grant dla-stores bob@example.com Operator --url http://localhost:3001
# ✓ Granted Operator on dla-stores to bob@example.com (audit seq: 47)
#   grant id: g_01HX...

si revoke dla-stores g_01HX... --url http://localhost:3001
# ✓ Revoked grant g_01HX... (audit seq: 48)
```

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
