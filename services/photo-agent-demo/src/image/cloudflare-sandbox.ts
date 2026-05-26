import { getSandbox, type Sandbox } from "@cloudflare/sandbox";

import { SandboxImageEditor } from "./sandbox-image-editor";

export function createSandboxImageEditor(
  sandboxes: DurableObjectNamespace<Sandbox>,
  workspaceName: string,
): SandboxImageEditor {
  return new SandboxImageEditor(getSandbox(sandboxes, workspaceName), workspaceName);
}
