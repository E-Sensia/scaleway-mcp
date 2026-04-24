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
