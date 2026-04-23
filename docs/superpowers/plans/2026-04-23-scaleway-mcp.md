# Scaleway MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript MCP server that exposes one tool per top-level Scaleway service (`scw_<service>`), each a scoped executor that wraps the `scw` CLI with read-only and destructive-confirm safety rails.

**Architecture:** Stdio MCP server using `@modelcontextprotocol/sdk`. Pure-function modules for safety, truncation, version check, and config. An `executor` module spawns `scw` via `child_process.execFile`. `index.ts` wires everything together and registers one tool per Scaleway service.

**Tech Stack:** Node ≥ 20, TypeScript, `@modelcontextprotocol/sdk`, `zod`, `vitest`.

**Spec:** [`docs/superpowers/specs/2026-04-23-scaleway-mcp-design.md`](../specs/2026-04-23-scaleway-mcp-design.md)

---

## File Structure

- `package.json` — deps, scripts, `bin`, `engines`
- `tsconfig.json` — strict TS config
- `.gitignore` — `node_modules/`, `dist/`, OS noise
- `vitest.config.ts` — test runner config
- `README.md` — user-facing install + MCP client config
- `src/safety.ts` — destructive detector + readonly allowlist (pure)
- `src/truncate.ts` — stdout truncation + pagination hint (pure)
- `src/config.ts` — env var parsing (pure)
- `src/version-check.ts` — startup `scw version` check
- `src/executor.ts` — subprocess runner, arg injection, output handling
- `src/services.ts` — static list of ~33 Scaleway services + descriptions
- `src/index.ts` — MCP server bootstrap, tool registration, dispatch
- `scripts/refresh-services.ts` — dev tool that regenerates `services.ts` from `scw --help`
- `test/safety.test.ts`
- `test/truncate.test.ts`
- `test/config.test.ts`
- `test/version-check.test.ts`
- `test/executor.test.ts`

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `vitest.config.ts`, `src/.gitkeep`, `test/.gitkeep`

- [ ] **Step 1: Initialize npm package**

Create `package.json`:

```json
{
  "name": "@e-sensia/scaleway-mcp",
  "version": "0.1.0",
  "description": "MCP server that exposes the Scaleway CLI as tools.",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "scaleway-mcp": "dist/index.js"
  },
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "refresh-services": "tsx scripts/refresh-services.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Add TypeScript config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test", "scripts"]
}
```

- [ ] **Step 3: Add vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Add .gitignore**

Create `.gitignore`:

```
node_modules/
dist/
.DS_Store
*.log
coverage/
```

- [ ] **Step 5: Create source dirs**

Run:
```bash
mkdir -p src test scripts
touch src/.gitkeep test/.gitkeep
```

- [ ] **Step 6: Install dependencies**

Run:
```bash
npm install
```
Expected: dependency tree installed, no errors.

- [ ] **Step 7: Verify build + test commands work**

Run:
```bash
npm run typecheck
npm test
```
Expected: both succeed (typecheck passes over empty src; vitest reports "No test files found" but exits 0 — if vitest exits non-zero, create a trivial `test/sanity.test.ts` with `test("ok", () => {})`).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/.gitkeep test/.gitkeep
git commit -m "chore: project scaffold (ts, vitest, mcp sdk)"
```

---

## Task 2: Safety module

Pure functions. TDD. The destructive detector and readonly allowlist from the spec.

**Files:**
- Create: `src/safety.ts`
- Test: `test/safety.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/safety.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isDestructive, checkReadonly } from "../src/safety.js";

describe("isDestructive", () => {
  it("detects destructive verb tokens", () => {
    expect(isDestructive(["server", "delete", "abc"])).toBe(true);
    expect(isDestructive(["server", "terminate", "abc"])).toBe(true);
    expect(isDestructive(["cluster", "destroy"])).toBe(true);
    expect(isDestructive(["volume", "detach", "abc"])).toBe(true);
    expect(isDestructive(["user", "remove", "abc"])).toBe(true);
    expect(isDestructive(["cache", "purge"])).toBe(true);
  });

  it("is case-insensitive on verb tokens", () => {
    expect(isDestructive(["server", "DELETE"])).toBe(true);
    expect(isDestructive(["server", "Terminate"])).toBe(true);
  });

  it("detects destructive flags", () => {
    expect(isDestructive(["server", "stop", "--force"])).toBe(true);
    expect(isDestructive(["server", "stop", "--force-shutdown"])).toBe(true);
    expect(isDestructive(["dir", "rm", "--recursive"])).toBe(true);
    expect(isDestructive(["dir", "rm", "-r"])).toBe(true);
  });

  it("returns false for read-only commands", () => {
    expect(isDestructive(["server", "list"])).toBe(false);
    expect(isDestructive(["server", "get", "abc"])).toBe(false);
    expect(isDestructive(["info"])).toBe(false);
  });

  it("ignores flags that merely contain destructive words", () => {
    expect(isDestructive(["server", "list", "--delete-me-not"])).toBe(false);
  });

  it("handles resource+verb shape", () => {
    expect(isDestructive(["policy", "delete", "id"])).toBe(true); // scw iam policy delete
  });
});

describe("checkReadonly", () => {
  it("passes when readonly is disabled", () => {
    expect(checkReadonly(["server", "delete", "abc"], false)).toEqual({ allowed: true });
  });

  it("blocks destructive verbs when readonly is enabled", () => {
    const result = checkReadonly(["server", "delete", "abc"], true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/read-only/i);
  });

  it("blocks destructive flags when readonly is enabled", () => {
    const result = checkReadonly(["server", "stop", "--force"], true);
    expect(result.allowed).toBe(false);
  });

  it("requires at least one read verb when readonly is enabled", () => {
    const result = checkReadonly(["server", "create"], true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/read verb/i);
  });

  it("allows commands with a read verb and no destructive tokens", () => {
    expect(checkReadonly(["server", "list"], true)).toEqual({ allowed: true });
    expect(checkReadonly(["account", "project", "get", "id"], true)).toEqual({ allowed: true });
    expect(checkReadonly(["version"], true)).toEqual({ allowed: true });
  });

  it("treats read-verb check case-insensitively", () => {
    expect(checkReadonly(["Server", "LIST"], true)).toEqual({ allowed: true });
  });
});
```

- [ ] **Step 2: Run tests — should fail (module missing)**

Run:
```bash
npm test
```
Expected: FAIL — "Cannot find module '../src/safety.js'".

- [ ] **Step 3: Implement `src/safety.ts`**

Create `src/safety.ts`:

```ts
const DESTRUCTIVE_VERBS = new Set([
  "delete",
  "terminate",
  "destroy",
  "purge",
  "detach",
  "remove",
]);

const READ_VERBS = new Set([
  "list",
  "get",
  "show",
  "describe",
  "wait",
  "version",
  "info",
  "help",
]);

const DESTRUCTIVE_FLAG = /^(--force(-\w+)?|--recursive|-r)$/;

function isPositional(arg: string): boolean {
  return !arg.startsWith("-");
}

export function isDestructive(args: readonly string[]): boolean {
  for (const arg of args) {
    if (isPositional(arg) && DESTRUCTIVE_VERBS.has(arg.toLowerCase())) {
      return true;
    }
    if (!isPositional(arg) && DESTRUCTIVE_FLAG.test(arg)) {
      return true;
    }
  }
  return false;
}

export type ReadonlyCheck = { allowed: true } | { allowed: false; reason: string };

export function checkReadonly(args: readonly string[], readonly: boolean): ReadonlyCheck {
  if (!readonly) return { allowed: true };
  if (isDestructive(args)) {
    return {
      allowed: false,
      reason: "Read-only mode: destructive verb or flag detected. Set SCW_MCP_READONLY=false to enable writes.",
    };
  }
  const hasReadVerb = args.some(
    (a) => isPositional(a) && READ_VERBS.has(a.toLowerCase())
  );
  if (!hasReadVerb) {
    return {
      allowed: false,
      reason: "Read-only mode: no read verb (list|get|show|describe|wait|version|info|help) found in args.",
    };
  }
  return { allowed: true };
}
```

- [ ] **Step 4: Run tests — should pass**

Run:
```bash
npm test
```
Expected: all tests in `safety.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add src/safety.ts test/safety.test.ts
git commit -m "feat(safety): destructive detector and readonly allowlist"
```

---

## Task 3: Truncate module

Pure function. Tail-replace when stdout exceeds thresholds.

**Files:**
- Create: `src/truncate.ts`
- Test: `test/truncate.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/truncate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { truncateOutput } from "../src/truncate.js";

describe("truncateOutput", () => {
  it("returns input unchanged when below both limits", () => {
    const input = "line1\nline2\nline3\n";
    const out = truncateOutput(input, { maxBytes: 1000, maxLines: 100 });
    expect(out).toEqual({ text: input, truncated: false });
  });

  it("truncates by byte limit and appends hint", () => {
    const input = "x".repeat(200);
    const out = truncateOutput(input, { maxBytes: 100, maxLines: 100 });
    expect(out.truncated).toBe(true);
    expect(out.text.startsWith("x".repeat(100))).toBe(true);
    expect(out.text).toMatch(/truncated/i);
    expect(out.text).toMatch(/pagination|narrow/i);
  });

  it("truncates by line limit and appends hint", () => {
    const input = Array.from({ length: 50 }, (_, i) => `line${i}`).join("\n");
    const out = truncateOutput(input, { maxBytes: 100000, maxLines: 10 });
    expect(out.truncated).toBe(true);
    expect(out.text.split("\n").slice(0, 10).join("\n")).toBe(
      Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n")
    );
    expect(out.text).toMatch(/truncated/i);
  });

  it("does not split a multi-byte UTF-8 character", () => {
    const input = "é".repeat(100); // each "é" is 2 bytes
    const out = truncateOutput(input, { maxBytes: 5, maxLines: 1000 });
    expect(out.truncated).toBe(true);
    // text before the hint must be valid UTF-8
    const firstLine = out.text.split("\n")[0];
    expect(() => new TextEncoder().encode(firstLine)).not.toThrow();
    expect(firstLine).not.toContain("�");
  });
});
```

- [ ] **Step 2: Run tests — should fail**

Run:
```bash
npm test -- truncate
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/truncate.ts`**

Create `src/truncate.ts`:

```ts
export type TruncateOptions = {
  maxBytes: number;
  maxLines: number;
};

export type TruncateResult = {
  text: string;
  truncated: boolean;
};

const HINT = "\n\n--- output truncated. Narrow with pagination flags (--page, --page-size) or filters (--organization-id, --tag, --name) ---";

export function truncateOutput(input: string, opts: TruncateOptions): TruncateResult {
  let truncated = false;
  let text = input;

  // line limit
  const lines = text.split("\n");
  if (lines.length > opts.maxLines) {
    text = lines.slice(0, opts.maxLines).join("\n");
    truncated = true;
  }

  // byte limit — use TextEncoder to count bytes, then walk back to a char boundary
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  if (bytes.length > opts.maxBytes) {
    // Decode the first `maxBytes` bytes, stopping at the last complete UTF-8 char.
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let cut = opts.maxBytes;
    // decode in fatal mode to find the largest prefix that is valid UTF-8
    while (cut > 0) {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, cut));
        break;
      } catch {
        cut -= 1;
      }
    }
    truncated = true;
  }

  if (truncated) text = text + HINT;
  return { text, truncated };
}
```

- [ ] **Step 4: Run tests — should pass**

Run:
```bash
npm test -- truncate
```
Expected: all truncate tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/truncate.ts test/truncate.test.ts
git commit -m "feat(truncate): size/line capping with pagination hint"
```

---

## Task 4: Config module

Parse env vars with defaults. Pure.

**Files:**
- Create: `src/config.ts`
- Test: `test/config.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";

describe("parseConfig", () => {
  it("applies all defaults when env is empty", () => {
    const cfg = parseConfig({});
    expect(cfg).toEqual({
      profile: undefined,
      readonly: false,
      minVersion: "2.55.0",
      timeoutMs: 60_000,
      binary: "scw",
      maxBytes: 50_000,
      maxLines: 500,
    });
  });

  it("reads SCW_PROFILE", () => {
    expect(parseConfig({ SCW_PROFILE: "prod" }).profile).toBe("prod");
  });

  it("parses SCW_MCP_READONLY", () => {
    expect(parseConfig({ SCW_MCP_READONLY: "true" }).readonly).toBe(true);
    expect(parseConfig({ SCW_MCP_READONLY: "1" }).readonly).toBe(true);
    expect(parseConfig({ SCW_MCP_READONLY: "false" }).readonly).toBe(false);
    expect(parseConfig({ SCW_MCP_READONLY: "0" }).readonly).toBe(false);
    expect(parseConfig({ SCW_MCP_READONLY: "" }).readonly).toBe(false);
  });

  it("overrides min version", () => {
    expect(parseConfig({ SCW_MIN_VERSION: "2.60.0" }).minVersion).toBe("2.60.0");
  });

  it("overrides timeout", () => {
    expect(parseConfig({ SCW_TIMEOUT_MS: "30000" }).timeoutMs).toBe(30000);
  });

  it("throws on non-numeric timeout", () => {
    expect(() => parseConfig({ SCW_TIMEOUT_MS: "abc" })).toThrow(/SCW_TIMEOUT_MS/);
  });

  it("overrides binary path", () => {
    expect(parseConfig({ SCW_BINARY: "/usr/local/bin/scw" }).binary).toBe("/usr/local/bin/scw");
  });
});
```

- [ ] **Step 2: Run tests — should fail**

Run:
```bash
npm test -- config
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/config.ts`**

Create `src/config.ts`:

```ts
export type Config = {
  profile: string | undefined;
  readonly: boolean;
  minVersion: string;
  timeoutMs: number;
  binary: string;
  maxBytes: number;
  maxLines: number;
};

function parseBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

export function parseConfig(env: Record<string, string | undefined>): Config {
  const timeoutRaw = env.SCW_TIMEOUT_MS;
  let timeoutMs = 60_000;
  if (timeoutRaw !== undefined && timeoutRaw !== "") {
    const parsed = Number(timeoutRaw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`SCW_TIMEOUT_MS must be a positive number, got: ${timeoutRaw}`);
    }
    timeoutMs = parsed;
  }

  return {
    profile: env.SCW_PROFILE || undefined,
    readonly: parseBool(env.SCW_MCP_READONLY),
    minVersion: env.SCW_MIN_VERSION || "2.55.0",
    timeoutMs,
    binary: env.SCW_BINARY || "scw",
    maxBytes: 50_000,
    maxLines: 500,
  };
}
```

- [ ] **Step 4: Run tests — should pass**

Run:
```bash
npm test -- config
```
Expected: all config tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat(config): parse env vars with defaults"
```

---

## Task 5: Version check module

Parse `scw version` output, compare to min, refuse startup if below.

**Files:**
- Create: `src/version-check.ts`
- Test: `test/version-check.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/version-check.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseScwVersion, compareVersions } from "../src/version-check.js";

describe("parseScwVersion", () => {
  it("extracts version from scw version output", () => {
    const out = `Version          2.55.0
BuildDate        2026-02-04T17:25:45Z
GoVersion        go1.25.6
`;
    expect(parseScwVersion(out)).toBe("2.55.0");
  });

  it("handles extra whitespace and casing", () => {
    expect(parseScwVersion("Version 2.52.0\n")).toBe("2.52.0");
    expect(parseScwVersion("version: 3.0.1")).toBe("3.0.1");
  });

  it("returns null when no version line is found", () => {
    expect(parseScwVersion("this is not scw")).toBe(null);
  });
});

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("2.55.0", "2.55.0")).toBe(0);
  });

  it("returns negative when a < b", () => {
    expect(compareVersions("2.52.0", "2.55.0")).toBeLessThan(0);
    expect(compareVersions("2.55.0", "2.55.1")).toBeLessThan(0);
    expect(compareVersions("1.99.99", "2.0.0")).toBeLessThan(0);
  });

  it("returns positive when a > b", () => {
    expect(compareVersions("2.56.0", "2.55.0")).toBeGreaterThan(0);
    expect(compareVersions("3.0.0", "2.99.0")).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests — should fail**

Run:
```bash
npm test -- version-check
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/version-check.ts`**

Create `src/version-check.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export function parseScwVersion(stdout: string): string | null {
  const match = stdout.match(/version[:\s]+([0-9]+\.[0-9]+\.[0-9]+)/i);
  return match ? match[1]! : null;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

export async function assertScwVersion(binary: string, minVersion: string): Promise<string> {
  let stdout: string;
  try {
    const result = await execFileP(binary, ["version"], { timeout: 10_000 });
    stdout = result.stdout;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not run '${binary} version'. Is scw installed and on PATH? Install: https://github.com/scaleway/scaleway-cli. (${msg})`
    );
  }
  const version = parseScwVersion(stdout);
  if (!version) {
    throw new Error(`Could not parse scw version from output:\n${stdout}`);
  }
  if (compareVersions(version, minVersion) < 0) {
    throw new Error(
      `scw ${version} found, need >= ${minVersion}. Upgrade with 'scw autoupgrade' or download from https://github.com/scaleway/scaleway-cli/releases.`
    );
  }
  return version;
}
```

- [ ] **Step 4: Run tests — should pass**

Run:
```bash
npm test -- version-check
```
Expected: unit tests for `parseScwVersion` and `compareVersions` pass. (`assertScwVersion` is integration-only — not unit tested here.)

- [ ] **Step 5: Commit**

```bash
git add src/version-check.ts test/version-check.test.ts
git commit -m "feat(version-check): parse scw version and compare semver"
```

---

## Task 6: Executor module

Runs `scw` via `execFile`. Injects `--profile`, `--output`, `--assume-yes`. Honors caller overrides. Timeouts. Truncation. Ignores stdin.

**Files:**
- Create: `src/executor.ts`
- Test: `test/executor.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/executor.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ExecutorDeps } from "../src/executor.js";
import { runScw, buildArgs } from "../src/executor.js";

describe("buildArgs", () => {
  it("prepends service and appends defaults", () => {
    const out = buildArgs({
      service: "instance",
      userArgs: ["server", "list"],
      profile: "prod",
      output: "json",
    });
    expect(out).toEqual([
      "instance",
      "server",
      "list",
      "--profile",
      "prod",
      "--output",
      "json",
      "--assume-yes",
    ]);
  });

  it("does not add --profile when unset", () => {
    const out = buildArgs({
      service: "instance",
      userArgs: ["server", "list"],
      profile: undefined,
      output: "json",
    });
    expect(out).not.toContain("--profile");
  });

  it("respects caller-supplied --output", () => {
    const out = buildArgs({
      service: "instance",
      userArgs: ["server", "list", "--output", "yaml"],
      profile: undefined,
      output: "json",
    });
    expect(out.filter((a) => a === "--output")).toHaveLength(1);
    const idx = out.indexOf("--output");
    expect(out[idx + 1]).toBe("yaml");
  });

  it("respects caller-supplied --profile", () => {
    const out = buildArgs({
      service: "instance",
      userArgs: ["server", "list", "--profile", "override"],
      profile: "prod",
      output: "json",
    });
    expect(out.filter((a) => a === "--profile")).toHaveLength(1);
    const idx = out.indexOf("--profile");
    expect(out[idx + 1]).toBe("override");
  });

  it("skips --assume-yes if caller already supplied -y", () => {
    const out = buildArgs({
      service: "instance",
      userArgs: ["server", "delete", "abc", "-y"],
      profile: undefined,
      output: "json",
    });
    expect(out.filter((a) => a === "--assume-yes" || a === "-y")).toEqual(["-y"]);
  });
});

describe("runScw", () => {
  const deps = (
    impl: (bin: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>
  ): ExecutorDeps => ({
    execFile: (bin, args, _opts) =>
      impl(bin, args).then(
        (r) => ({ ...r, exitCode: 0 }),
        (err: { stdout?: string; stderr?: string; code?: number; message?: string }) => ({
          stdout: err.stdout ?? "",
          stderr: err.stderr ?? err.message ?? "",
          exitCode: err.code ?? 1,
        })
      ),
  });

  it("returns stdout/stderr/exitCode/command", async () => {
    const d = deps(async () => ({ stdout: "ok", stderr: "" }));
    const res = await runScw(
      { service: "instance", args: ["server", "list"] },
      {
        binary: "scw",
        profile: undefined,
        output: "json",
        timeoutMs: 60000,
        maxBytes: 50000,
        maxLines: 500,
      },
      d
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe("ok");
    expect(res.command).toBe("scw instance server list --output json --assume-yes");
    expect(res.truncated).toBe(false);
  });

  it("bypasses injection and returns help text when help=true", async () => {
    const calls: string[][] = [];
    const d = deps(async (_bin, args) => {
      calls.push([...args]);
      return { stdout: "HELP TEXT", stderr: "" };
    });
    await runScw(
      { service: "instance", args: ["server"], help: true },
      {
        binary: "scw",
        profile: undefined,
        output: "json",
        timeoutMs: 60000,
        maxBytes: 50000,
        maxLines: 500,
      },
      d
    );
    expect(calls[0]).toEqual(["instance", "server", "--help"]);
  });

  it("truncates oversized stdout", async () => {
    const big = "x".repeat(1000);
    const d = deps(async () => ({ stdout: big, stderr: "" }));
    const res = await runScw(
      { service: "instance", args: ["server", "list"] },
      {
        binary: "scw",
        profile: undefined,
        output: "json",
        timeoutMs: 60000,
        maxBytes: 100,
        maxLines: 500,
      },
      d
    );
    expect(res.truncated).toBe(true);
    expect(res.stdout.length).toBeLessThan(big.length);
  });

  it("surfaces non-zero exit with stdout+stderr", async () => {
    const d = deps(async () => {
      throw { stdout: "", stderr: "permission denied", code: 1 };
    });
    const res = await runScw(
      { service: "instance", args: ["server", "list"] },
      {
        binary: "scw",
        profile: undefined,
        output: "json",
        timeoutMs: 60000,
        maxBytes: 50000,
        maxLines: 500,
      },
      d
    );
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("permission denied");
  });
});
```

- [ ] **Step 2: Run tests — should fail**

Run:
```bash
npm test -- executor
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/executor.ts`**

Create `src/executor.ts`:

```ts
import { execFile } from "node:child_process";
import { truncateOutput } from "./truncate.js";

export type OutputFormat = "json" | "human" | "yaml";

export type BuildArgsInput = {
  service: string;
  userArgs: readonly string[];
  profile: string | undefined;
  output: OutputFormat;
};

export function buildArgs(input: BuildArgsInput): string[] {
  const out: string[] = [input.service, ...input.userArgs];

  const hasOutput = out.some((a) => a === "-o" || a === "--output");
  if (!hasOutput) {
    out.push("--output", input.output);
  }

  const hasProfile = out.some((a) => a === "-p" || a === "--profile");
  if (!hasProfile && input.profile) {
    out.push("--profile", input.profile);
  }

  const hasAssume = out.some((a) => a === "-y" || a === "--assume-yes");
  if (!hasAssume) {
    out.push("--assume-yes");
  }

  return out;
}

export type RunInput = {
  service: string;
  args: readonly string[];
  profile?: string;
  output?: OutputFormat;
  help?: boolean;
};

export type RunEnv = {
  binary: string;
  profile: string | undefined;
  output: OutputFormat;
  timeoutMs: number;
  maxBytes: number;
  maxLines: number;
};

export type RunResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
};

export type ExecutorDeps = {
  execFile: (
    bin: string,
    args: readonly string[],
    opts: { timeoutMs: number; maxBuffer: number }
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
};

export const defaultDeps: ExecutorDeps = {
  execFile: (bin, args, opts) =>
    new Promise((resolve) => {
      const child = execFile(
        bin,
        args,
        { timeout: opts.timeoutMs, maxBuffer: opts.maxBuffer },
        (err, stdout, stderr) => {
          if (err) {
            const code = typeof (err as NodeJS.ErrnoException).code === "number"
              ? ((err as unknown) as { code: number }).code
              : 1;
            resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? err.message), exitCode: code });
            return;
          }
          resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), exitCode: 0 });
        }
      );
      // prevent any interactive prompts from hanging
      child.stdin?.end();
    }),
};

export async function runScw(
  input: RunInput,
  env: RunEnv,
  deps: ExecutorDeps = defaultDeps
): Promise<RunResult> {
  const finalArgs = input.help
    ? [input.service, ...input.args, "--help"]
    : buildArgs({
        service: input.service,
        userArgs: input.args,
        profile: input.profile ?? env.profile,
        output: input.output ?? env.output,
      });

  const command = `${env.binary} ${finalArgs.join(" ")}`;

  const result = await deps.execFile(env.binary, finalArgs, {
    timeoutMs: env.timeoutMs,
    maxBuffer: 5 * 1024 * 1024,
  });

  const { text, truncated } = truncateOutput(result.stdout, {
    maxBytes: env.maxBytes,
    maxLines: env.maxLines,
  });

  return {
    command,
    exitCode: result.exitCode,
    stdout: text,
    stderr: result.stderr,
    truncated,
  };
}
```

- [ ] **Step 4: Run tests — should pass**

Run:
```bash
npm test -- executor
```
Expected: all executor tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/executor.ts test/executor.test.ts
git commit -m "feat(executor): scw subprocess runner with arg injection and truncation"
```

---

## Task 7: Services list

Static metadata for tool registration. Start with a hand-curated list; Task 8 builds the refresh script that regenerates it.

**Files:**
- Create: `src/services.ts`

- [ ] **Step 1: Write the services list**

Create `src/services.ts`. The list below is derived from `scw --help` on v2.55.0. If the refresh script (Task 8) produces a different set, that output supersedes this.

```ts
export type ServiceMeta = {
  name: string;        // CLI service name, also MCP tool suffix (scw_<name>)
  description: string; // one-line purpose, shown in tool description
  resources: string;   // comma-separated list of top-level resources under the service
};

export const SERVICES: ServiceMeta[] = [
  { name: "account", description: "Scaleway Projects management", resources: "project, contract, qualification" },
  { name: "apple-silicon", description: "Apple silicon bare-metal servers", resources: "server, os, type" },
  { name: "audit-trail", description: "Organization audit-trail events", resources: "event, product" },
  { name: "baremetal", description: "Elastic Metal servers", resources: "server, offer, option, os, setting, partitioning, private-network" },
  { name: "billing", description: "Billing and consumption", resources: "consumption, invoice, discount" },
  { name: "block", description: "Block Storage volumes", resources: "volume, snapshot, volume-type" },
  { name: "cockpit", description: "Cockpit metrics, logs, alerts, and grafana users", resources: "cockpit, grafana-user, token, alert-manager, datasource, plan, contact-point" },
  { name: "container", description: "Serverless Containers", resources: "namespace, container, cron, domain, token, trigger" },
  { name: "datalab", description: "Apache Spark Data Lab", resources: "cluster" },
  { name: "datawarehouse", description: "Managed Data Warehouse", resources: "deployment, user" },
  { name: "dns", description: "DNS zones and records", resources: "zone, record, domain, tsig-key, version, dnssec" },
  { name: "edge-services", description: "Edge Services pipelines and caching", resources: "pipeline, route-stage, tls-stage, cache-stage, backend-stage, purge-request, plan" },
  { name: "fip", description: "Elastic Metal flexible public IPs", resources: "ip" },
  { name: "function", description: "Function as a Service", resources: "namespace, function, cron, domain, token, trigger, runtime" },
  { name: "iam", description: "Identity and Access Management", resources: "user, group, application, policy, rule, api-key, permission-set, ssh-key, jwt, log" },
  { name: "inference", description: "Managed Inference services", resources: "deployment, model, acl" },
  { name: "instance", description: "CPU/GPU Instances (VMs)", resources: "server, volume, snapshot, image, ip, placement-group, security-group, ssh-key, user-data, private-nic" },
  { name: "interlink", description: "InterLink services", resources: "link, partner, pop, routing-policy" },
  { name: "iot", description: "IoT hubs and devices", resources: "hub, device, route, network, twin" },
  { name: "ipam", description: "IP Address Management", resources: "ip, attachment" },
  { name: "jobs", description: "Serverless Jobs", resources: "definition, run" },
  { name: "k8s", description: "Kubernetes Kapsule and Kosmos clusters", resources: "cluster, pool, node, version, acl" },
  { name: "keymanager", description: "Key Manager", resources: "key, alias, usage" },
  { name: "lb", description: "Load Balancers", resources: "lb, ip, backend, frontend, certificate, acl, route, subscriber" },
  { name: "marketplace", description: "Marketplace images for Instances", resources: "image, local-image, version, category" },
  { name: "mnq", description: "Messaging and Queuing (NATS, SQS/SNS, Events)", resources: "nats, sqs, sns, sns-topic, sns-subscription, events" },
  { name: "mongodb", description: "Managed MongoDB Databases", resources: "instance, user, snapshot, node-type, version" },
  { name: "object", description: "Object storage utilities", resources: "bucket, config" },
  { name: "rdb", description: "Managed PostgreSQL and MySQL", resources: "instance, database, user, privilege, acl, backup, log, read-replica, node-type, engine, snapshot" },
  { name: "redis", description: "Managed Redis Databases", resources: "cluster, version, node-type, acl, endpoint, certificate" },
  { name: "registry", description: "Container Registry", resources: "namespace, image, tag" },
  { name: "s2s-vpn", description: "Site-to-Site VPN", resources: "gateway, peer, route, connection" },
  { name: "sdb-sql", description: "Serverless SQL Databases", resources: "database" },
  { name: "searchdb", description: "Cloud Essentials for Opensearch", resources: "cluster" },
  { name: "secret", description: "Secret Manager", resources: "secret, version, folder, tag" },
  { name: "tem", description: "Transactional Email", resources: "email, domain, webhook, project" },
  { name: "vpc", description: "Virtual Private Clouds and Private Networks", resources: "vpc, private-network, subnet, route" },
  { name: "vpc-gw", description: "VPC Public Gateways", resources: "gateway, gateway-network, ip, dhcp, dhcp-entry, pat-rule" },
  { name: "webhosting", description: "cPanel and WordPress Web Hosting", resources: "backup" },
  { name: "file", description: "File Storage", resources: "filesystem" },
];
```

- [ ] **Step 2: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/services.ts
git commit -m "feat(services): static list of Scaleway top-level services"
```

---

## Task 8: Refresh-services script

Dev tool: parse `scw --list-sub-commands` and `scw <service> --help` to rewrite `src/services.ts`. Not runtime code — convenience for upgrades.

**Files:**
- Create: `scripts/refresh-services.ts`

- [ ] **Step 1: Implement the script**

Create `scripts/refresh-services.ts`:

```ts
#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const BINARY = process.env.SCW_BINARY ?? "scw";

type Service = { name: string; description: string; resources: string };

function listTopLevelCommands(): string[] {
  const out = execFileSync(BINARY, ["--list-sub-commands"], { encoding: "utf8" });
  const tops = new Set<string>();
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // each line is a full path; take the first token
    const first = trimmed.split(/\s+/)[0];
    if (first) tops.add(first);
  }
  // drop configuration/utility commands
  for (const drop of ["config", "init", "login", "autocomplete", "feedback", "shell", "help", "version", "alias", "info"]) {
    tops.delete(drop);
  }
  return Array.from(tops).sort();
}

function describe(service: string): { description: string; resources: string } {
  const help = execFileSync(BINARY, [service, "--help"], { encoding: "utf8" });
  const lines = help.split("\n");

  // description: take the first non-empty line that isn't "USAGE:" or similar
  let description = "";
  for (const l of lines) {
    const t = l.trim();
    if (!t) continue;
    if (/^(USAGE|AVAILABLE|FLAGS|EXAMPLES|GLOBAL)/i.test(t)) continue;
    description = t.replace(/\.$/, "");
    break;
  }

  // resources: parse the "AVAILABLE COMMANDS:" block
  const resources: string[] = [];
  let inBlock = false;
  for (const l of lines) {
    if (/^AVAILABLE COMMANDS:/i.test(l.trim())) { inBlock = true; continue; }
    if (inBlock) {
      if (!l.trim()) break;
      const m = l.match(/^\s+(\S+)\s/);
      if (m) resources.push(m[1]!);
    }
  }
  return { description: description || `Scaleway ${service}`, resources: resources.join(", ") };
}

function main() {
  const services: Service[] = [];
  for (const name of listTopLevelCommands()) {
    try {
      const { description, resources } = describe(name);
      services.push({ name, description, resources });
      console.error(`✓ ${name} (${resources.split(",").length} resources)`);
    } catch (err) {
      console.error(`✗ ${name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const body = `export type ServiceMeta = {
  name: string;
  description: string;
  resources: string;
};

export const SERVICES: ServiceMeta[] = ${JSON.stringify(services, null, 2)};
`;
  writeFileSync("src/services.ts", body);
  console.error(`\nWrote ${services.length} services to src/services.ts`);
}

main();
```

- [ ] **Step 2: Sanity run (optional — requires scw on PATH)**

Run:
```bash
npm run refresh-services
```
Expected: prints one line per service, rewrites `src/services.ts`.

Skip or revert if it produces noisy output you're not ready to commit. The hand-written list from Task 7 is the fallback.

- [ ] **Step 3: Commit**

```bash
git add scripts/refresh-services.ts
git commit -m "feat(scripts): refresh-services regenerator from scw --help"
```

---

## Task 9: MCP server bootstrap

Wires everything together. Registers one tool per service. Handles dispatch.

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write the bootstrap**

Create `src/index.ts`:

```ts
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { parseConfig } from "./config.js";
import { assertScwVersion } from "./version-check.js";
import { SERVICES } from "./services.js";
import { checkReadonly, isDestructive } from "./safety.js";
import { runScw, type OutputFormat } from "./executor.js";

const toolInputSchema = {
  args: z
    .array(z.string())
    .describe("CLI args after 'scw <service>'. Example: [\"server\", \"list\", \"--zone\", \"fr-par-1\"]."),
  profile: z.string().optional().describe("Override SCW_PROFILE for this call."),
  output: z.enum(["json", "human", "yaml"]).optional().describe("Output format. Default: json."),
  help: z.boolean().optional().describe("If true, runs '<cmd> --help' and returns help text."),
  confirm: z.boolean().optional().describe("Required (true) for destructive verbs: delete, terminate, destroy, purge, detach, remove, or --force*."),
};

async function main() {
  const config = parseConfig(process.env);
  const scwVersion = await assertScwVersion(config.binary, config.minVersion);
  process.stderr.write(`[scaleway-mcp] scw ${scwVersion} (profile: ${config.profile ?? "default"}, readonly: ${config.readonly})\n`);

  const server = new McpServer({
    name: "scaleway-mcp",
    version: "0.1.0",
  });

  for (const svc of SERVICES) {
    const description = `Scaleway **${svc.name}** API — ${svc.description}. Resources: ${svc.resources}. Call with help:true to see subcommand syntax.`;

    server.tool(
      `scw_${svc.name.replace(/-/g, "_")}`,
      description,
      toolInputSchema,
      async ({ args, profile, output, help, confirm }) => {
        // Read-only gate (help bypasses)
        if (!help) {
          const ro = checkReadonly(args, config.readonly);
          if (!ro.allowed) {
            return {
              content: [{ type: "text", text: JSON.stringify({ error: ro.reason, command: `scw ${svc.name} ${args.join(" ")}` }, null, 2) }],
              isError: true,
            };
          }
        }

        // Destructive confirm (help bypasses)
        if (!help && isDestructive(args) && confirm !== true) {
          const preview = `scw ${svc.name} ${args.join(" ")}${profile ? ` --profile ${profile}` : config.profile ? ` --profile ${config.profile}` : ""}`;
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Destructive command requires confirm:true",
                resolvedCommand: preview,
                hint: "Re-call the same tool with the identical args plus confirm:true to execute.",
              }, null, 2),
            }],
            isError: true,
          };
        }

        const result = await runScw(
          {
            service: svc.name,
            args,
            profile,
            output: (output ?? "json") as OutputFormat,
            help,
          },
          {
            binary: config.binary,
            profile: config.profile,
            output: "json",
            timeoutMs: config.timeoutMs,
            maxBytes: config.maxBytes,
            maxLines: config.maxLines,
          }
        );

        const payload = {
          command: result.command,
          exitCode: result.exitCode,
          truncated: result.truncated,
          stdout: result.stdout,
          stderr: result.stderr,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          isError: result.exitCode !== 0,
        };
      }
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[scaleway-mcp] ready — ${SERVICES.length} tools registered\n`);
}

main().catch((err) => {
  process.stderr.write(`[scaleway-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Build**

Run:
```bash
npm run build
```
Expected: `dist/` populated, no TS errors.

- [ ] **Step 3: Smoke test — server starts and lists tools**

Run (with a valid profile configured so the version check passes):
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js
```
Expected: stderr shows `[scaleway-mcp] scw X.Y.Z ...` and `ready`. stdout contains a JSON-RPC response with ~39 tools named `scw_<service>`.

If `scw` is not on PATH, startup will fail with the install-URL message — that's correct behavior.

- [ ] **Step 4: Smoke test — read-only tool call**

Run:
```bash
cat <<'EOF' | node dist/index.js
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"scw_account","arguments":{"args":["project","list"]}}}
EOF
```
Expected: response contains `scw account project list --output json --assume-yes` in the `command` field and real stdout from scw (or an auth error if no profile — both prove the dispatch works).

- [ ] **Step 5: Smoke test — destructive confirm gate**

Run:
```bash
cat <<'EOF' | node dist/index.js
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"scw_instance","arguments":{"args":["server","terminate","fake-id"]}}}
EOF
```
Expected: response contains `"error":"Destructive command requires confirm:true"` and `"resolvedCommand"`. No actual scw call made.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat(index): MCP server bootstrap with per-service tool registration"
```

---

## Task 10: README

User-facing install and MCP client config.

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

Create `README.md`:

````markdown
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
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with install, env vars, and Claude Code config example"
```

---

## Self-Review Checklist

Ran inline after writing this plan:

- **Spec coverage:**
  - Tool surface (one tool per service) → Task 7 + Task 9 ✓
  - Tool schema (args/profile/output/help/confirm) → Task 9 ✓
  - Request flow (readonly gate → destructive gate → build → exec → truncate) → Task 9 ✓
  - Modules in spec `src/{safety,truncate,config,version-check,executor,services,index}.ts` → Tasks 2–7, 9 ✓
  - `scripts/refresh-services.ts` → Task 8 ✓
  - Env vars from spec → Task 4 ✓
  - Error handling (non-zero exit, timeout, maxBuffer, missing binary, old version, stdin ignore, caller-wins overrides) → Tasks 5, 6, 9 ✓
  - Packaging (`bin`, `engines`) → Task 1 ✓
  - README with two entries side-by-side → Task 10 ✓
  - Testing (vitest, pure-module unit tests, no mocking beyond `execFile`) → Tasks 2–6 ✓

- **Placeholder scan:** No TBD/TODO/"add error handling" phrasing. Every code step contains the code. ✓

- **Type consistency:**
  - `ExecutorDeps.execFile` returns `{stdout, stderr, exitCode}` in Task 6 test and impl ✓
  - `OutputFormat` used consistently across executor and index ✓
  - `Config` field names match between `parseConfig` (Task 4) and index usage (Task 9): `profile`, `readonly`, `minVersion`, `timeoutMs`, `binary`, `maxBytes`, `maxLines` ✓
  - `SERVICES` shape matches between Task 7 and Task 9 consumption ✓
  - Tool names use underscore conversion (`scw_apple_silicon`, etc.) — Task 9 replaces `-` with `_` ✓
