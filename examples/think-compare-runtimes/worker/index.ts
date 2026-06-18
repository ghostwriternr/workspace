import { getSandbox } from "@cloudflare/sandbox";
import type { WorkspaceDynamicWorkerFileCapability } from "@cloudflare/workspace-adapter-dynamic-worker";
import { WorkspaceSandbox, WorkspaceContainerProxy } from "@cloudflare/workspace-adapter-sandbox/workers";
import type { WorkspaceSandboxClient } from "@cloudflare/workspace-adapter-sandbox";
import { getServerByName, Server } from "partyserver";

import { compareFixture } from "../shared/fixture";
import { handleRequest } from "./http";
import { createLiveComparisonRunOptions } from "./run-dependencies";
import { RunEventSink, type RunSession } from "./run-session";
import type { RunEvent } from "../shared/events";
import { runComparison, type StartComparisonRunOptions } from "./runs";
import { createRawSandboxFactory } from "./runtimes/cloudflare-sandbox";
import { createWorkspaceRunOptionsFromBindings } from "./workspace-run-dependencies";

export { WorkspaceObject } from "@cloudflare/workspace/workers";
export { WorkspaceFileCapability } from "./workspace-file-capability";
export { WorkspaceRuntimeAgent, SandboxRuntimeAgent } from "./think/runtime-agents";
export { WorkspaceContainerProxy as ContainerProxy };

const EVENTS_KEY = "events";

export class Sandbox extends WorkspaceSandbox<Env> {}

export class CompareRun extends Server<Env> {
  static override options = { hibernate: true };

  #events: RunEvent[] = [];
  #sink!: RunEventSink;
  readonly #started: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#started = this.#load();
    ctx.blockConcurrencyWhile(() => this.#started);
  }

  override async onStart(): Promise<void> {
    await this.#started;
  }

  override onConnect(connection: WebSocket): void {
    connection.send(JSON.stringify({ type: "history", events: this.#sink.events }));
  }

  async startComparison(): Promise<RunSession> {
    await this.#started;
    await this.#sink.reset();
    this.ctx.waitUntil(this.#run());
    return {
      runId: this.name,
      socketPath: `/api/runs/compare-run/${this.name}`,
      events: this.#sink.events,
    };
  }

  async stopComparison(): Promise<void> {
    await this.#started;
    await Promise.allSettled([
      this.env.WorkspaceRuntimeAgent.getByName(`${this.name}:workspace`).cancelAllChats?.(),
      this.env.SandboxRuntimeAgent.getByName(`${this.name}:sandbox`).cancelAllChats?.(),
    ]);
  }

  async #run(): Promise<void> {
    try {
      await this.#sink.append({
        runtime: "both",
        kind: "run_started",
        title: "Run started",
        detail: compareFixture.task.title,
      });
      await runComparison({
        runId: this.name,
        recorder: this.#sink,
        options: await withTimeout(this.#runOptions(), 60_000, "Comparison runtime dependency setup timed out."),
        skipRunStarted: true,
      });
    } catch (error) {
      await this.#sink.append({
        runtime: "both",
        kind: "run_failed",
        title: "Comparison run failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async #runOptions(): Promise<StartComparisonRunOptions> {
    return createLiveComparisonRunOptions({
      rawSandboxFactory: createRawSandboxFactory(this.env.Sandbox),
      workspaceRunOptions: await createWorkspaceRunOptionsFromBindings({
        artifacts: this.env.ARTIFACTS,
        dynamicWorkers: this.env.DYNAMIC_WORKERS,
        objects: this.env.WORKSPACE_OBJECTS,
        sandboxForLease: (lease) => getSandbox(this.env.Sandbox, lease.id, { sleepAfter: "10m" }) as WorkspaceSandboxClient,
        workspaceForWorkingCopy: (workingCopyId) => workspaceFileCapability(this.env.SELF, workingCopyId),
      }),
      workspaceRuntimeAgent: this.env.WorkspaceRuntimeAgent,
      sandboxRuntimeAgent: this.env.SandboxRuntimeAgent,
    });
  }

  async #load(): Promise<void> {
    const events = (await this.ctx.storage.get<RunEvent[]>(EVENTS_KEY)) ?? [];
    this.#events = events;
    this.#sink = new RunEventSink({
      runId: this.name,
      initialEvents: events,
      persist: async (next) => {
        this.#events = next;
        await this.ctx.storage.put(EVENTS_KEY, next);
      },
      broadcast: (message) => this.broadcast(message),
    });
  }
}

interface WorkspaceFileCapabilityService {
  getEntrypoint(
    name: "WorkspaceFileCapability",
    options: { props: { workspaceName: string; workingCopyId: string } },
  ): unknown;
}

function workspaceFileCapability(self: Env["SELF"], workingCopyId: string): WorkspaceDynamicWorkerFileCapability {
  return (self as unknown as WorkspaceFileCapabilityService).getEntrypoint("WorkspaceFileCapability", {
    props: { workspaceName: "think-runtime-comparison", workingCopyId },
  }) as WorkspaceDynamicWorkerFileCapability;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function routeCompareRunRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const match = /^\/api\/runs\/compare-run\/([^/]+)$/.exec(url.pathname);
  if (!match) return null;

  const runId = decodeURIComponent(match[1] ?? "");
  if (!runId) return new Response("Invalid run id", { status: 400 });
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket", { status: 426 });
  }

  const routed = new Request(request);
  routed.headers.set("x-partykit-room", runId);
  routed.headers.set("x-partykit-namespace", "compare-run");
  return env.CompareRun.get(env.CompareRun.idFromName(runId)).fetch(routed);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const runSocketResponse = await routeCompareRunRequest(request, env);
    if (runSocketResponse) return runSocketResponse;

    return handleRequest(request, {
      async startRun(runId) {
        const run = (await getServerByName(env.CompareRun, runId)) as unknown as CompareRun;
        return run.startComparison();
      },
    });
  },
};
