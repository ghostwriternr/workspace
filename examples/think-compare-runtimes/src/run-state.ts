import type { RunEvent, RuntimeId } from "../shared/events";

export type OverallRunStatus = "idle" | "running" | "completed" | "failed";
export type RuntimeRunStatus = "idle" | "running" | "completed" | "failed";

interface RuntimeSummary {
  status: RuntimeRunStatus;
  startedAt: string | null;
  completedAt: string | null;
  elapsedMs: number | null;
  error: string | null;
}

export interface RunSummary {
  status: OverallRunStatus;
  startedAt: string | null;
  completedAt: string | null;
  elapsedMs: number | null;
  runtimes: Record<RuntimeId, RuntimeSummary>;
}

const runtimeIds: RuntimeId[] = ["workspace", "sandbox"];

export function deriveRunSummary(events: RunEvent[]): RunSummary {
  const startedAt = firstTimestamp(events, "run_started");
  const completedAt = firstTimestamp(events, "run_completed") ?? firstTimestamp(events, "run_failed");
  const runFailed = events.some((event) => event.kind === "run_failed");

  const runtimes = Object.fromEntries(
    runtimeIds.map((runtime) => [runtime, deriveRuntimeSummary(events, runtime)]),
  ) as Record<RuntimeId, RuntimeSummary>;

  return {
    status: !startedAt ? "idle" : completedAt ? (runFailed ? "failed" : "completed") : "running",
    startedAt,
    completedAt,
    elapsedMs: elapsedMs(startedAt, completedAt),
    runtimes,
  };
}

function deriveRuntimeSummary(events: RunEvent[], runtime: RuntimeId): RuntimeSummary {
  const runtimeEvents = events.filter((event) => event.runtime === runtime || event.runtime === "both");
  const startedAt = firstTimestamp(runtimeEvents, "runtime_started");
  const completedAt = firstTimestamp(runtimeEvents, "runtime_completed") ?? firstTimestamp(runtimeEvents, "runtime_failed");
  const failed = runtimeEvents.find((event) => event.runtime === runtime && event.kind === "runtime_failed");

  return {
    status: !startedAt ? "idle" : completedAt ? (failed ? "failed" : "completed") : "running",
    startedAt,
    completedAt,
    elapsedMs: elapsedMs(startedAt, completedAt),
    error: failed?.detail ?? null,
  };
}

function firstTimestamp(events: RunEvent[], kind: RunEvent["kind"]): string | null {
  return events.find((event) => event.kind === kind)?.timestamp ?? null;
}

function elapsedMs(startedAt: string | null, completedAt: string | null): number | null {
  if (!startedAt || !completedAt) return null;
  const elapsed = Date.parse(completedAt) - Date.parse(startedAt);
  return Number.isNaN(elapsed) ? null : Math.max(0, elapsed);
}
