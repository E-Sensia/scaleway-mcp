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
    expect(new TextDecoder().decode(new TextEncoder().encode(firstLine))).toBe(firstLine);
    expect(firstLine).not.toContain("�");
  });

  it("does not treat trailing newline as an extra line", () => {
    const input = "line1\nline2\nline3\n";
    const out = truncateOutput(input, { maxBytes: 1000, maxLines: 3 });
    expect(out).toEqual({ text: input, truncated: false });
  });

  it("line count boundary is strict — exactly maxLines is not truncated", () => {
    const input = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n");
    const out = truncateOutput(input, { maxBytes: 10000, maxLines: 10 });
    expect(out.truncated).toBe(false);
  });

  it("byte count boundary is strict — exactly maxBytes is not truncated", () => {
    const input = "x".repeat(100);
    const out = truncateOutput(input, { maxBytes: 100, maxLines: 100 });
    expect(out.truncated).toBe(false);
  });

  it("handles empty input without throwing", () => {
    const out = truncateOutput("", { maxBytes: 100, maxLines: 100 });
    expect(out).toEqual({ text: "", truncated: false });
  });

  it("handles maxBytes: 0 by returning empty text", () => {
    const out = truncateOutput("anything", { maxBytes: 0, maxLines: 100 });
    expect(out.truncated).toBe(true);
    expect(out.text.startsWith("")).toBe(true);
    // Hint is appended, so the full text starts with the hint (no content before it)
    expect(out.text).toMatch(/^\n\n--- output truncated/);
  });
});
