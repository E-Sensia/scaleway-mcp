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
