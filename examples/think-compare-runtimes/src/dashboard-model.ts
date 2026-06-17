import type { ExecutionTarget, RunEvent, RuntimeId } from "../shared/events";
import { deriveRunSummary, type OverallRunStatus, type RuntimeRunStatus } from "./run-state";

type ContainerState = "warm" | "acquired" | "released";
type ValidationStatus = "not-run" | "passed" | "failed";

interface RuntimeDashboardModel {
  id: RuntimeId;
  status: RuntimeRunStatus;
  elapsedLabel: string;
  toolCalls: number;
  fileOps: number;
  execCalls: number;
  dynamicWorkerExecs: number;
  sandboxExecs: number;
  validationStatus: ValidationStatus;
  container: ContainerState;
  error: string | null;
  events: RunEvent[];
}

export interface DashboardModel {
  run: {
    status: OverallRunStatus;
    elapsedLabel: string;
    actionLabel: "START RUN" | "RUN AGAIN";
  };
  runtimes: Record<RuntimeId, RuntimeDashboardModel>;
}

const runtimeIds: RuntimeId[] = ["workspace", "sandbox"];

export function buildDashboardModel(events: RunEvent[], nowIso: string | null): DashboardModel {
  const summary = deriveRunSummary(events);

  return {
    run: {
      status: summary.status,
      elapsedLabel: formatDuration(
        summary.elapsedMs ?? runningElapsedMs(summary.startedAt, summary.completedAt, nowIso),
      ),
      actionLabel: summary.status === "completed" || summary.status === "failed" ? "RUN AGAIN" : "START RUN",
    },
    runtimes: Object.fromEntries(
      runtimeIds.map((runtime) => {
        const runtimeSummary = summary.runtimes[runtime];
        const runtimeEvents = events.filter((event) => event.runtime === runtime || event.runtime === "both");
        const execs = executionTargets(runtimeEvents);

        return [
          runtime,
          {
            id: runtime,
            status: runtimeSummary.status,
            elapsedLabel: formatDuration(
              runtimeSummary.elapsedMs ?? runningElapsedMs(runtimeSummary.startedAt, runtimeSummary.completedAt, nowIso),
            ),
            toolCalls: runtimeEvents.filter(isToolCall).length,
            fileOps: runtimeEvents.filter(isFileToolCall).length,
            execCalls: execs.length,
            dynamicWorkerExecs: execs.filter((target) => target === "dynamic-worker").length,
            sandboxExecs: execs.filter((target) => target === "workspace-sandbox" || target === "raw-sandbox").length,
            validationStatus: validationStatus(runtimeEvents),
            container: containerState(runtimeEvents),
            error: runtimeSummary.error,
            events: runtimeEvents,
          },
        ];
      }),
    ) as Record<RuntimeId, RuntimeDashboardModel>,
  };
}

function formatDuration(elapsedMs: number | null): string {
  if (elapsedMs === null) return "--:--";
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function runningElapsedMs(startedAt: string | null, completedAt: string | null, nowIso: string | null): number | null {
  if (!startedAt || completedAt || !nowIso) return null;
  const elapsed = Date.parse(nowIso) - Date.parse(startedAt);
  return Number.isNaN(elapsed) ? null : Math.max(0, elapsed);
}

function isToolCall(event: RunEvent): boolean {
  return event.kind === "tool_call" || event.kind === "agent_tool_call";
}

function isFileToolCall(event: RunEvent): boolean {
  if (!isToolCall(event)) return false;
  const detail = parseDetail(event.detail);
  const name = detail["name"];
  return name === "read" || name === "write" || name === "edit";
}

function executionTargets(events: RunEvent[]): ExecutionTarget[] {
  return events.flatMap((event) => {
    if (!isToolCall(event)) return [];
    const detail = parseDetail(event.detail);
    const target = detail["executionTarget"];
    return target === "dynamic-worker" || target === "workspace-sandbox" || target === "raw-sandbox" ? [target] : [];
  });
}

function validationStatus(events: RunEvent[]): ValidationStatus {
  const validations = events
    .filter((event) => event.kind === "tool_result" || event.kind === "agent_tool_result")
    .map((event) => parseDetail(event.detail))
    .filter((detail) => detail["validationCommand"] === true || detail["command"] === "npm run check");
  const latest = validations.at(-1);

  if (!latest) return "not-run";
  return latest["exitCode"] === 0 ? "passed" : "failed";
}

function containerState(events: RunEvent[]): ContainerState {
  if (events.some((event) => event.kind === "container_released")) return "released";
  if (events.some((event) => event.kind === "container_acquired")) return "acquired";
  return "warm";
}

function parseDetail(detail: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(detail);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
