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

  it("throws on zero timeout", () => {
    expect(() => parseConfig({ SCW_TIMEOUT_MS: "0" })).toThrow(/SCW_TIMEOUT_MS/);
  });

  it("throws on negative timeout", () => {
    expect(() => parseConfig({ SCW_TIMEOUT_MS: "-1" })).toThrow(/SCW_TIMEOUT_MS/);
  });

  it("throws on Infinity timeout", () => {
    expect(() => parseConfig({ SCW_TIMEOUT_MS: "Infinity" })).toThrow(/SCW_TIMEOUT_MS/);
  });

  it("returns undefined profile when SCW_PROFILE is whitespace-only", () => {
    expect(parseConfig({ SCW_PROFILE: "   " }).profile).toBeUndefined();
  });

  it("returns undefined profile when SCW_PROFILE is empty", () => {
    expect(parseConfig({ SCW_PROFILE: "" }).profile).toBeUndefined();
  });
});
