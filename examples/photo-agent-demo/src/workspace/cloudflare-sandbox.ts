import { getSandbox, type Sandbox as BaseSandbox } from "@cloudflare/sandbox";
import type { WorkspaceSandboxClient } from "@cloudflare/workspace-adapter-sandbox";

export function createSandboxForDraft<T extends BaseSandbox<any>>(
  sandboxes: DurableObjectNamespace<T>,
  workspaceName: string,
): (draftEditId: string) => WorkspaceSandboxClient {
  return (draftEditId) =>
    getSandbox(sandboxes, `${workspaceName}-${draftEditId}`, { sleepAfter: "10m" });
}
