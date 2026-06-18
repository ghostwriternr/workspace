import { getSandbox, type Sandbox } from "@cloudflare/sandbox";

import type { RawSandboxFactory } from "./raw-sandbox-host";

type GetSandbox = <T extends Sandbox<any>>(
  binding: DurableObjectNamespace<T>,
  id: string,
  options: { sleepAfter: "10m" },
) => T;

export function createRawSandboxFactory<T extends Sandbox<any>>(
  sandboxes: DurableObjectNamespace<T>,
  getSandboxClient: GetSandbox = getSandbox,
): RawSandboxFactory {
  return (sandboxId, options) => {
    const sandbox = getSandboxClient(sandboxes, sandboxId, options);
    const session = sandbox.createSession({ id: `${sandboxId}-runtime`, cwd: "/" });

    return {
      async writeFile(path, contents) {
        const runtime = await session;
        const mkdir = await runtime.mkdir(parentDirectory(path), { recursive: true });
        if (!mkdir.success) throw new Error(`Sandbox mkdir failed: ${mkdir.path}`);
        const written = await runtime.writeFile(path, contents, { encoding: "utf-8" });
        if (!written.success) throw new Error(`Sandbox write failed: ${written.path}`);
      },
      async readFile(path) {
        const runtime = await session;
        const result = await runtime.readFile(path, { encoding: "utf-8" });
        if (!result.success) throw new Error(`Sandbox read failed: ${result.path}`);
        return result.content;
      },
      async exec(command, execOptions) {
        const runtime = await session;
        return runtime.exec(command, execOptions);
      },
    };
  };
}

function parentDirectory(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}
