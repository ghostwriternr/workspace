import { getSandbox, type Sandbox } from "@cloudflare/sandbox";

import { SandboxWorkspaceCommandRunner } from "./sandbox-workspace-command-runner";

export function createSandboxWorkspaceCommandRunner(
  sandboxes: DurableObjectNamespace<Sandbox>,
  workspaceName: string,
): SandboxWorkspaceCommandRunner {
  return new SandboxWorkspaceCommandRunner((draftEditId) =>
    getSandbox(sandboxes, `${workspaceName}-${draftEditId}`, { sleepAfter: "60s" }),
  );
}
