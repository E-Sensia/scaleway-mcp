const DESTRUCTIVE_VERBS = new Set([
  "delete",
  "terminate",
  "destroy",
  "purge",
  "detach",
  "remove",
]);

const READ_VERBS = new Set([
  "list",
  "get",
  "show",
  "describe",
  "wait",
  "version",
  "info",
  "help",
]);

const DESTRUCTIVE_FLAG = /^(--force(-\w+)?|--recursive|-r)$/;

function isPositional(arg: string): boolean {
  return !arg.startsWith("-");
}

export function isDestructive(args: readonly string[]): boolean {
  for (const arg of args) {
    if (isPositional(arg) && DESTRUCTIVE_VERBS.has(arg.toLowerCase())) {
      return true;
    }
    if (!isPositional(arg) && DESTRUCTIVE_FLAG.test(arg)) {
      return true;
    }
  }
  return false;
}

export type ReadonlyCheck = { allowed: true } | { allowed: false; reason: string };

export function checkReadonly(args: readonly string[], readonly: boolean): ReadonlyCheck {
  if (!readonly) return { allowed: true };
  if (isDestructive(args)) {
    return {
      allowed: false,
      reason: "Read-only mode: destructive verb or flag detected. Set SCW_MCP_READONLY=false to enable writes.",
    };
  }
  const hasReadVerb = args.some(
    (a) => isPositional(a) && READ_VERBS.has(a.toLowerCase())
  );
  if (!hasReadVerb) {
    return {
      allowed: false,
      reason: "Read-only mode: no read verb (list|get|show|describe|wait|version|info|help) found in args.",
    };
  }
  return { allowed: true };
}
