# scaleway-mcp

An MCP server that exposes the [Scaleway CLI](https://github.com/scaleway/scaleway-cli) (`scw`) as tools. One tool per top-level service, each a scoped executor wrapping the CLI.

## Prerequisites

- Node ≥ 20
- `scw` ≥ 2.55.0 on PATH ([install](https://github.com/scaleway/scaleway-cli/releases))
- A configured Scaleway profile: `scw init` or `~/.config/scw/config.yaml`

## Install

```bash
npm install
npm run build
```

## Environment variables

| Variable            | Default   | Meaning                                                                   |
| ------------------- | --------- | ------------------------------------------------------------------------- |
| `SCW_PROFILE`       | _(unset)_ | Default Scaleway profile. Falls back to scw default if unset.             |
| `SCW_MCP_READONLY`  | `false`   | When `true`, blocks any command that isn't a read verb.                   |
| `SCW_MIN_VERSION`   | `2.55.0`  | Minimum `scw` version. Startup check.                                     |
| `SCW_TIMEOUT_MS`    | `60000`   | Per-call subprocess timeout.                                              |
| `SCW_BINARY`        | `scw`     | Path to the scw binary if not on PATH.                                    |

## Claude Code `settings.json` example

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
    },
    "scaleway-test": {
      "command": "node",
      "args": ["/absolute/path/to/scaleway-mcp/dist/index.js"],
      "env": {
        "SCW_PROFILE": "test",
        "SCW_MCP_READONLY": "false"
      }
    }
  }
}
```

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
