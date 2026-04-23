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
