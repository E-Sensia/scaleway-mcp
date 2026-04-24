#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const BINARY = process.env.SCW_BINARY ?? "scw";

type Service = { name: string; description: string; resources: string };

function listTopLevelCommands(): string[] {
  const out = execFileSync(BINARY, ["--list-sub-commands"], { encoding: "utf8" });
  const tops = new Set<string>();
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // each line is a full path; take the first token
    const first = trimmed.split(/\s+/)[0];
    if (first) tops.add(first);
  }
  // drop configuration/utility commands
  for (const drop of ["config", "init", "login", "autocomplete", "feedback", "shell", "help", "version", "alias", "info"]) {
    tops.delete(drop);
  }
  return Array.from(tops).sort();
}

function describe(service: string): { description: string; resources: string } {
  const help = execFileSync(BINARY, [service, "--help"], { encoding: "utf8" });
  const lines = help.split("\n");

  // description: take the first non-empty line that isn't "USAGE:" or similar
  let description = "";
  for (const l of lines) {
    const t = l.trim();
    if (!t) continue;
    if (/^(USAGE|AVAILABLE|FLAGS|EXAMPLES|GLOBAL)/i.test(t)) continue;
    description = t.replace(/\.$/, "");
    break;
  }

  // resources: parse the "AVAILABLE COMMANDS:" block
  const resources: string[] = [];
  let inBlock = false;
  for (const l of lines) {
    if (/^AVAILABLE COMMANDS:/i.test(l.trim())) { inBlock = true; continue; }
    if (inBlock) {
      if (!l.trim()) break;
      const m = l.match(/^\s+(\S+)\s/);
      if (m) resources.push(m[1]!);
    }
  }
  return { description: description || `Scaleway ${service}`, resources: resources.join(", ") };
}

function main() {
  const services: Service[] = [];
  for (const name of listTopLevelCommands()) {
    try {
      const { description, resources } = describe(name);
      services.push({ name, description, resources });
      console.error(`✓ ${name} (${resources.split(",").length} resources)`);
    } catch (err) {
      console.error(`✗ ${name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const body = `export type ServiceMeta = {
  name: string;
  description: string;
  resources: string;
};

export const SERVICES: ServiceMeta[] = ${JSON.stringify(services, null, 2)};
`;
  writeFileSync("src/services.ts", body);
  console.error(`\nWrote ${services.length} services to src/services.ts`);
}

main();
