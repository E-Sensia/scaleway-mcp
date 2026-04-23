import { describe, expect, it } from "vitest";
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

  it("detects equals-form --output= and --profile= overrides", () => {
    const outOutput = buildArgs({
      service: "instance",
      userArgs: ["server", "list", "--output=yaml"],
      profile: undefined,
      output: "json",
    });
    expect(outOutput.filter((a) => a === "--output" || a.startsWith("--output=")).length).toBe(1);
    expect(outOutput).toContain("--output=yaml");
    expect(outOutput).not.toContain("json"); // our "json" default must not have been injected as a separate value

    const outProfile = buildArgs({
      service: "instance",
      userArgs: ["server", "list", "--profile=override"],
      profile: "default",
      output: "json",
    });
    expect(outProfile.filter((a) => a === "--profile" || a.startsWith("--profile=")).length).toBe(1);
    expect(outProfile).toContain("--profile=override");
    expect(outProfile).not.toContain("default");
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

  it("per-call profile overrides env.profile", async () => {
    const calls: string[][] = [];
    const d = deps(async (_bin, args) => {
      calls.push([...args]);
      return { stdout: "", stderr: "" };
    });
    await runScw(
      { service: "instance", args: ["server", "list"], profile: "per-call" },
      {
        binary: "scw",
        profile: "env-default",
        output: "json",
        timeoutMs: 60000,
        maxBytes: 50000,
        maxLines: 500,
      },
      d
    );
    const args = calls[0]!;
    const idx = args.indexOf("--profile");
    expect(args[idx + 1]).toBe("per-call");
  });
});
