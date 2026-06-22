import { tool, type ToolSet } from "ai";
import { z } from "zod";

import type { RuntimeId } from "../../shared/events";
import type { SandboxComparisonRuntime, WorkspaceComparisonRuntime } from "../runtime-harness/coding-runtime";
import type { RunEventInput } from "../runs";

export interface RuntimeThinkToolRecorder {
  record(input: RunEventInput): unknown | Promise<unknown>;
}

interface RuntimeThinkToolsOptions {
  runtime: RuntimeId;
  runtimeTools: WorkspaceComparisonRuntime | SandboxComparisonRuntime;
  recorder: RuntimeThinkToolRecorder;
}

const pathInput = z.object({ path: z.string().min(1) });
const writeInput = z.object({ path: z.string().min(1), contents: z.string() });
const editInput = z.object({
  path: z.string().min(1),
  oldText: z.string().min(1),
  newText: z.string(),
});
const runInput = z.object({
  code: z.string().min(1).describe("JavaScript module code for the Workspace Dynamic Worker runtime."),
});
const shellInput = z.object({ command: z.string().min(1) });

export function createRuntimeThinkTools({
  runtime,
  runtimeTools,
  recorder,
}: RuntimeThinkToolsOptions): ToolSet {
  const queue = new RuntimeToolQueue();
  const tools: ToolSet = {
    read: runtimeTool({
      runtime,
      recorder,
      name: "read",
      description: "Read a UTF-8 project file. Paths are rooted at /workspace.",
      inputSchema: pathInput,
      execute: (input) => queue.run(() => runtimeTools.read(input)),
    }),
    write: runtimeTool({
      runtime,
      recorder,
      name: "write",
      description: "Create or overwrite a project file. Paths are rooted at /workspace.",
      inputSchema: writeInput,
      execute: (input) => queue.run(() => runtimeTools.write(input)),
    }),
    edit: runtimeTool({
      runtime,
      recorder,
      name: "edit",
      description: "Replace exact text in a project file. oldText must match exactly once.",
      inputSchema: editInput,
      execute: (input) => queue.run(() => runtimeTools.edit(input)),
    }),
    shell: runtimeTool({
      runtime,
      recorder,
      name: "shell",
      description: "Run a shell command from /workspace.",
      inputSchema: shellInput,
      execute: (input) => queue.run(() => runtimeTools.shell(input)),
    }),
  };

  if (runtime === "workspace" && "run" in runtimeTools) {
    tools.run = runtimeTool({
      runtime,
      recorder,
      name: "run",
      description: "Run JavaScript in a Dynamic Worker with scoped Workspace file access.",
      inputSchema: runInput,
      execute: (input) => queue.run(() => runtimeTools.run(input)),
    });
  }

  return tools;
}

interface RuntimeToolOptions<Schema extends z.ZodType> {
  runtime: RuntimeId;
  recorder: RuntimeThinkToolRecorder;
  name: string;
  description: string;
  inputSchema: Schema;
  execute(input: z.infer<Schema>): Promise<unknown>;
}

function runtimeTool<Schema extends z.ZodType>({
  runtime,
  recorder,
  name,
  description,
  inputSchema,
  execute,
}: RuntimeToolOptions<Schema>) {
  return tool({
    description,
    inputSchema,
    execute: async (input) => {
      await recorder.record({
        runtime,
        kind: "agent_tool_call",
        title: `Think requested ${name}`,
        detail: stringifyEventDetail(input),
      });

      try {
        const parsed = inputSchema.parse(input);
        const result = await execute(parsed);
        await recorder.record({
          runtime,
          kind: "agent_tool_result",
          title: `Think ${name} result`,
          detail: stringifyEventDetail(result),
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await recorder.record({
          runtime,
          kind: "agent_tool_error",
          title: `Think ${name} error`,
          detail: stringifyEventDetail({ input, error: message }),
        });
        return { status: "error", error: message };
      }
    },
  });
}

class RuntimeToolQueue {
  #tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(operation, operation);
    this.#tail = next.catch(() => undefined);
    return next;
  }
}

function stringifyEventDetail(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
