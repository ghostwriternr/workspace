import { env } from "cloudflare:workers";
import { Result, type Result as BetterResult } from "better-result";
import { describe, expect, it } from "vitest";
import { Workspace } from "@cloudflare/workspace";

import { RepoWorkingCopyController } from "../../src/repo/working-copy-controller";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("RepoWorkingCopyController", () => {
  it("reads current files and directories without opening a working copy", async () => {
    const { controller, getWorkingCopyId } = await setupWorkingCopyController();

    expect(await expectOk(controller.read({ path: "README.md" }))).toEqual({
      status: "file-read",
      path: "/README.md",
      contents: "# Repo",
      startLine: 1,
      endLine: 1,
      totalLines: 1,
      truncated: false,
    });
    expect(await expectOk(controller.read({ path: "/" }))).toMatchObject({
      status: "directory-listed",
      path: "/",
      entries: [{ path: "/README.md", type: "file" }],
    });
    expect(getWorkingCopyId()).toBeUndefined();
  });

  it("truncates large reads and supports offset and limit", async () => {
    const { controller, workspace } = await setupWorkingCopyController();
    const large = unwrap(await workspace.files.copy("large"));
    await large.files.writeTree("/", [
      { path: "large.md", contents: encoder.encode(numberedLines(2001)) },
    ]);
    await large.apply();

    const first = await expectOk(controller.read({ path: "large.md" }));
    expect(first).toMatchObject({
      status: "file-read",
      path: "/large.md",
      startLine: 1,
      endLine: 2000,
      totalLines: 2001,
      truncated: true,
    });
    if (first.status !== "file-read") throw new Error("expected file read");
    expect(first.contents).toContain("line 1\nline 2");
    expect(first.contents).toContain("[Showing lines 1-2000 of 2001. Use offset=2001 to continue.]");

    expect(await expectOk(controller.read({ path: "large.md", offset: 2001, limit: 1 }))).toEqual({
      status: "file-read",
      path: "/large.md",
      contents: "line 2001",
      startLine: 2001,
      endLine: 2001,
      totalLines: 2001,
      truncated: false,
    });

    expect(await expectOk(controller.read({ path: "large.md", offset: 2, limit: 2 }))).toEqual({
      status: "file-read",
      path: "/large.md",
      contents: "line 2\nline 3\n\n[1998 more lines in file. Use offset=4 to continue.]",
      startLine: 2,
      endLine: 3,
      totalLines: 2001,
      truncated: true,
    });
  });

  it("caps read output by bytes without splitting lines", async () => {
    const { controller, workspace } = await setupWorkingCopyController();
    const large = unwrap(await workspace.files.copy("large-bytes"));
    const lines = Array.from({ length: 200 }, () => "x".repeat(512)).join("\n");
    await large.files.writeTree("/", [
      { path: "wide.md", contents: encoder.encode(lines) },
    ]);
    await large.apply();

    const result = await expectOk(controller.read({ path: "wide.md" }));

    expect(result).toMatchObject({
      status: "file-read",
      path: "/wide.md",
      startLine: 1,
      endLine: 99,
      totalLines: 200,
      truncated: true,
    });
    if (result.status !== "file-read") throw new Error("expected file read");
    expect(result.contents).toContain("[Showing lines 1-99 of 200 (50KB limit). Use offset=100 to continue.]");
  });

  it("returns a value error when read offset is beyond the file", async () => {
    const { controller } = await setupWorkingCopyController();

    expect(await expectError(controller.read({ path: "README.md", offset: 2 }))).toEqual({
      tag: "ReadOffsetOutOfRangeError",
      message: "Offset 2 is beyond end of /README.md (1 line total).",
      path: "/README.md",
      offset: 2,
      totalLines: 1,
    });
  });

  it("writes and edits files in an active working copy", async () => {
    const { controller, workspace, getWorkingCopyId } = await setupWorkingCopyController();

    expect(await expectOk(controller.write({ path: "notes/todo.md", contents: "hello world" }))).toEqual({
      status: "file-written",
      path: "/notes/todo.md",
    });
    expect(await expectOk(controller.edit({ path: "./notes/todo.md", oldText: "world", newText: "Workspace" }))).toEqual({
      status: "file-edited",
      path: "/notes/todo.md",
      replacements: 1,
    });

    const current = await workspace.files.read("/notes/todo.md");
    const copy = unwrap(await workspace.files.getCopy(getWorkingCopyId()!));
    const edited = unwrap(await copy.files.read("/notes/todo.md"));

    expect(Result.isError(current)).toBe(true);
    expect(decoder.decode(edited)).toBe("hello Workspace");
  });

  it("treats exact edit replacement text literally", async () => {
    const { controller, workspace, getWorkingCopyId } = await setupWorkingCopyController();
    await expectOk(controller.write({ path: "/scripts/example.sh", contents: "echo old\n" }));

    await expectOk(controller.edit({ path: "/scripts/example.sh", oldText: "old", newText: "$HOME and $&" }));

    const copy = unwrap(await workspace.files.getCopy(getWorkingCopyId()!));
    expect(decoder.decode(unwrap(await copy.files.read("/scripts/example.sh")))).toBe("echo $HOME and $&\n");
  });

  it("rejects exact edits that do not identify one replacement", async () => {
    const { controller } = await setupWorkingCopyController();
    await expectOk(controller.write({ path: "/notes/repeated.md", contents: "same same" }));

    expect(await expectError(controller.edit({ path: "/notes/repeated.md", oldText: "missing", newText: "x" }))).toMatchObject({
      tag: "TextNotFoundError",
      path: "/notes/repeated.md",
    });
    expect(await expectError(controller.edit({ path: "/notes/repeated.md", oldText: "same", newText: "x" }))).toMatchObject({
      tag: "AmbiguousTextEditError",
      path: "/notes/repeated.md",
      matches: 2,
    });
  });

  it("runs Worker code against the active working copy", async () => {
    const { controller, workspace, runner, getWorkingCopyId } = await setupWorkingCopyController();

    expect(await expectOk(controller.run({ code: "export default async function(env) {}" }))).toEqual({
      status: "run-completed",
      result: { wrote: "/notes/edit.md" },
    });
    expect(getWorkingCopyId()).toEqual(expect.any(String));

    const current = await workspace.files.read("/notes/edit.md");
    const copy = unwrap(await workspace.files.getCopy(getWorkingCopyId()!));
    const edited = unwrap(await copy.files.read("/notes/edit.md"));

    expect(runner.calls).toEqual([{ code: "export default async function(env) {}" }]);
    expect(Result.isError(current)).toBe(true);
    expect(decoder.decode(edited)).toBe("read # Repo");
  });

  it("runs shell commands against the active working copy and reconciles changes", async () => {
    const { controller, workspace, shellRunner, getWorkingCopyId } = await setupWorkingCopyController();

    const result = await expectOk(controller.shell({ command: "npm test" }));

    expect(result).toEqual({
      status: "shell-completed",
      command: "npm test",
      root: "/workspace",
      exitCode: 1,
      stdout: "",
      stderr: "tests failed",
      reconcile: { created: ["/notes/shell.md"], modified: [], deleted: [], unchanged: 1 },
    });
    expect(getWorkingCopyId()).toEqual(expect.any(String));

    const current = await workspace.files.read("/notes/shell.md");
    const copy = unwrap(await workspace.files.getCopy(getWorkingCopyId()!));
    const edited = unwrap(await copy.files.read("/notes/shell.md"));

    expect(shellRunner.calls).toEqual([{ command: "npm test", workingCopyId: getWorkingCopyId() }]);
    expect(Result.isError(current)).toBe(true);
    expect(decoder.decode(edited)).toBe("shell wrote this");
  });

  it("applies or discards only an active working copy", async () => {
    const applySetup = await setupWorkingCopyController();
    expect(await expectOk(applySetup.controller.write({ path: "/notes/apply.md", contents: "apply me" }))).toMatchObject({ status: "file-written" });
    const applied = await expectOk(applySetup.controller.applyWorkingCopy());

    expect(applied).toMatchObject({ status: "working-copy-applied", workingCopyId: expect.any(String), revisionId: expect.any(String) });
    expect(applySetup.getWorkingCopyId()).toBeUndefined();
    expect(decoder.decode(unwrap(await applySetup.workspace.files.read("/notes/apply.md")))).toBe("apply me");

    const discardSetup = await setupWorkingCopyController();
    expect(await expectOk(discardSetup.controller.write({ path: "/notes/discard.md", contents: "discard me" }))).toMatchObject({ status: "file-written" });
    const discarded = await expectOk(discardSetup.controller.discardWorkingCopy());

    expect(discarded).toMatchObject({ status: "working-copy-discarded", workingCopyId: expect.any(String) });
    expect(discardSetup.getWorkingCopyId()).toBeUndefined();
    expect(Result.isError(await discardSetup.workspace.files.read("/notes/discard.md"))).toBe(true);
  });

  it.each(["apply", "discard"] as const)("returns a value error when %sing without an active working copy", async (action) => {
    const { controller } = await setupWorkingCopyController();

    if (action === "apply") {
      await expectNoActiveWorkingCopy(controller.applyWorkingCopy(), action);
    } else {
      await expectNoActiveWorkingCopy(controller.discardWorkingCopy(), action);
    }
  });
});

async function setupWorkingCopyController() {
  const workspaceName = `repo-working-${crypto.randomUUID()}`;
  const workspace = Workspace.get(env.WORKSPACES, workspaceName);
  const seed = unwrap(await workspace.files.copy("seed"));
  await seed.files.writeTree("/", [
    { path: "README.md", contents: encoder.encode("# Repo") },
  ]);
  await seed.apply();

  let workingCopyId: string | undefined;
  const runner = {
    calls: [] as Array<{ code: string }>,
    async run(options: { code: string }) {
      this.calls.push({ code: options.code });
      const copy = unwrap(await workspace.files.getCopy(workingCopyId!));
      const readme = unwrap(await copy.files.read("/README.md"));
      await copy.files.writeTree("/", [
        { path: "notes/edit.md", contents: encoder.encode(`read ${decoder.decode(readme)}`) },
      ]);
      return Result.ok({ wrote: "/notes/edit.md" });
    },
  };
  const shellRunner = {
    calls: [] as Array<{ command: string; workingCopyId: string | undefined }>,
    async runCommand(options: { command: string; sandboxId: string }) {
      this.calls.push({ command: options.command, workingCopyId: options.sandboxId });
      const copy = unwrap(await workspace.files.getCopy(options.sandboxId));
      await copy.files.writeTree("/", [
        { path: "notes/shell.md", contents: encoder.encode("shell wrote this") },
      ]);
      return Result.ok({
        command: options.command,
        root: "/workspace",
        exitCode: 1,
        stdout: "",
        stderr: "tests failed",
        reconcile: { created: ["/notes/shell.md"], modified: [], deleted: [], unchanged: 1 },
      });
    },
  };
  const controller = new RepoWorkingCopyController({
    workspaces: env.WORKSPACES,
    workspaceName,
    dynamicWorkerRunner: runner,
    shellRunner,
    workspaceForWorkingCopy: () => ({}) as never,
    getWorkingCopyId: () => workingCopyId,
    setWorkingCopyId: (next) => { workingCopyId = next; },
  });

  return {
    controller,
    workspace,
    runner,
    shellRunner,
    getWorkingCopyId: () => workingCopyId,
  };
}

function numberedLines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");
}

function unwrap<T, E>(result: BetterResult<T, E>): T {
  if (Result.isError(result)) {
    throw new Error(`Expected ok result, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

async function expectOk<T, E>(promise: Promise<BetterResult<T, E>>): Promise<T> {
  return unwrap(await promise);
}

async function expectError<T, E>(promise: Promise<BetterResult<T, E>>): Promise<E> {
  const result = await promise;
  if (Result.isOk(result)) {
    throw new Error(`Expected error result, got ${JSON.stringify(result.value)}`);
  }
  return result.error;
}

async function expectNoActiveWorkingCopy<T>(promise: Promise<BetterResult<T, { tag: string; message: string }>>, action: "apply" | "discard") {
  expect(await expectError(promise)).toEqual({
    tag: "NoActiveWorkingCopyError",
    message: `There is no active working copy to ${action}.`,
  });
}
