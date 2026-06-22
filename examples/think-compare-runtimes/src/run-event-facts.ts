import type { EventRuntime, ExecutionTarget, RunEvent, RuntimeId } from "../shared/events";

export type RuntimeMatchPolicy = "runtimeOnly" | "runtimeOrShared";
type ToolName = "read" | "write" | "edit" | "exec";
type EventPhase = "call" | "result" | "error" | "message" | "lifecycle" | "note";

export interface EventDetailField {
  label: string;
  value: string;
}

export interface RunEventFact {
  event: RunEvent;
  sequence: number;
  runtime: EventRuntime;
  phase: EventPhase;
  tool: ToolName | null;
  path: string | null;
  command: string | null;
  cwd: string | null;
  executionTarget: ExecutionTarget | null;
  exitCode: number | null;
  validationCommand: boolean;
  failed: boolean;
  text: string | null;
  detail: Record<string, unknown> | null;
}

const toolNames = ["read", "write", "edit", "run", "shell"] as const;
const preferredDetailFields = [
  "command",
  "path",
  "cwd",
  "executionTarget",
  "exitCode",
  "stdout",
  "stderr",
  "error",
];

export function factForEvent(event: RunEvent): RunEventFact {
  const detail = parseJsonObject(event.detail);
  const rawTool = toolForEvent(event, detail);
  const command = commandForEvent(rawTool, detail);
  const exitCode = numberField(detail, "exitCode");
  const phase = phaseForEvent(event);

  return {
    event,
    sequence: event.sequence,
    runtime: event.runtime,
    phase,
    tool: normalizeTool(rawTool, command),
    path: stringField(detail, "path"),
    command,
    cwd: stringField(detail, "cwd"),
    executionTarget: executionTargetForEvent(event, rawTool, command, detail),
    exitCode,
    validationCommand: typeof command === "string" && /npm\s+run\s+check/.test(command),
    failed: phase === "error" || (typeof exitCode === "number" && exitCode !== 0),
    text: detail ? null : event.detail,
    detail,
  };
}

export function factsForRuntime(
  events: RunEvent[],
  runtime: RuntimeId,
  policy: RuntimeMatchPolicy,
): RunEventFact[] {
  return events
    .filter((event) => eventMatchesRuntime(event, runtime, policy))
    .sort((left, right) => left.sequence - right.sequence)
    .map(factForEvent);
}

function eventMatchesRuntime(
  event: RunEvent,
  runtime: RuntimeId,
  policy: RuntimeMatchPolicy,
): boolean {
  if (event.runtime === runtime) return true;
  return policy === "runtimeOrShared" && event.runtime === "both";
}

export function detailFieldsForEvent(event: RunEvent): EventDetailField[] {
  const fact = factForEvent(event);
  if (!fact.detail) return [];
  return orderedEntries(fact.detail).map(([label, value]) => ({
    label,
    value: stringifyFieldValue(value),
  }));
}

export function execObservationFacts(facts: RunEventFact[]): RunEventFact[] {
  const callsByKey = new Map<string, RunEventFact[]>();
  const results: RunEventFact[] = [];

  for (const fact of facts) {
    if (fact.tool !== "exec" || !fact.command) continue;
    if (fact.phase === "result" || fact.phase === "error") {
      results.push(fact);
    } else if (fact.phase === "call") {
      const key = execKey(fact);
      const calls = callsByKey.get(key) ?? [];
      calls.push(fact);
      callsByKey.set(key, calls);
    }
  }

  const paired = new Set<string>();
  for (const result of results) {
    paired.add(execKey(result));
  }

  const unpairedCalls = [...callsByKey.entries()].flatMap(([key, calls]) =>
    paired.has(key) ? [] : calls,
  );
  return [...results, ...unpairedCalls].sort((left, right) => left.sequence - right.sequence);
}

export function trimWorkspaceRoot(path: string): string {
  return path.replace(/^\/workspace\//, "").replace(/^\//, "");
}

function phaseForEvent(event: RunEvent): EventPhase {
  if (event.kind === "agent_message") return "message";
  if (event.kind.endsWith("_call")) return "call";
  if (event.kind.endsWith("_result")) return "result";
  if (event.kind.endsWith("_error") || event.kind === "runtime_failed" || event.kind === "run_failed") {
    return "error";
  }
  if (event.kind.startsWith("run_") || event.kind.startsWith("runtime_")) return "lifecycle";
  return "note";
}

function toolForEvent(
  event: RunEvent,
  detail: Record<string, unknown> | null,
): (typeof toolNames)[number] | null {
  const fromName = stringField(detail, "name");
  if (isRawToolName(fromName)) return fromName;

  const fromTool = stringField(detail, "tool");
  if (isRawToolName(fromTool)) return fromTool;

  const title = event.title.toLowerCase();
  return toolNames.find((name) => title.includes(name)) ?? null;
}

function normalizeTool(tool: ReturnType<typeof toolForEvent>, command: string | null): ToolName | null {
  if (tool === "read" || tool === "write" || tool === "edit") return tool;
  if (tool === "run" || tool === "shell" || command) return "exec";
  return null;
}

function commandForEvent(
  tool: ReturnType<typeof toolForEvent>,
  detail: Record<string, unknown> | null,
): string | null {
  const command = stringField(detail, "command");
  if (command) return command;
  if (tool === "run" || stringField(detail, "executionTarget") === "dynamic-worker") {
    return "Dynamic Worker module";
  }
  if (tool === "shell" || stringField(detail, "executionTarget") === "workspace-sandbox" || stringField(detail, "executionTarget") === "raw-sandbox") {
    return "Shell command";
  }
  return null;
}

function executionTargetForEvent(
  event: RunEvent,
  tool: ReturnType<typeof toolForEvent>,
  command: string | null,
  detail: Record<string, unknown> | null,
): ExecutionTarget | null {
  const target = stringField(detail, "executionTarget");
  if (isExecutionTarget(target)) return target;

  if (event.runtime === "workspace" && tool === "run") return "dynamic-worker";
  if (event.runtime === "workspace" && (tool === "shell" || command)) return "workspace-sandbox";
  if (event.runtime === "sandbox" && (tool === "shell" || command)) return "raw-sandbox";
  if (event.kind === "container_acquired" || event.kind === "container_released") {
    if (event.runtime === "workspace") return "workspace-sandbox";
    if (event.runtime === "sandbox") return "raw-sandbox";
  }
  return null;
}

function execKey(fact: RunEventFact): string {
  return `${fact.executionTarget ?? "unknown"}:${fact.command ?? fact.sequence}`;
}

function parseJsonObject(detail: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(detail) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function orderedEntries(value: Record<string, unknown>): [string, unknown][] {
  const preferred = preferredDetailFields
    .filter((field) => Object.hasOwn(value, field))
    .map((field): [string, unknown] => [field, value[field]]);
  const rest = Object.entries(value).filter(([field]) => !preferredDetailFields.includes(field));
  return [...preferred, ...rest];
}

function stringField(value: Record<string, unknown> | null, key: string): string | null {
  const field = value?.[key];
  return typeof field === "string" ? field : null;
}

function numberField(value: Record<string, unknown> | null, key: string): number | null {
  const field = value?.[key];
  return typeof field === "number" ? field : null;
}

function stringifyFieldValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function isRawToolName(value: string | null): value is (typeof toolNames)[number] {
  return value !== null && toolNames.includes(value as (typeof toolNames)[number]);
}

function isExecutionTarget(value: string | null): value is ExecutionTarget {
  return value === "dynamic-worker" || value === "workspace-sandbox" || value === "raw-sandbox";
}
