import type { RunEvent } from "../shared/events";
import { compareFixture } from "../shared/fixture";

export interface ComparisonRun {
  id: string;
  events: RunEvent[];
}

export interface WorkspaceRunRuntime {
  seedFixture(): Promise<void>;
  read(input: { path: string }): Promise<string>;
  write(input: { path: string; contents: string }): Promise<{ path: string }>;
  edit(input: { path: string; oldText: string; newText: string }): Promise<{ path: string; replacements: number }>;
  run(input: { code: string }): Promise<unknown>;
  shell(input: { command: string }): Promise<unknown>;
}

export interface SandboxRunRuntime {
  seedFixture(): Promise<void>;
  read(input: { path: string }): Promise<string>;
  write(input: { path: string; contents: string }): Promise<{ path: string }>;
  edit(input: { path: string; oldText: string; newText: string }): Promise<{ path: string; replacements: number }>;
  shell(input: { command: string }): Promise<unknown>;
}

interface SandboxLease {
  id: string;
}

export type RunEventInput = Omit<RunEvent, "id" | "runId" | "sequence" | "timestamp">;

export interface RuntimeTurnRecorder {
  readonly events: RunEvent[];
  readonly runId: string;
  record(input: RunEventInput): RunEvent | Promise<RunEvent>;
}

interface WorkspaceRuntimeTurnInput {
  runId: string;
  lease: SandboxLease;
  runtime?: WorkspaceRunRuntime;
  recorder: RuntimeTurnRecorder;
}

interface SandboxRuntimeTurnInput {
  runId: string;
  lease: SandboxLease;
  runtime?: SandboxRunRuntime;
  recorder: RuntimeTurnRecorder;
}

interface RunSandboxPool {
  lease(): Promise<SandboxLease>;
  release(lease: SandboxLease): Promise<void>;
}

export interface StartComparisonRunOptions {
  now?: () => string;
  createWorkspaceRuntime?: (lease: SandboxLease) => WorkspaceRunRuntime | Promise<WorkspaceRunRuntime>;
  createSandboxRuntime?: (lease: SandboxLease) => SandboxRunRuntime | Promise<SandboxRunRuntime>;
  runWorkspaceTurn?: (input: WorkspaceRuntimeTurnInput) => Promise<void>;
  runSandboxTurn?: (input: SandboxRuntimeTurnInput) => Promise<void>;
  workspaceSandboxPool?: RunSandboxPool;
  rawSandboxPool?: RunSandboxPool;
}

export async function startComparisonRun(options: StartComparisonRunOptions = {}): Promise<ComparisonRun> {
  const now = options.now ?? (() => new Date().toISOString());
  const runId = `compare-${crypto.randomUUID()}`;
  const recorder = new RunEventRecorder(runId, now);

  await runComparison({ runId, recorder, options });

  return { id: runId, events: recorder.events };
}

export async function runComparison(input: {
  runId: string;
  recorder: RuntimeTurnRecorder;
  options?: StartComparisonRunOptions;
  skipRunStarted?: boolean;
}): Promise<void> {
  const options = input.options ?? {};
  const recorder = input.recorder;

  if (!input.skipRunStarted) {
    await recorder.record({ runtime: "both", kind: "run_started", title: "Run started", detail: compareFixture.task.title });
  }
  await recordWorkspaceWing(recorder, {
    createRuntime: options.createWorkspaceRuntime ?? (options.runWorkspaceTurn ? undefined : () => defaultWorkspaceRuntime),
    runTurn: options.runWorkspaceTurn ?? runScriptedWorkspaceTurn,
    pool: options.workspaceSandboxPool ?? defaultPool("workspace-default"),
  });
  await recordSandboxWing(recorder, {
    createRuntime: options.createSandboxRuntime ?? (options.runSandboxTurn ? undefined : () => defaultSandboxRuntime),
    runTurn: options.runSandboxTurn ?? runScriptedSandboxTurn,
    pool: options.rawSandboxPool ?? defaultPool("sandbox-default"),
  });
  await recorder.record({ runtime: "both", kind: "run_completed", title: "Run completed", detail: "Both runtime wings reached terminal state." });
}

async function recordWorkspaceWing(
  recorder: RuntimeTurnRecorder,
  input: {
    createRuntime?: (lease: SandboxLease) => WorkspaceRunRuntime | Promise<WorkspaceRunRuntime>;
    runTurn: (input: WorkspaceRuntimeTurnInput) => Promise<void>;
    pool: RunSandboxPool;
  },
): Promise<void> {
  await recorder.record({ runtime: "workspace", kind: "runtime_started", title: "Workspace-backed runtime", detail: "Opened Workspace and prepared durable edit surface." });
  const lease = await input.pool.lease();
  await recorder.record({ runtime: "workspace", kind: "container_acquired", title: "Workspace Sandbox acquired", detail: JSON.stringify({ sandboxId: lease.id }) });
  const runtime = input.createRuntime ? await input.createRuntime(lease) : undefined;

  try {
    const firstTurnEvent = recorder.events.length;
    await input.runTurn({ runId: recorder.runId, lease, runtime, recorder });
    if (!hasRuntimeFailure(recorder.events.slice(firstTurnEvent))) {
      await recorder.record({ runtime: "workspace", kind: "runtime_completed", title: "Workspace result ready", detail: "Durable Workspace result is ready for review." });
    }
  } catch (error) {
    await recorder.record({ runtime: "workspace", kind: "runtime_failed", title: "Workspace runtime failed", detail: errorMessage(error) });
  } finally {
    await input.pool.release(lease);
    await recorder.record({ runtime: "workspace", kind: "container_released", title: "Workspace Sandbox released", detail: JSON.stringify({ sandboxId: lease.id }) });
  }
}

async function recordSandboxWing(
  recorder: RuntimeTurnRecorder,
  input: {
    createRuntime?: (lease: SandboxLease) => SandboxRunRuntime | Promise<SandboxRunRuntime>;
    runTurn: (input: SandboxRuntimeTurnInput) => Promise<void>;
    pool: RunSandboxPool;
  },
): Promise<void> {
  await recorder.record({ runtime: "sandbox", kind: "runtime_started", title: "Raw Sandbox runtime", detail: "Warm Sandbox filesystem seeded with the fixture." });
  const lease = await input.pool.lease();
  await recorder.record({ runtime: "sandbox", kind: "container_acquired", title: "Raw Sandbox acquired", detail: JSON.stringify({ sandboxId: lease.id }) });
  const runtime = input.createRuntime ? await input.createRuntime(lease) : undefined;

  try {
    const firstTurnEvent = recorder.events.length;
    await input.runTurn({ runId: recorder.runId, lease, runtime, recorder });
    if (!hasRuntimeFailure(recorder.events.slice(firstTurnEvent))) {
      await recorder.record({ runtime: "sandbox", kind: "runtime_completed", title: "Raw Sandbox result ready", detail: "Runtime-local Sandbox result is ready for review." });
    }
  } catch (error) {
    await recorder.record({ runtime: "sandbox", kind: "runtime_failed", title: "Raw Sandbox runtime failed", detail: errorMessage(error) });
  } finally {
    await input.pool.release(lease);
    await recorder.record({ runtime: "sandbox", kind: "container_released", title: "Raw Sandbox released", detail: JSON.stringify({ sandboxId: lease.id }) });
  }
}

async function runScriptedWorkspaceTurn({ runtime, recorder }: WorkspaceRuntimeTurnInput): Promise<void> {
  if (!runtime) throw new Error("Workspace runtime was not created.");
  await runtime.seedFixture();
  await recorder.record({ runtime: "workspace", kind: "runtime_note", title: "Fixture seeded", detail: "Fixture written to Workspace current files and working copy." });
  await recorder.record({
    runtime: "workspace",
    kind: "tool_call",
    title: "run",
    detail: JSON.stringify({ name: "run", executionTarget: "dynamic-worker", code: inspectFixtureModule }),
  });
  await recorder.record({
    runtime: "workspace",
    kind: "tool_result",
    title: "run result",
    detail: JSON.stringify(await runtime.run({ code: inspectFixtureModule })),
  });
  await recorder.record({
    runtime: "workspace",
    kind: "tool_call",
    title: "shell",
    detail: JSON.stringify({ name: "shell", executionTarget: "workspace-sandbox", command: "npm run check" }),
  });
  await recorder.record({
    runtime: "workspace",
    kind: "tool_result",
    title: "shell result",
    detail: JSON.stringify(await runtime.shell({ command: "npm run check" })),
  });
}

async function runScriptedSandboxTurn({ runtime, recorder }: SandboxRuntimeTurnInput): Promise<void> {
  if (!runtime) throw new Error("Sandbox runtime was not created.");
  await runtime.seedFixture();
  await recorder.record({ runtime: "sandbox", kind: "runtime_note", title: "Fixture seeded", detail: "Fixture written directly into the Sandbox filesystem." });
  await recorder.record({
    runtime: "sandbox",
    kind: "tool_call",
    title: "shell",
    detail: JSON.stringify({ name: "shell", executionTarget: "raw-sandbox", command: "npm run check" }),
  });
  await recorder.record({
    runtime: "sandbox",
    kind: "tool_result",
    title: "shell result",
    detail: JSON.stringify(await runtime.shell({ command: "npm run check" })),
  });
}

const inspectFixtureModule = `
export default async function ({ WORKSPACE }) {
  const root = await WORKSPACE.list("/");
  if (root.status === "error") return root;
  const readme = await WORKSPACE.readFile("/README.md");
  if (readme.status === "error") return readme;
  return {
    rootEntries: root.value.map((entry) => entry.name),
    readmeBytes: readme.value.byteLength,
  };
}
`;

const defaultWorkspaceRuntime: WorkspaceRunRuntime = {
  async seedFixture() {},
  async read() {
    return "";
  },
  async write(input) {
    return { path: input.path };
  },
  async edit(input) {
    return { path: input.path, replacements: 1 };
  },
  async run() {
    return { executionTarget: "dynamic-worker", summary: "Fixture inspected" };
  },
  async shell(input) {
    return { executionTarget: "workspace-sandbox", command: input.command, exitCode: 0, validationCommand: true };
  },
};

const defaultSandboxRuntime: SandboxRunRuntime = {
  async seedFixture() {},
  async read() {
    return "";
  },
  async write(input) {
    return { path: input.path };
  },
  async edit(input) {
    return { path: input.path, replacements: 1 };
  },
  async shell(input) {
    return { executionTarget: "raw-sandbox", command: input.command, exitCode: 0, validationCommand: true };
  },
};

function hasRuntimeFailure(events: RunEvent[]): boolean {
  return events.some((event) => event.kind === "runtime_failed");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultPool(id: string): RunSandboxPool {
  return {
    async lease() {
      return { id };
    },
    async release() {},
  };
}

class RunEventRecorder implements RuntimeTurnRecorder {
  readonly events: RunEvent[] = [];

  constructor(
    readonly runId: string,
    private readonly now: () => string,
  ) {}

  record(input: RunEventInput): RunEvent {
    const sequence = this.events.length;
    const event = {
      id: `${this.runId}:${sequence}`,
      runId: this.runId,
      sequence,
      runtime: input.runtime,
      kind: input.kind,
      title: input.title,
      detail: input.detail,
      timestamp: this.now(),
    };
    this.events.push(event);
    return event;
  }
}
