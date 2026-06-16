import { getSandbox, type Sandbox as BaseSandbox } from "@cloudflare/sandbox";
import type { WorkspaceSandboxClient } from "@cloudflare/workspace-adapter-sandbox";
import { sandboxNameForWorkingCopy } from "./sandbox-id";

export function createSandboxForWorkingCopy<T extends BaseSandbox<any>>(
  sandboxes: DurableObjectNamespace<T>,
  workspaceName: string,
): (workingCopyId: string) => WorkspaceSandboxClient {
  return (workingCopyId) =>
    getSandbox(sandboxes, sandboxNameForWorkingCopy(workspaceName, workingCopyId), { sleepAfter: "10m" });
}
