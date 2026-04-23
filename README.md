# scaleway-mcp

An MCP server that exposes the [Scaleway CLI](https://github.com/scaleway/scaleway-cli) (`scw`) as tools. One tool per top-level service, each a scoped executor wrapping the CLI.

## Prerequisites

- Node ≥ 20
- `scw` ≥ 2.55.0 on PATH ([install](https://github.com/scaleway/scaleway-cli/releases))
- A configured Scaleway profile: `scw init` or `~/.config/scw/config.yaml`

## Install

You have two options. Pick whichever matches how you want to run the server.

### Option A — Run directly from GitHub via `npx` (recommended, zero local clone)

This is the Node equivalent of the `uvx` pattern used for Python MCPs. `npx` clones the repo to a cache dir, runs `npm install` (which triggers the `prepare` script to build `dist/`), and executes the `bin` entry. You never manage the source tree yourself.

```bash
# One-off smoke test — prints the startup log and lists tools
npx -y github:e-sensia/scaleway-mcp
```

Replace `e-sensia/scaleway-mcp` with your fork or the canonical repo path if different.

Claude Code `settings.json` using the npx form:

```json
{
  "mcpServers": {
    "scaleway-prod": {
      "command": "npx",
      "args": ["-y", "github:e-sensia/scaleway-mcp"],
      "env": {
        "SCW_PROFILE": "prod",
        "SCW_MCP_READONLY": "true"
      }
    },
    "scaleway-test": {
      "command": "npx",
      "args": ["-y", "github:e-sensia/scaleway-mcp"],
      "env": {
        "SCW_PROFILE": "test",
        "SCW_MCP_READONLY": "false"
      }
    }
  }
}
```

Notes:
- `-y` auto-confirms the install prompt.
- First launch clones + builds (a few seconds). Subsequent launches hit the npx cache and start immediately.
- To pin a revision: `github:e-sensia/scaleway-mcp#<commit-or-tag>`. Recommended for stable environments — otherwise npx resolves to the latest on the default branch.
- `scw` still needs to be on PATH in the environment that runs the MCP. `npx` does not install the Scaleway CLI for you.

### Option B — Local clone (for development)

```bash
git clone https://github.com/e-sensia/scaleway-mcp.git
cd scaleway-mcp
npm install
npm run build
```

Then point Claude Code at the built file:

```json
{
  "mcpServers": {
    "scaleway-prod": {
      "command": "node",
      "args": ["/absolute/path/to/scaleway-mcp/dist/index.js"],
      "env": {
        "SCW_PROFILE": "prod",
        "SCW_MCP_READONLY": "true"
      }
    }
  }
}
```

## Environment variables

| Variable            | Default   | Meaning                                                                   |
| ------------------- | --------- | ------------------------------------------------------------------------- |
| `SCW_PROFILE`       | _(unset)_ | Default Scaleway profile. Falls back to scw default if unset.             |
| `SCW_MCP_READONLY`  | `false`   | When `true`, blocks any command that isn't a read verb.                   |
| `SCW_MIN_VERSION`   | `2.55.0`  | Minimum `scw` version. Startup check.                                     |
| `SCW_TIMEOUT_MS`    | `60000`   | Per-call subprocess timeout.                                              |
| `SCW_BINARY`        | `scw`     | Path to the scw binary if not on PATH.                                    |

## Tool shape

Every tool (`scw_account`, `scw_instance`, `scw_k8s`, …) accepts:

- `args: string[]` — CLI args after `scw <service>`. Example: `["server", "list", "--zone", "fr-par-1"]`.
- `profile?: string` — per-call override for `SCW_PROFILE`.
- `output?: "json" | "human" | "yaml"` — default `json`.
- `help?: boolean` — if `true`, runs `<cmd> --help` and returns the help text.
- `confirm?: boolean` — required (`true`) for destructive verbs: `delete`, `terminate`, `destroy`, `purge`, `detach`, `remove`, `--force*`, `--recursive`, `-r`.

## Safety

- **Read-only mode** (`SCW_MCP_READONLY=true`) blocks any command whose args don't contain a read verb (`list`, `get`, `show`, `describe`, `wait`, `version`, `info`, `help`) or that include a destructive token/flag.
- **Destructive confirm** — when the args contain a destructive verb (even with readonly off), the tool returns the resolved command and demands a second call with `confirm: true`.

## Development

```bash
npm test              # run unit tests
npm run typecheck     # tsc --noEmit
npm run refresh-services   # regenerate src/services.ts from scw --help
```
