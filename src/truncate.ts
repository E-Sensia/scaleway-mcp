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

  const lines = text.split("\n");
  // A trailing newline produces a final empty element that shouldn't count toward the line limit.
  const effectiveLines = lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
  if (effectiveLines > opts.maxLines) {
    text = lines.slice(0, opts.maxLines).join("\n");
    truncated = true;
  }

  const bytes = new TextEncoder().encode(text);
  if (bytes.length > opts.maxBytes) {
    let cut = opts.maxBytes;
    // cut === 0 decodes cleanly to "" in fatal mode — so include 0 in the walk-back range.
    while (cut >= 0) {
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
