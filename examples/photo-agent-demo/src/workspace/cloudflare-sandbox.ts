import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import type { WorkspaceSandboxClient } from "@cloudflare/workspace-adapter-sandbox";

export function createSandboxForDraft(
  sandboxes: DurableObjectNamespace<Sandbox>,
  workspaceName: string,
): (draftEditId: string) => WorkspaceSandboxClient {
  return (draftEditId) =>
    getSandbox(sandboxes, `${workspaceName}-${draftEditId}`, { sleepAfter: "60s" });
}
