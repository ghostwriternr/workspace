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

    return {
      async writeFile(path, contents) {
        await sandbox.writeFile(path, contents);
      },
      async readFile(path) {
        const result = await sandbox.readFile(path, { encoding: "utf-8" });
        return result.content;
      },
      exec(command, execOptions) {
        return sandbox.exec(command, execOptions);
      },
    };
  };
}
