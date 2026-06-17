import type { EventRuntime, RunEvent, RunEventKind, RuntimeId } from "../shared/events";
import { compareFixture } from "../shared/fixture";

export interface ComparisonRun {
  id: string;
  events: RunEvent[];
}

export interface StartComparisonRunOptions {
  now?: () => string;
}

export async function startComparisonRun(options: StartComparisonRunOptions = {}): Promise<ComparisonRun> {
  const now = options.now ?? (() => new Date().toISOString());
  const runId = `compare-${crypto.randomUUID()}`;
  const recorder = new RunEventRecorder(runId, now);

  recorder.record("both", "run_started", "Run started", compareFixture.task.title);
  await recordWorkspaceWing(recorder);
  await recordSandboxWing(recorder);
  recorder.record("both", "run_completed", "Run completed", "Both runtime wings reached terminal state.");

  return { id: runId, events: recorder.events };
}

async function recordWorkspaceWing(recorder: RunEventRecorder): Promise<void> {
  recorder.record("workspace", "runtime_started", "Workspace-backed runtime", "Opened Workspace and prepared durable edit surface.");
  recorder.record("workspace", "container_acquired", "Workspace Sandbox acquired", "Warm Sandbox lease ready for shell execution.");
  recorder.record(
    "workspace",
    "tool_call",
    "run",
    JSON.stringify({ name: "run", executionTarget: "dynamic-worker", code: "Inspect fixture files" }),
  );
  recorder.record(
    "workspace",
    "tool_result",
    "run result",
    JSON.stringify({ executionTarget: "dynamic-worker", summary: "Fixture inspected" }),
  );
  recorder.record(
    "workspace",
    "tool_call",
    "shell",
    JSON.stringify({ name: "shell", executionTarget: "workspace-sandbox", command: "npm run check" }),
  );
  recorder.record(
    "workspace",
    "tool_result",
    "shell result",
    JSON.stringify({ executionTarget: "workspace-sandbox", command: "npm run check", exitCode: 0, validationCommand: true }),
  );
  recorder.record("workspace", "runtime_completed", "Workspace result ready", "Durable Workspace result is ready for review.");
}

async function recordSandboxWing(recorder: RunEventRecorder): Promise<void> {
  recorder.record("sandbox", "runtime_started", "Raw Sandbox runtime", "Warm Sandbox filesystem seeded with the fixture.");
  recorder.record("sandbox", "container_acquired", "Raw Sandbox acquired", "Warm Sandbox lease ready for shell execution.");
  recorder.record(
    "sandbox",
    "tool_call",
    "shell",
    JSON.stringify({ name: "shell", executionTarget: "raw-sandbox", command: "npm run check" }),
  );
  recorder.record(
    "sandbox",
    "tool_result",
    "shell result",
    JSON.stringify({ executionTarget: "raw-sandbox", command: "npm run check", exitCode: 0, validationCommand: true }),
  );
  recorder.record("sandbox", "runtime_completed", "Raw Sandbox result ready", "Runtime-local Sandbox result is ready for review.");
}

class RunEventRecorder {
  readonly events: RunEvent[] = [];

  constructor(
    private readonly runId: string,
    private readonly now: () => string,
  ) {}

  record(runtime: EventRuntime, kind: RunEventKind, title: string, detail: string): void {
    const sequence = this.events.length;
    this.events.push({
      id: `${this.runId}:${sequence}`,
      runId: this.runId,
      sequence,
      runtime,
      kind,
      title,
      detail,
      timestamp: this.now(),
    });
  }
}
