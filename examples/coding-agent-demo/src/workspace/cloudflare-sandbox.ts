import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import type { WorkspaceSandboxClient } from "@cloudflare/workspace-adapter-sandbox";
import { sandboxNameForWorkingCopy } from "./sandbox-id";

export function createSandboxForWorkingCopy(
  sandboxes: DurableObjectNamespace<Sandbox>,
  workspaceName: string,
): (workingCopyId: string) => WorkspaceSandboxClient {
  return (workingCopyId) =>
    getSandbox(sandboxes, sandboxNameForWorkingCopy(workspaceName, workingCopyId), { sleepAfter: "60s" });
}
