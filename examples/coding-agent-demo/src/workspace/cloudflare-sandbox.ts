import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import { createWorkspaceSandboxCommandRunner } from "@cloudflare/workspace-adapter-sandbox";

export function createSandboxCommandRunner(
  sandboxes: DurableObjectNamespace<Sandbox>,
  workspaceName: string,
) {
  return createWorkspaceSandboxCommandRunner((workingCopyId) =>
    getSandbox(sandboxes, `${workspaceName}-${workingCopyId}`, { sleepAfter: "60s" }),
  );
}
