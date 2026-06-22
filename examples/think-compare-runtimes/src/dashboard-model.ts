import type { ExecutionTarget, RunEvent, RuntimeId } from "../shared/events";
import { execObservationFacts, factsForRuntime, type RunEventFact } from "./run-event-facts";
import { deriveRunSummary, type OverallRunStatus, type RuntimeRunStatus } from "./run-state";

type ContainerState = "warm" | "acquired" | "released";
type ValidationStatus = "not-run" | "passed" | "failed";

export interface RuntimeDashboardModel {
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
        const facts = factsForRuntime(events, runtime, "runtimeOnly");
        const execs = execObservationFacts(facts);
        const dynamicWorkerExecs = execs.filter(
          (fact) => fact.executionTarget === "dynamic-worker",
        ).length;
        const sandboxExecs = execs.filter((fact) => isSandboxTarget(fact.executionTarget)).length;

        return [
          runtime,
          {
            id: runtime,
            status: runtimeSummary.status,
            elapsedLabel: formatDuration(
              runtimeSummary.elapsedMs ??
                runningElapsedMs(runtimeSummary.startedAt, runtimeSummary.completedAt, nowIso),
            ),
            toolCalls: facts.filter((fact) => fact.phase === "call" && fact.tool !== null).length,
            fileOps: facts.filter(isFileCall).length,
            execCalls: execs.length,
            dynamicWorkerExecs,
            sandboxExecs,
            validationStatus: validationStatus(facts),
            container: containerState(facts),
            error: runtimeSummary.error,
            events: facts.map((fact) => fact.event),
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

function runningElapsedMs(
  startedAt: string | null,
  completedAt: string | null,
  nowIso: string | null,
): number | null {
  if (!startedAt || completedAt || !nowIso) return null;
  const elapsed = Date.parse(nowIso) - Date.parse(startedAt);
  return Number.isNaN(elapsed) ? null : Math.max(0, elapsed);
}

function isFileCall(fact: RunEventFact): boolean {
  return fact.phase === "call" && (fact.tool === "read" || fact.tool === "write" || fact.tool === "edit");
}

function validationStatus(facts: RunEventFact[]): ValidationStatus {
  const latestValidation = execObservationFacts(facts)
    .filter((fact) => fact.validationCommand)
    .at(-1);
  if (!latestValidation) return "not-run";
  return latestValidation.failed ? "failed" : "passed";
}

function containerState(facts: RunEventFact[]): ContainerState {
  const events = facts.map((fact) => fact.event);
  if (events.some((event) => event.kind === "container_released")) return "released";
  if (events.some((event) => event.kind === "container_acquired")) return "acquired";
  return "warm";
}

function isSandboxTarget(target: ExecutionTarget | null): boolean {
  return target === "workspace-sandbox" || target === "raw-sandbox";
}
