#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { parseConfig } from "./config.js";
import { assertScwVersion } from "./version-check.js";
import { SERVICES } from "./services.js";
import { checkReadonly, isDestructive } from "./safety.js";
import { runScw, type OutputFormat } from "./executor.js";

const toolInputSchema = {
  args: z
    .array(z.string())
    .describe("CLI args after 'scw <service>'. Example: [\"server\", \"list\", \"--zone\", \"fr-par-1\"]."),
  profile: z.string().optional().describe("Override SCW_PROFILE for this call."),
  output: z.enum(["json", "human", "yaml"]).optional().describe("Output format. Default: json."),
  help: z.boolean().optional().describe("If true, runs '<cmd> --help' and returns help text."),
  confirm: z.boolean().optional().describe("Required (true) for destructive verbs (delete, terminate, destroy, purge, detach, remove) or destructive flags (--force*, --recursive, -r)."),
};

async function main() {
  const config = parseConfig(process.env);
  const scwVersion = await assertScwVersion(config.binary, config.minVersion);
  process.stderr.write(`[scaleway-mcp] scw ${scwVersion} (profile: ${config.profile ?? "default"}, readonly: ${config.readonly})\n`);

  const server = new McpServer({
    name: "scaleway-mcp",
    version: "0.1.0",
  });

  for (const svc of SERVICES) {
    const description = `Scaleway **${svc.name}** API — ${svc.description}. Resources: ${svc.resources}. Call with help:true to see subcommand syntax.`;

    server.tool(
      `scw_${svc.name.replace(/-/g, "_")}`,
      description,
      toolInputSchema,
      async ({ args, profile, output, help, confirm }) => {
        try {
          // Read-only gate (help bypasses)
          if (!help) {
            const ro = checkReadonly(args, config.readonly);
            if (!ro.allowed) {
              return {
                content: [{ type: "text", text: JSON.stringify({ error: ro.reason, command: `scw ${svc.name} ${args.join(" ")}` }, null, 2) }],
                isError: true,
              };
            }
          }

          // Destructive confirm (help bypasses)
          if (!help && isDestructive(args) && confirm !== true) {
            const preview = `scw ${svc.name} ${args.join(" ")}${profile ? ` --profile ${profile}` : config.profile ? ` --profile ${config.profile}` : ""}`;
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  error: "Destructive command requires confirm:true",
                  resolvedCommand: preview,
                  hint: "Re-call the same tool with the identical args plus confirm:true to execute.",
                }, null, 2),
              }],
              isError: true,
            };
          }

          // env.output is a RunEnv-required fallback but input.output always resolves first in this bootstrap
          const result = await runScw(
            {
              service: svc.name,
              args,
              profile,
              output: output ?? "json",
              help,
            },
            {
              binary: config.binary,
              profile: config.profile,
              output: "json",
              timeoutMs: config.timeoutMs,
              maxBytes: config.maxBytes,
              maxLines: config.maxLines,
            }
          );

          const payload = {
            command: result.command,
            exitCode: result.exitCode,
            truncated: result.truncated,
            stdout: result.stdout,
            stderr: result.stderr,
          };
          return {
            content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
            isError: false,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "unexpected error", detail: msg }, null, 2) }],
            isError: true,
          };
        }
      }
    );
  }

  process.stdin.resume();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[scaleway-mcp] ready — ${SERVICES.length} tools registered\n`);
  // Keep the event loop alive until the MCP client disconnects.
  // On Windows, npx closes its stdin handle before the child starts, so we
  // cannot rely on stdin staying open. Instead we park on a timer that the
  // transport's onclose handler clears when the session ends.
  await new Promise<void>((resolve) => {
    const keepAlive = setInterval(() => {}, 10_000);
    transport.onclose = () => { clearInterval(keepAlive); resolve(); };
  });
}

main().catch((err) => {
  process.stderr.write(`[scaleway-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
