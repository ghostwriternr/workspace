import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import { createWorkspaceSandboxCommandRunner } from "@cloudflare/workspace-adapter-sandbox";
import { sandboxNameForWorkingCopy } from "./sandbox-id";

export function createSandboxCommandRunner(
  sandboxes: DurableObjectNamespace<Sandbox>,
  workspaceName: string,
) {
  return createWorkspaceSandboxCommandRunner((workingCopyId) =>
    getSandbox(sandboxes, sandboxNameForWorkingCopy(workspaceName, workingCopyId), { sleepAfter: "60s" }),
  );
}
