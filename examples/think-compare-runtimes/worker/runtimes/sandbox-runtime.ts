import { fixtureFileEntries } from "../../shared/fixture";

const projectRoot = "/workspace/repo";

export interface RawSandboxHost {
  writeFile(path: string, contents: string): Promise<void>;
  readFile(path: string): Promise<string>;
  exec(
    command: string,
    options: { cwd: string },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface RawSandboxRuntime {
  seedFixture(): Promise<void>;
  read(input: { path: string }): Promise<string>;
  write(input: { path: string; contents: string }): Promise<{ path: string }>;
  edit(input: { path: string; oldText: string; newText: string }): Promise<{ path: string; replacements: number }>;
  shell(input: { command: string }): Promise<{
    command: string;
    cwd: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}

export function createRawSandboxRuntime(host: RawSandboxHost): RawSandboxRuntime {
  return {
    async seedFixture() {
      for (const file of fixtureFileEntries()) {
        await host.writeFile(toProjectPath(file.path), file.contents);
      }
    },

    async read(input) {
      return host.readFile(toProjectPath(input.path));
    },

    async write(input) {
      const path = toProjectPath(input.path);
      await host.writeFile(path, input.contents);
      return { path };
    },

    async edit(input) {
      const path = toProjectPath(input.path);
      const contents = await host.readFile(path);
      const matches = countMatches(contents, input.oldText);

      if (matches !== 1) {
        throw new Error(`Expected exactly one match for ${JSON.stringify(input.oldText)}, found ${matches}`);
      }

      await host.writeFile(path, contents.replace(input.oldText, input.newText));
      return { path, replacements: 1 };
    },

    async shell(input) {
      const result = await host.exec(input.command, { cwd: projectRoot });
      return { command: input.command, cwd: projectRoot, ...result };
    },
  };
}

function toProjectPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const parts = normalized.split("/").filter(Boolean);

  if (parts.some((part) => part === "..")) {
    throw new Error("Paths must stay inside /workspace/repo");
  }

  if (normalized === projectRoot || normalized.startsWith(`${projectRoot}/`)) return normalized;
  return `${projectRoot}${normalized}`;
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
