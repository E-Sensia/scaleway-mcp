# Scaleway MCP — Design

**Status:** Draft
**Date:** 2026-04-23
**Owner:** pea@e-sensia.com

## Purpose

A local [Model Context Protocol](https://modelcontextprotocol.io) server that gives an LLM full CRUD access to any resource reachable through the Scaleway CLI (`scw`). The server is a thin subprocess wrapper — it executes `scw` and returns results, relying on the CLI as the source of truth for capabilities, auth, and output formats.

## Scope

- **In scope:** Every command exposed by `scw` v2.55.0 and later, including read, create, update, delete across all Scaleway services (compute, k8s, databases, object storage, IAM, VPC, serverless, etc.).
- **In scope:** Profile selection, output formatting, pagination hints, safety rails (read-only mode + destructive confirm).
- **Out of scope:** Direct Scaleway API calls (no SDK bindings), state persistence, caching, scheduling, remote transport (stdio only).

## Architecture

### Tool surface

One MCP tool per top-level Scaleway service listed under `scw --help`. Target ~33 services (e.g. `instance`, `rdb`, `k8s`, `iam`, `vpc`, `object`, `secret`, `cockpit`, `lb`, `dns`, `container`, `function`, `jobs`, `baremetal`, `mnq`, …). Each tool is named `scw_<service>` and scopes an executor to that service's subcommand tree.

The CLI's configuration/utility commands (`config`, `init`, `login`, `autocomplete`, `feedback`, `shell`, `help`, `version`) are **not** exposed as tools; the MCP manages its own config via env vars and uses `scw version` only for the startup check.

### Tool schema

Every `scw_<service>` tool accepts the same inputs:

| Field     | Type                      | Description                                                                                                                   |
| --------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `args`    | `string[]` (required)     | CLI args after `scw <service>`. E.g. for `scw_instance`: `["server", "list", "--zone", "fr-par-1"]`.                          |
| `profile` | `string` (optional)       | Override `SCW_PROFILE` for this call.                                                                                         |
| `output`  | `"json"\|"human"\|"yaml"` | Output format. Default `json`.                                                                                                |
| `help`    | `boolean`                 | If true, runs `<cmd> --help` and returns the help text verbatim. Skips all other processing.                                  |
| `confirm` | `boolean`                 | Required (`true`) for destructive verbs. Without it the call returns the resolved command and an error instead of executing. |

### Tool descriptions

Each tool's MCP description follows a template:

> Scaleway **&lt;service&gt;** API — &lt;one-line purpose&gt;. Resources: `<r1>, <r2>, ...`. Call with `help: true` to see subcommand syntax.

The resource list is generated once from `scw <service> --help` (top-level resources only) and committed in `src/services.ts`. A manual `npm run refresh-services` regenerates it.

### Modules

| File                    | Responsibility                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`          | MCP server bootstrap (stdio transport), tool registration from `services.ts`, request dispatch.                                                       |
| `src/services.ts`       | Static list of services (name, description line, resource hints). Generated from `scw --help`, committed.                                             |
| `src/executor.ts`       | Runs `scw` with resolved args. Handles profile injection, output-format injection, `--assume-yes`, stdin=ignore, timeout, maxBuffer.                  |
| `src/safety.ts`         | Read-only gate (verb allowlist when `SCW_MCP_READONLY=true`) and destructive-verb detector (denylist + `--force*` regex). Pure functions, no state.   |
| `src/truncate.ts`       | Output truncation when stdout exceeds threshold. Returns truncated text + hint line about pagination flags.                                           |
| `src/version-check.ts`  | Runs `scw version` at startup, parses, compares against `SCW_MIN_VERSION` (default `2.55.0`). Refuses to start if older or binary missing.            |
| `scripts/refresh-services.ts` | Developer tool: regenerates `services.ts` from `scw --help` and `scw <service> --help`.                                                         |

No persistence, no HTTP, no caching, no state between calls.

## Request flow

```
tool invoked
  └─ help: true? → run `scw <service> <args> --help`, return text, done
  └─ SCW_MCP_READONLY=true?
        └─ args pass read-allowlist (no destructive token/flag AND ≥1 read verb present)?
              no  → reject with "Read-only mode" error
              yes → continue
  └─ destructive token/flag detected (delete|terminate|destroy|purge|detach|remove|--force*|--recursive|-r)?
        └─ confirm !== true → return { error, resolvedCommand } without executing
        └─ confirm === true → continue
  └─ build command:
        - prepend --profile <resolved>  (call arg > SCW_PROFILE > scw default)
        - inject --output <fmt>          (default json; skip if already present)
        - append --assume-yes             (where supported; skip if already present)
  └─ execFile("scw", args, { timeout, maxBuffer, stdin: "ignore" })
  └─ stdout > threshold? → truncate + append pagination hint
  └─ return { command, exitCode, stdout, stderr, truncated }
```

### Profile resolution

Precedence: per-call `profile` arg > `SCW_PROFILE` env var > whatever `scw` chooses by default from `~/.config/scw/config.yaml`. The MCP never reads the config file directly.

### Destructive verb detector

Matches if **any** of the following are true in the `args` array (position-independent — Scaleway commands use both `<service> <verb>` and `<service> <resource> <verb>` shapes):

- Any positional token (i.e. not starting with `-`) matches case-insensitively: `delete`, `terminate`, `destroy`, `purge`, `detach`, `remove`.
- Any flag matches regex `^--force(-\w+)?$`, `^--recursive$`, or `^-r$`.

Rationale for ignoring `--flags` when token-matching positional verbs: avoids false positives like `--delete-me-not`. Edge cases covered by unit tests.

### Read-only allowlist

When `SCW_MCP_READONLY=true`, the `args` array must satisfy **both**:

1. No destructive token or flag is present (same rules as the destructive detector above).
2. At least one positional token matches case-insensitively: `list`, `get`, `show`, `describe`, `wait`, `version`, `info`, `help`.

This handles both command shapes — `scw account project list` (verb at position 3) and `scw billing consumption list` (verb at position 3) — without hard-coding a position. `help: true` always bypasses this check.

## Error handling

| Condition                         | Behavior                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `scw` non-zero exit               | Return `{ command, exitCode, stdout, stderr }` unchanged. Model reads `scw`'s own error message.   |
| Timeout (default 60 s)            | Kill subprocess, return `{ error: "timeout", command, partialStdout, partialStderr }`.             |
| Output > `maxBuffer` (5 MB)       | Catch, return `{ error: "output too large, narrow the query", command }` with pagination hint.     |
| `scw` missing on PATH             | Startup fails with install URL.                                                                    |
| `scw` version < `SCW_MIN_VERSION` | Startup fails: `"scw X.Y.Z found, need ≥ N.M.K. Upgrade with scw autoupgrade."`                    |
| Caller passed `--profile` inline  | Per-call `profile` arg still wins (last one wins in `scw`; we append our resolved value).          |
| Caller passed `--output` inline   | Detected; we do not double-inject. Caller wins.                                                    |
| Interactive stdin prompt          | Prevented by `stdin: "ignore"` and `--assume-yes`. If `scw` still prompts, the call EOFs and errors. |

`scw`'s stdout is never parsed server-side — returned as a string. The model does whatever parsing it needs.

## Configuration

All via environment variables.

| Variable            | Default   | Meaning                                                          |
| ------------------- | --------- | ---------------------------------------------------------------- |
| `SCW_PROFILE`       | _(unset)_ | Default Scaleway profile. Falls back to `scw` default if unset. |
| `SCW_MCP_READONLY`  | `false`   | When `true`, blocks any command whose verb is not in the read allowlist. |
| `SCW_MIN_VERSION`   | `2.55.0`  | Minimum acceptable `scw` version. Startup check.                 |
| `SCW_TIMEOUT_MS`    | `60000`   | Per-call subprocess timeout.                                     |
| `SCW_BINARY`        | `scw`     | Path override if `scw` is not on PATH.                           |

Two intended MCP client entries:

- `scaleway-prod` — `SCW_PROFILE=prod`, `SCW_MCP_READONLY=true`. Safe for day-to-day queries.
- `scaleway-test` — `SCW_PROFILE=test`, `SCW_MCP_READONLY=false`. Writes allowed, destructive ops still require `confirm: true`.

## Testing

- **Unit (vitest):**
  - `safety.ts` — truth table: args → `{destructive, readViolation}`. Covers `--force-delete`, `delete` as noun, `get` as noun, case-insensitivity.
  - `executor.ts` — mock `execFile`; verify profile/output/assume-yes injection, caller-wins precedence, help bypass.
  - `truncate.ts` — boundary cases, UTF-8 safety, hint appended.
- **Integration (opt-in, `INTEGRATION=1`):** Real reads against a test profile — `scw account project list`, `scw instance server list --zone=fr-par-1`. Skipped by default.
- **No mocking of `scw`** beyond the `execFile` boundary. The CLI is the contract.

## Packaging

- `package.json` with `"bin": { "scaleway-mcp": "dist/index.js" }`.
- Build: `tsc` → `dist/`. No bundler.
- Node ≥ 20 pinned in `engines`.
- README covers: prereqs, MCP client config example (Claude Code `settings.json`), env var reference, the two `-prod` / `-test` entries.

## Repo layout

```
scaleway-mcp/
├── src/
│   ├── index.ts
│   ├── services.ts
│   ├── executor.ts
│   ├── safety.ts
│   ├── truncate.ts
│   └── version-check.ts
├── scripts/
│   └── refresh-services.ts
├── test/
│   └── *.test.ts
├── docs/
│   └── superpowers/specs/
├── package.json
├── tsconfig.json
├── README.md
└── .gitignore
```

## Open questions deferred to implementation

- Exact final list of 33 services (to be frozen when `refresh-services.ts` runs for the first time against `scw ≥ 2.55.0`).
- Exact truncation threshold (initial: 50 KB / 500 lines, tune after real use).
- Whether `scw --assume-yes` is universally supported across all destructive subcommands or needs a per-command map (discover while testing).
