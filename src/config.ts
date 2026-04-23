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
    profile: env.SCW_PROFILE?.trim() || undefined,
    readonly: parseBool(env.SCW_MCP_READONLY),
    minVersion: env.SCW_MIN_VERSION || "2.55.0",
    timeoutMs,
    binary: env.SCW_BINARY || "scw",
    maxBytes: 50_000,
    maxLines: 500,
  };
}
