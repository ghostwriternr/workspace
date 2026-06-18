import { Think, type ChunkContext, type StepContext } from "@cloudflare/think";
import { createWorkersAI } from "workers-ai-provider";
import type { ToolSet } from "ai";
import { getSandbox } from "@cloudflare/sandbox";

import { createRuntimeThinkTools, type RuntimeThinkToolRecorder } from "./runtime-tools";
import { runtimeSystemPrompt, runtimeTaskPrompt } from "./prompts";
import { KIMI_TURN_MAX_ATTEMPTS, isRetryableThinkTurnError, thinkTurnRetryDelayMs, withRuntimeSetupTimeout } from "./runtime-retry";
import type { RuntimeId } from "../../shared/events";
import type { RunEventInput } from "../runs";
import { createWorkspaceRunOptionsFromBindings } from "../workspace-run-dependencies";
import { createRawSandboxFactory } from "../runtimes/cloudflare-sandbox";
import { createRawSandboxHostForLease } from "../runtimes/raw-sandbox-host";
import { createRawSandboxRuntime } from "../runtimes/sandbox-runtime";
import type { WorkspaceSandboxClient } from "@cloudflare/workspace-adapter-sandbox";
import type { WorkspaceDynamicWorkerFileCapability } from "@cloudflare/workspace-adapter-dynamic-worker";

interface RuntimeAgentInput {
  runId: string;
  leaseId: string;
}

type RuntimeThinkEnv = Env & { AI: Ai };

abstract class RuntimeComparisonAgent extends Think<RuntimeThinkEnv> {
  override workspace = disabledThinkWorkspace;
  maxSteps = 24;

  #activeRecorder: RuntimeAgentRecorder | undefined;
  #activeTools: ToolSet = {};
  #messageDelta = "";
  #thinkingDelta = "";

  abstract readonly runtime: RuntimeId;

  getModel() {
    return createWorkersAI({ binding: this.env.AI })("@cf/moonshotai/kimi-k2.6", {
      reasoning_effort: "low",
      sessionAffinity: this.sessionAffinity,
    });
  }

  getSystemPrompt(): string {
    return runtimeSystemPrompt(this.runtime);
  }

  beforeTurn() {
    return { activeTools: Object.keys(this.#activeTools) };
  }

  getTools(): ToolSet {
    return this.#activeTools;
  }

  protected async runWithTools(
    runtimeTools: Parameters<typeof createRuntimeThinkTools>[0]["runtimeTools"],
  ): Promise<RunEventInput[]> {
    await this.__unsafe_ensureInitialized();
    const recorder = new RuntimeAgentRecorder(this.runtime);
    await withRuntimeSetupTimeout(
      runtimeTools.seedFixture(),
      60_000,
      `${this.runtime} runtime fixture setup timed out.`,
    );
    recorder.record({
      runtime: this.runtime,
      kind: "runtime_note",
      title: "Fixture seeded",
      detail: this.runtime === "workspace"
        ? "Fixture seeded into a Workspace working copy."
        : "Fixture seeded into a raw Sandbox filesystem.",
    });

    this.#activeTools = createRuntimeThinkTools({
      runtime: this.runtime,
      runtimeTools,
      recorder,
    });

    this.#activeRecorder = recorder;
    this.#messageDelta = "";
    this.#thinkingDelta = "";

    try {
      recorder.record({
        runtime: this.runtime,
        kind: "agent_message",
        title: "Think turn started",
        detail: `Kimi-backed Think agent is running against the ${this.runtime} runtime.`,
      });
      const text = await this.runThinkSubmissionWithRetries(recorder);
      await this.flushStreamingDeltas();
      recorder.record({
        runtime: this.runtime,
        kind: "agent_message",
        title: "Think turn complete",
        detail: text,
      });
      return recorder.events;
    } catch (error) {
      recorder.record({
        runtime: this.runtime,
        kind: "runtime_failed",
        title: "Think turn failed",
        detail: errorMessage(error),
      });
      return recorder.events;
    } finally {
      this.#activeRecorder = undefined;
      this.#activeTools = {};
      this.#messageDelta = "";
      this.#thinkingDelta = "";
    }
  }

  override async onChunk(ctx: ChunkContext): Promise<void> {
    const chunk = ctx.chunk as { type?: string; text?: unknown; delta?: unknown };
    const text = typeof chunk.text === "string"
      ? chunk.text
      : typeof chunk.delta === "string"
        ? chunk.delta
        : "";
    if (!text) return;

    if (chunk.type === "reasoning-delta") {
      this.#thinkingDelta += text;
      await this.flushThinking(false);
      return;
    }

    if (chunk.type === "text-delta") {
      this.#messageDelta += text;
      await this.flushMessage(false);
    }
  }

  override async onStepFinish(_ctx: StepContext): Promise<void> {
    await this.flushStreamingDeltas();
  }

  private async runThinkSubmissionWithRetries(recorder: RuntimeAgentRecorder): Promise<string> {
    for (let attempt = 1; attempt <= KIMI_TURN_MAX_ATTEMPTS; attempt += 1) {
      try {
        const submission = await this.submitMessages([
          {
            id: crypto.randomUUID(),
            role: "user",
            parts: [{ type: "text", text: runtimeTaskPrompt() }],
          },
        ]);
        return await this.awaitAssistantText(submission.submissionId);
      } catch (error) {
        if (attempt >= KIMI_TURN_MAX_ATTEMPTS || !isRetryableThinkTurnError(error)) {
          throw error;
        }

        await recorder.record({
          runtime: this.runtime,
          kind: "agent_message",
          title: "Retrying Kimi turn",
          detail: `Attempt ${attempt} failed with ${errorMessage(error)}. Retrying with Kimi.`,
        });
        await this.clearMessages();
        await scheduler.wait(thinkTurnRetryDelayMs(attempt));
      }
    }

    throw new Error("Kimi turn retry loop exited unexpectedly.");
  }

  private async awaitAssistantText(submissionId: string): Promise<string> {
    for (;;) {
      const inspection = await this.inspectSubmission(submissionId);
      if (!inspection) throw new Error(`Submission ${submissionId} vanished.`);
      if (inspection.status === "completed") {
        const text = collectAssistantText(this.messages);
        if (!text) throw new Error("Think turn completed without assistant text.");
        return text;
      }
      if (inspection.status === "error" || inspection.status === "aborted" || inspection.status === "skipped") {
        throw new Error(`Think turn ended in status=${inspection.status}${inspection.error ? `: ${inspection.error}` : ""}`);
      }
      await scheduler.wait(500);
    }
  }

  private async flushStreamingDeltas(): Promise<void> {
    await this.flushThinking(true);
    await this.flushMessage(true);
  }

  private async flushThinking(force: boolean): Promise<void> {
    if (!this.#thinkingDelta) return;
    if (!force && this.#thinkingDelta.length < 120) return;
    const detail = this.#thinkingDelta;
    this.#thinkingDelta = "";
    this.#activeRecorder?.record({
      runtime: this.runtime,
      kind: "agent_thinking_delta",
      title: "Think reasoning",
      detail,
    });
  }

  private async flushMessage(force: boolean): Promise<void> {
    if (!this.#messageDelta) return;
    if (!force && this.#messageDelta.length < 120) return;
    const detail = this.#messageDelta;
    this.#messageDelta = "";
    this.#activeRecorder?.record({
      runtime: this.runtime,
      kind: "agent_message_delta",
      title: "Think response",
      detail,
    });
  }
}

export class WorkspaceRuntimeAgent extends RuntimeComparisonAgent {
  readonly runtime = "workspace" as const;

  async runComparison(input: RuntimeAgentInput): Promise<RunEventInput[]> {
    const options = await createWorkspaceRunOptionsFromBindings({
      artifacts: this.env.ARTIFACTS,
      objects: this.env.WORKSPACE_OBJECTS,
      dynamicWorkers: this.env.DYNAMIC_WORKERS,
      sandboxForLease: (lease) => getSandbox(this.env.Sandbox, lease.id, { sleepAfter: "10m" }) as WorkspaceSandboxClient,
      workspaceForWorkingCopy: (workingCopyId) => workspaceFileCapability(this.env.SELF, workingCopyId),
    });
    const runtime = await options.createWorkspaceRuntime?.({ id: input.leaseId });
    if (!runtime) throw new Error("Workspace runtime dependencies were not created.");
    return this.runWithTools(runtime);
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

export class SandboxRuntimeAgent extends RuntimeComparisonAgent {
  readonly runtime = "sandbox" as const;

  async runComparison(input: RuntimeAgentInput): Promise<RunEventInput[]> {
    const runtime = createRawSandboxRuntime(
      createRawSandboxHostForLease(createRawSandboxFactory(this.env.Sandbox), { id: input.leaseId }),
    );
    return this.runWithTools(runtime);
  }
}

class RuntimeAgentRecorder implements RuntimeThinkToolRecorder {
  readonly events: RunEventInput[] = [];

  constructor(private readonly defaultRuntime: RuntimeId) {}

  record(input: RunEventInput): RunEventInput {
    const event = { ...input, runtime: input.runtime ?? this.defaultRuntime };
    this.events.push(event);
    return event;
  }
}

function collectAssistantText(messages: Array<{ role?: string; parts?: Array<unknown> }>): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const text = (message.parts ?? [])
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const candidate = part as { type?: string; text?: unknown };
        return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
      })
      .join("")
      .trim();
    if (text) return text;
  }
  return "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const disabledThinkWorkspace = {
  async readFile(): Promise<never> { return disabledWorkspaceMethod(); },
  async readFileBytes(): Promise<never> { return disabledWorkspaceMethod(); },
  async writeFile(): Promise<never> { return disabledWorkspaceMethod(); },
  async readDir(): Promise<never> { return disabledWorkspaceMethod(); },
  async rm(): Promise<never> { return disabledWorkspaceMethod(); },
  async glob(): Promise<never> { return disabledWorkspaceMethod(); },
  async mkdir(): Promise<never> { return disabledWorkspaceMethod(); },
  async stat(): Promise<never> { return disabledWorkspaceMethod(); },
};

function disabledWorkspaceMethod(): never {
  throw new Error("Use the comparison runtime tools for project files.");
}
