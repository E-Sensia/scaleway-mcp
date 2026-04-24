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
