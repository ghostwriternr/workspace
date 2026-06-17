import { describe, expect, test } from "vitest";

import { createRuntimeThinkTools } from "./runtime-tools";

describe("createRuntimeThinkTools", () => {
  test("wraps Workspace runtime tools with event recording", async () => {
    const events: unknown[] = [];
    const tools = createRuntimeThinkTools({
      runtime: "workspace",
      recorder: { record: (event) => events.push(event) },
      runtimeTools: {
        async seedFixture() {},
        async read(input) { return `read:${input.path}`; },
        async write(input) { return { path: input.path, bytes: input.contents.length }; },
        async edit(input) { return { path: input.path, replacements: input.oldText === "old" ? 1 : 0 }; },
        async run(input) { return { ran: input.code.includes("WORKSPACE") }; },
        async shell(input) { return { command: input.command, exitCode: 0, stdout: "ok\n", stderr: "" }; },
      },
    });

    await expect(tools.read.execute?.({ path: "/README.md" }, toolExecutionOptions())).resolves.toBe("read:/README.md");
    await expect(tools.run.execute?.({ code: "export default ({ WORKSPACE }) => WORKSPACE" }, toolExecutionOptions())).resolves.toEqual({ ran: true });

    expect(events).toEqual([
      expect.objectContaining({ runtime: "workspace", kind: "agent_tool_call", title: "Think requested read" }),
      expect.objectContaining({ runtime: "workspace", kind: "agent_tool_result", title: "Think read result" }),
      expect.objectContaining({ runtime: "workspace", kind: "agent_tool_call", title: "Think requested run" }),
      expect.objectContaining({ runtime: "workspace", kind: "agent_tool_result", title: "Think run result" }),
    ]);
  });

  test("wraps raw Sandbox tools without a Dynamic Worker run tool", () => {
    const tools = createRuntimeThinkTools({
      runtime: "sandbox",
      recorder: { record: () => undefined },
      runtimeTools: {
        async seedFixture() {},
        async read() { return ""; },
        async write(input) { return { path: input.path }; },
        async edit(input) { return { path: input.path, replacements: 1 }; },
        async shell(input) { return { command: input.command, exitCode: 0, stdout: "", stderr: "" }; },
      },
    });

    expect(Object.keys(tools).sort()).toEqual(["edit", "read", "shell", "write"]);
  });
});

function toolExecutionOptions() {
  return { toolCallId: "test", messages: [], abortSignal: undefined } as never;
}
