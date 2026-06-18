import { fixtureFileEntries } from "../../shared/fixture";

const sandboxProjectRoot = "/workspace";

export interface WorkspaceBackedRuntimeHost {
  writeFile(path: string, contents: string): Promise<void>;
  readFile(path: string): Promise<string>;
  runDynamicWorker(code: string): Promise<unknown>;
  runSandboxCommand(
    command: string,
    options: { cwd: string },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  captureSandboxChanges(): Promise<void>;
}

export interface WorkspaceBackedRuntime {
  seedFixture(): Promise<void>;
  read(input: { path: string }): Promise<string>;
  write(input: { path: string; contents: string }): Promise<{ path: string }>;
  edit(input: { path: string; oldText: string; newText: string }): Promise<{ path: string; replacements: number }>;
  run(input: { code: string }): Promise<{ executionTarget: "dynamic-worker"; result: unknown }>;
  shell(input: { command: string }): Promise<{
    command: string;
    cwd: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}

export function createWorkspaceBackedRuntime(host: WorkspaceBackedRuntimeHost): WorkspaceBackedRuntime {
  return {
    async seedFixture() {
      for (const file of fixtureFileEntries()) {
        await host.writeFile(toWorkspacePath(file.path), file.contents);
      }
    },

    async read(input) {
      return host.readFile(toWorkspacePath(input.path));
    },

    async write(input) {
      const path = toWorkspacePath(input.path);
      await host.writeFile(path, input.contents);
      return { path };
    },

    async edit(input) {
      const path = toWorkspacePath(input.path);
      const contents = await host.readFile(path);
      const matches = countMatches(contents, input.oldText);

      if (matches !== 1) {
        throw new Error(`Expected exactly one match for ${JSON.stringify(input.oldText)}, found ${matches}`);
      }

      await host.writeFile(path, contents.replace(input.oldText, input.newText));
      return { path, replacements: 1 };
    },

    async run(input) {
      return { executionTarget: "dynamic-worker", result: await host.runDynamicWorker(input.code) };
    },

    async shell(input) {
      const result = await host.runSandboxCommand(input.command, { cwd: sandboxProjectRoot });
      await host.captureSandboxChanges();
      return { command: input.command, cwd: sandboxProjectRoot, ...result };
    },
  };
}

function toWorkspacePath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const parts = normalized.split("/").filter(Boolean);

  if (parts.some((part) => part === "..")) {
    throw new Error("Paths must stay inside the Workspace copy");
  }

  if (normalized === sandboxProjectRoot || normalized.startsWith(`${sandboxProjectRoot}/`)) {
    return normalized.slice(sandboxProjectRoot.length) || "/";
  }

  return normalized;
}

function countMatches(contents: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = contents.indexOf(needle);

  while (index !== -1) {
    count += 1;
    index = contents.indexOf(needle, index + needle.length);
  }

  return count;
}
