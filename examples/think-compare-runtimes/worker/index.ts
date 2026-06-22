import { Sandbox as RawSandbox } from "@cloudflare/sandbox";
import { WorkspaceSandbox as BaseWorkspaceSandbox, WorkspaceContainerProxy } from "@cloudflare/workspace-adapter-sandbox/workers";
import { getServerByName, Server } from "partyserver";

import { compareFixture } from "../shared/fixture";
import { handleRequest } from "./http";
import { createLiveComparisonRunOptions } from "./runtime-harness/run-options";
import { RawSandboxWarmPool, refreshSandboxWarmPools, WorkspaceSandboxWarmPool } from "./sandbox-warm-pool";
import { RunEventSink, type RunSession } from "./run-session";
import type { RunEvent } from "../shared/events";
import { runComparison, type RunEventInput, type StartComparisonRunOptions } from "./runs";

export { WorkspaceObject } from "@cloudflare/workspace/workers";
export { WorkspaceFileCapability } from "./workspace-file-capability";
export { WorkspaceRuntimeAgent, SandboxRuntimeAgent } from "./think/runtime-agents";
export { WorkspaceContainerProxy as ContainerProxy };

const EVENTS_KEY = "events";

export class WorkspaceSandbox extends BaseWorkspaceSandbox<Env> {}

export class Sandbox extends RawSandbox<Env> {}

export { RawSandboxWarmPool, WorkspaceSandboxWarmPool };

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

  async recordRuntimeEvent(input: RunEventInput): Promise<void> {
    await this.#started;
    await this.#sink.append(input);
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
        options: this.#runOptions(),
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

  #runOptions(): StartComparisonRunOptions {
    return createLiveComparisonRunOptions({
      workspaceRuntimeAgent: this.env.WorkspaceRuntimeAgent,
      sandboxRuntimeAgent: this.env.SandboxRuntimeAgent,
      workspaceSandboxWarmPool: this.env.WorkspaceSandboxWarmPool,
      rawSandboxWarmPool: this.env.RawSandboxWarmPool,
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

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(refreshSandboxWarmPools(env));
  },
};
