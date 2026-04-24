# scaleway-mcp

[![npm](https://img.shields.io/npm/v/@e-sensia/scaleway-mcp/next?label=npm%20%40next&logo=npm)](https://www.npmjs.com/package/@e-sensia/scaleway-mcp)
[![license](https://img.shields.io/npm/l/@e-sensia/scaleway-mcp.svg)](LICENSE)

An MCP server that exposes the [Scaleway CLI](https://github.com/scaleway/scaleway-cli) (`scw`) as tools. One tool per top-level service, each a scoped executor wrapping the CLI.

## Prerequisites

- Node ≥ 20
- `scw` ≥ 2.55.0 on PATH ([install](https://github.com/scaleway/scaleway-cli/releases))
- A configured Scaleway profile: `scw init` or `~/.config/scw/config.yaml`

## Install

You have two options. Pick whichever matches how you want to run the server.

### Option A — Run from npm via `npx` (recommended, zero local clone)

`npx` downloads `@e-sensia/scaleway-mcp` from the npm registry and executes the `bin` entry. You never manage the source tree yourself.

```bash
# One-off smoke test — prints the startup log and lists tools
npx -y @e-sensia/scaleway-mcp@next
```

Claude Code `settings.json` using the npx form:

```json
{
  "mcpServers": {
    "scaleway-readonly": {
      "command": "npx",
      "args": ["-y", "@e-sensia/scaleway-mcp"],
      "env": {
        "SCW_MCP_READONLY": "true"
      }
    },
    "scaleway-writable": {
      "command": "npx",
      "args": ["-y", "@e-sensia/scaleway-mcp"],
      "env": {
        "SCW_MCP_READONLY": "false"
      }
    }
  }
}
```

Notes:
- `-y` auto-confirms the install prompt.
- First launch downloads + caches the package. Subsequent launches hit the npx cache and start immediately.
- Dist-tags: `@next` tracks release candidates from `develop`; `@latest` tracks stable releases from `main`. Pin a specific version with `@e-sensia/scaleway-mcp@0.1.0-rc.1`.
- `scw` still needs to be on PATH in the environment that runs the MCP. `npx` does not install the Scaleway CLI for you.
- `SCW_PROFILE` is omitted above — the MCP will use the default scw profile. Add it (e.g. `"SCW_PROFILE": "echo-prod"`) only if you have named profiles configured in `~/.config/scw/config.yaml`. See [Multi-project setups](#multi-project-setups).

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
    "scaleway": {
      "command": "node",
      "args": ["/absolute/path/to/scaleway-mcp/dist/index.js"],
      "env": {
        "SCW_MCP_READONLY": "true"
      }
    }
  }
}
```

Add `"SCW_PROFILE": "<name>"` to the `env` block only if you have named profiles in `~/.config/scw/config.yaml`.

## Environment variables

### MCP-specific

| Variable            | Default   | Meaning                                                                   |
| ------------------- | --------- | ------------------------------------------------------------------------- |
| `SCW_MCP_READONLY`  | `false`   | When `true`, blocks any command that isn't a read verb.                   |
| `SCW_MIN_VERSION`   | `2.55.0`  | Minimum `scw` version. Startup check.                                     |
| `SCW_TIMEOUT_MS`    | `60000`   | Per-call subprocess timeout.                                              |
| `SCW_BINARY`        | `scw`     | Path to the scw binary if not on PATH.                                    |

### Scaleway CLI passthrough

The MCP inherits the process environment, so any variable the `scw` CLI reads is also honored. Common ones you'll likely want to set per MCP entry:

| Variable                      | Purpose                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| `SCW_PROFILE`                 | Named profile from `~/.config/scw/config.yaml`. Per-call override also available on every tool as the `profile` arg. |
| `SCW_DEFAULT_ORGANIZATION_ID` | Default org for commands that filter by organization (e.g. `account project list`). |
| `SCW_DEFAULT_PROJECT_ID`      | Default project scope for most non-S3 resource queries.                 |
| `SCW_DEFAULT_REGION`          | e.g. `fr-par`, `nl-ams`, `pl-waw`.                                      |
| `SCW_DEFAULT_ZONE`            | e.g. `fr-par-1`.                                                        |
| `SCW_ACCESS_KEY`, `SCW_SECRET_KEY` | Override the IAM key from the config file.                         |

Full list in [scaleway-sdk-go docs](https://github.com/scaleway/scaleway-sdk-go/tree/master/scw#environment-variables).

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

## Multi-project setups

Scaleway's native pattern for working across projects is named profiles in `~/.config/scw/config.yaml`. A profile can override the default project, region, zone, or even the IAM key:

```yaml
access_key: SCW...
secret_key: ...
default_organization_id: <org-uuid>

profiles:
  echo-prod:
    default_project_id: <echo-prod-uuid>
    default_region: fr-par
  cicd-prod:
    default_project_id: <cicd-prod-uuid>
    default_region: fr-par
  echo-test:
    access_key: SCW...          # different key if the project has its own
    secret_key: ...
    default_project_id: <echo-test-uuid>
```

Pick a profile per MCP entry, so each server instance targets one project:

```json
{
  "mcpServers": {
    "scw-echo-prod": {
      "command": "node",
      "args": ["/path/to/scaleway-mcp/dist/index.js"],
      "env": { "SCW_PROFILE": "echo-prod", "SCW_MCP_READONLY": "true" }
    },
    "scw-cicd-prod": {
      "command": "node",
      "args": ["/path/to/scaleway-mcp/dist/index.js"],
      "env": { "SCW_PROFILE": "cicd-prod", "SCW_MCP_READONLY": "true" }
    }
  }
}
```

Or pass `profile` per-call as a tool argument — no server restart needed, useful for occasional cross-project queries.

## Known limitations

### Object Storage (S3) is scoped to the IAM key, not the profile

`scw_object bucket list` and related `scw object` commands use the S3-compatible endpoint. The S3 request is signed with the IAM key, and the key's `default_project_id` — baked in at key creation time — decides which project's buckets you see. **Changing `SCW_DEFAULT_PROJECT_ID` or switching to a profile with a different `default_project_id` has no effect on this.**

Scaleway supports a `<access_key>@<project_id>` suffix for per-project S3 scoping with a single key, but the `scw` SDK rejects this format at config-validation time, so it's not usable through this MCP.

Workarounds (pick one):

- **One key per project.** In Scaleway console → IAM → API keys, create a key scoped to each project that needs S3 access. Define one scw profile per key (each profile carries its own `access_key`/`secret_key`). Switch via `SCW_PROFILE` or the per-call `profile` arg.
- **Stay with one key, accept the scope.** If only one project has buckets you care about, set that as the key's default project in the Scaleway console.
- **Talk S3 directly.** For heavy cross-project S3 workflows, use any S3-compatible tool (rclone, s5cmd, boto3) against `s3.<region>.scw.cloud` with `access_key@<project_id>` — outside this MCP.

All other Scaleway services (`instance`, `rdb`, `k8s`, `lb`, `vpc`, …) respect the profile's `default_project_id` correctly, so the profile-per-project pattern works for everything except Object Storage.

## Development

```bash
npm test              # run unit tests
npm run typecheck     # tsc --noEmit
npm run refresh-services   # regenerate src/services.ts from scw --help
```
