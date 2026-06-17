import type { RawSandboxHost } from "./sandbox-runtime";

export interface RawSandboxLease {
  id: string;
}

interface RawSandboxClient {
  writeFile(path: string, contents: string): Promise<unknown>;
  readFile(path: string): Promise<string>;
  exec(
    command: string,
    options: { cwd: string },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export type RawSandboxFactory = (
  sandboxId: string,
  options: { sleepAfter: "10m" },
) => RawSandboxClient;

export function createRawSandboxHostForLease(
  factory: RawSandboxFactory,
  lease: RawSandboxLease,
): RawSandboxHost {
  const sandbox = factory(lease.id, { sleepAfter: "10m" });

  return {
    async writeFile(path, contents) {
      await sandbox.writeFile(path, contents);
    },
    readFile(path) {
      return sandbox.readFile(path);
    },
    exec(command, options) {
      return sandbox.exec(command, options);
    },
  };
}
