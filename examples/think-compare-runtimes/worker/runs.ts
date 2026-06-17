import type { EventRuntime, RunEvent, RunEventKind } from "../shared/events";
import { compareFixture } from "../shared/fixture";

export interface ComparisonRun {
  id: string;
  events: RunEvent[];
}

interface WorkspaceRunRuntime {
  seedFixture(): Promise<void>;
  read(input: { path: string }): Promise<string>;
  write(input: { path: string; contents: string }): Promise<{ path: string }>;
  edit(input: { path: string; oldText: string; newText: string }): Promise<{ path: string; replacements: number }>;
  run(input: { code: string }): Promise<unknown>;
  shell(input: { command: string }): Promise<unknown>;
}

interface SandboxRunRuntime {
  seedFixture(): Promise<void>;
  read(input: { path: string }): Promise<string>;
  write(input: { path: string; contents: string }): Promise<{ path: string }>;
  edit(input: { path: string; oldText: string; newText: string }): Promise<{ path: string; replacements: number }>;
  shell(input: { command: string }): Promise<unknown>;
}

interface SandboxLease {
  id: string;
}

interface RunSandboxPool {
  lease(): Promise<SandboxLease>;
  release(lease: SandboxLease): Promise<void>;
}

export interface StartComparisonRunOptions {
  now?: () => string;
  createWorkspaceRuntime?: (lease: SandboxLease) => WorkspaceRunRuntime | Promise<WorkspaceRunRuntime>;
  createSandboxRuntime?: (lease: SandboxLease) => SandboxRunRuntime | Promise<SandboxRunRuntime>;
  workspaceSandboxPool?: RunSandboxPool;
  rawSandboxPool?: RunSandboxPool;
}

export async function startComparisonRun(options: StartComparisonRunOptions = {}): Promise<ComparisonRun> {
  const now = options.now ?? (() => new Date().toISOString());
  const runId = `compare-${crypto.randomUUID()}`;
  const recorder = new RunEventRecorder(runId, now);

  recorder.record("both", "run_started", "Run started", compareFixture.task.title);
  await recordWorkspaceWing(recorder, {
    createRuntime: options.createWorkspaceRuntime ?? (() => defaultWorkspaceRuntime),
    pool: options.workspaceSandboxPool ?? defaultPool("workspace-default"),
  });
  await recordSandboxWing(recorder, {
    createRuntime: options.createSandboxRuntime ?? (() => defaultSandboxRuntime),
    pool: options.rawSandboxPool ?? defaultPool("sandbox-default"),
  });
  recorder.record("both", "run_completed", "Run completed", "Both runtime wings reached terminal state.");

  return { id: runId, events: recorder.events };
}

async function recordWorkspaceWing(
  recorder: RunEventRecorder,
  input: {
    createRuntime: (lease: SandboxLease) => WorkspaceRunRuntime | Promise<WorkspaceRunRuntime>;
    pool: RunSandboxPool;
  },
): Promise<void> {
  recorder.record("workspace", "runtime_started", "Workspace-backed runtime", "Opened Workspace and prepared durable edit surface.");
  const lease = await input.pool.lease();
  recorder.record("workspace", "container_acquired", "Workspace Sandbox acquired", JSON.stringify({ sandboxId: lease.id }));
  const runtime = await input.createRuntime(lease);

  try {
    await runtime.seedFixture();
    recorder.record("workspace", "runtime_note", "Fixture seeded", "Fixture written to Workspace current files and working copy.");
    recorder.record(
      "workspace",
      "tool_call",
      "run",
      JSON.stringify({ name: "run", executionTarget: "dynamic-worker", code: inspectFixtureModule }),
    );
    recorder.record(
      "workspace",
      "tool_result",
      "run result",
      JSON.stringify(await runtime.run({ code: inspectFixtureModule })),
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
      JSON.stringify(await runtime.shell({ command: "npm run check" })),
    );
    recorder.record("workspace", "runtime_completed", "Workspace result ready", "Durable Workspace result is ready for review.");
  } finally {
    await input.pool.release(lease);
    recorder.record("workspace", "container_released", "Workspace Sandbox released", JSON.stringify({ sandboxId: lease.id }));
  }
}

async function recordSandboxWing(
  recorder: RunEventRecorder,
  input: {
    createRuntime: (lease: SandboxLease) => SandboxRunRuntime | Promise<SandboxRunRuntime>;
    pool: RunSandboxPool;
  },
): Promise<void> {
  recorder.record("sandbox", "runtime_started", "Raw Sandbox runtime", "Warm Sandbox filesystem seeded with the fixture.");
  const lease = await input.pool.lease();
  recorder.record("sandbox", "container_acquired", "Raw Sandbox acquired", JSON.stringify({ sandboxId: lease.id }));
  const runtime = await input.createRuntime(lease);

  try {
    await runtime.seedFixture();
    recorder.record("sandbox", "runtime_note", "Fixture seeded", "Fixture written directly into the Sandbox filesystem.");
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
      JSON.stringify(await runtime.shell({ command: "npm run check" })),
    );
    recorder.record("sandbox", "runtime_completed", "Raw Sandbox result ready", "Runtime-local Sandbox result is ready for review.");
  } finally {
    await input.pool.release(lease);
    recorder.record("sandbox", "container_released", "Raw Sandbox released", JSON.stringify({ sandboxId: lease.id }));
  }
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

function defaultPool(id: string): RunSandboxPool {
  return {
    async lease() {
      return { id };
    },
    async release() {},
  };
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
