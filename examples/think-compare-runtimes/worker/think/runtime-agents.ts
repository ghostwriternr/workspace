import { Think, type ChunkContext, type StepContext } from "@cloudflare/think";
import { createWorkersAI } from "workers-ai-provider";
import type { ToolSet } from "ai";
import { getSandbox } from "@cloudflare/sandbox";

import { createRuntimeThinkTools } from "./runtime-tools";
import { runtimeSystemPrompt, runtimeTaskPrompt } from "./prompts";
import { RuntimeAgentRecorder, type RuntimeEventStreamer } from "./runtime-agent-recorder";
import { RUNTIME_AGENT_CHAT_RECOVERY, RUNTIME_AGENT_MAX_STEPS } from "./runtime-agent-config";
import { completionSummaryAfterValidatedTurnFailure, hasSuccessfulValidation } from "./runtime-completion";
import { KIMI_TURN_ATTEMPT_TIMEOUT_MS, KIMI_TURN_MAX_ATTEMPTS, isRetryableThinkTurnError, thinkTurnRetryDelayMs, withRuntimeSetupTimeout } from "./runtime-retry";
import type { RuntimeId } from "../../shared/events";
import type { RunEventInput } from "../runs";
import { createWorkspaceRunOptionsFromBindings } from "../runtime-harness/workspace-run-options";
import { createRawSandboxFactory } from "../runtime-harness/cloudflare-sandbox";
import { createRawSandboxHostForLease } from "../runtime-harness/raw-sandbox-host";
import { createRawSandboxRuntime } from "../runtime-harness/raw-sandbox-runtime";
import type { WorkspaceSandboxClient } from "@cloudflare/workspace-adapter-sandbox";
import type { WorkspaceDynamicWorkerFileCapability } from "@cloudflare/workspace-adapter-dynamic-worker";

interface RuntimeAgentInput {
  runId: string;
  leaseId: string;
}

type RuntimeThinkEnv = Env & { AI: Ai };

abstract class RuntimeComparisonAgent extends Think<RuntimeThinkEnv> {
  override workspace = disabledThinkWorkspace;
  override chatRecovery = RUNTIME_AGENT_CHAT_RECOVERY;
  maxSteps = RUNTIME_AGENT_MAX_STEPS;

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
    recorder: RuntimeAgentRecorder,
    runtimeTools: Parameters<typeof createRuntimeThinkTools>[0]["runtimeTools"],
  ): Promise<RunEventInput[]> {
    await this.__unsafe_ensureInitialized();
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
      await recorder.flush();
      return [];
    } catch (error) {
      if (hasSuccessfulValidation(recorder.events)) {
        recorder.record({
          runtime: this.runtime,
          kind: "agent_message",
          title: "Think turn complete",
          detail: completionSummaryAfterValidatedTurnFailure(error),
        });
        await recorder.flush();
        return [];
      }
      recorder.record({
        runtime: this.runtime,
        kind: "runtime_failed",
        title: "Think turn failed",
        detail: errorMessage(error),
      });
      await recorder.flush();
      return [];
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
    const deadline = Date.now() + KIMI_TURN_ATTEMPT_TIMEOUT_MS;
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
      if (Date.now() >= deadline) {
        throw new Error(`Kimi turn timed out waiting for submission ${submissionId}.`);
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
    const recorder = createLiveRuntimeRecorder(this.env, input.runId, this.runtime);
    recorder.record({
      runtime: this.runtime,
      kind: "runtime_note",
      title: "Preparing Workspace runtime",
      detail: "Opening Workspace, seeding current files, and creating the working copy.",
    });
    const options = await createWorkspaceRunOptionsFromBindings({
      artifacts: this.env.ARTIFACTS,
      objects: this.env.WORKSPACE_OBJECTS,
      dynamicWorkers: this.env.DYNAMIC_WORKERS,
      sandboxForLease: (lease) => getSandbox(this.env.WorkspaceSandbox, lease.id, { sleepAfter: containerSleepAfter(this.env) }) as WorkspaceSandboxClient,
      workspaceForWorkingCopy: (workingCopyId) => workspaceFileCapability(this.env.SELF, workingCopyId),
    });
    const runtime = await options.createWorkspaceRuntime?.({ id: input.leaseId });
    if (!runtime) throw new Error("Workspace runtime dependencies were not created.");
    return this.runWithTools(recorder, runtime);
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
    const recorder = createLiveRuntimeRecorder(this.env, input.runId, this.runtime);
    recorder.record({
      runtime: this.runtime,
      kind: "runtime_note",
      title: "Preparing raw Sandbox runtime",
      detail: "Opening the Sandbox session and preparing the fixture filesystem.",
    });
    const runtime = createRawSandboxRuntime(
      createRawSandboxHostForLease(createRawSandboxFactory(this.env.Sandbox), { id: input.leaseId }, {
        sleepAfter: containerSleepAfter(this.env),
      }),
    );
    return this.runWithTools(recorder, runtime);
  }
}

interface CompareRunEventStream {
  recordRuntimeEvent(input: RunEventInput): Promise<void>;
}

function containerSleepAfter(env: { CONTAINER_SLEEP_AFTER?: string }): string {
  return env.CONTAINER_SLEEP_AFTER ?? "2m";
}

function createLiveRuntimeRecorder(env: Env, runId: string, runtime: RuntimeId): RuntimeAgentRecorder {
  return new RuntimeAgentRecorder(runtime, compareRunEventStreamer(env, runId));
}

function compareRunEventStreamer(env: Env, runId: string): RuntimeEventStreamer {
  const run = env.CompareRun.get(env.CompareRun.idFromName(runId)) as unknown as CompareRunEventStream;
  return {
    recordRuntimeEvent(input) {
      return run.recordRuntimeEvent(input);
    },
  };
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
