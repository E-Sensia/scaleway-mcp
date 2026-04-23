import { execFile } from "node:child_process";
import { isDestructive } from "./safety.js";
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

  const hasProfile = out.some((a) => a === "-p" || a === "--profile" || a.startsWith("--profile="));
  if (!hasProfile && input.profile) {
    out.push("--profile", input.profile);
  }

  const hasOutput = out.some((a) => a === "-o" || a === "--output" || a.startsWith("--output="));
  if (!hasOutput) {
    out.push("--output", input.output);
  }

  // scw only accepts --assume-yes on destructive subcommands; injecting it on reads errors.
  if (isDestructive(input.userArgs)) {
    const hasAssume = out.some((a) => a === "-y" || a === "--assume-yes");
    if (!hasAssume) {
      out.push("--assume-yes");
    }
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
            const errAny = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
            let exitCode: number;
            let stderrOut: string;
            if (errAny.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
              exitCode = 1;
              stderrOut = "output too large, narrow the query (maxBuffer exceeded)";
            } else if (errAny.killed === true) {
              exitCode = 1;
              stderrOut = `timeout after ${opts.timeoutMs}ms`;
            } else if (typeof errAny.code === "number") {
              exitCode = errAny.code;
              stderrOut = String(stderr ?? err.message);
            } else {
              exitCode = 1;
              stderrOut = String(stderr ?? err.message);
            }
            resolve({ stdout: String(stdout ?? ""), stderr: stderrOut, exitCode });
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
  // help: true bypasses flag injection — scw's help output does not depend on profile/output flags.
  const finalArgs = input.help
    ? [input.service, ...input.args, "--help"]
    : buildArgs({
        service: input.service,
        userArgs: input.args,
        profile: input.profile ?? env.profile,
        output: input.output ?? env.output,
      });

  const command = `${env.binary} ${finalArgs.join(" ")}`;

  // maxBuffer is a hard subprocess capture limit (prevents Node OOM on huge stdout);
  // maxBytes/maxLines are the truncation thresholds applied to the captured output
  // before we return it to the MCP client. Deliberately separate.
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
