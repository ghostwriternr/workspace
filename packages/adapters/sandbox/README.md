# Workspace Sandbox adapter

`@cloudflare/workspace-adapter-sandbox` runs shell commands with a Workspace file copy mounted at a runtime path such as `/workspace`.

It is an execution adapter, not Workspace core. The adapter knows how to attach a file copy to a Sandbox-like filesystem, run a command, and reconcile Workspace-owned mounted files back into the copy after the command exits. Product code still decides which copy to expose and whether that copy is applied or discarded.

## What it owns

- Materializing a Workspace file copy into a Sandbox-compatible filesystem host.
- Running a shell command with `cwd` set to the mounted root.
- Reconciling mounted Workspace-owned files back into the copy after command completion.
- Returning mount, command, and reconcile failures as `Result` values.

## What it does not own

- Workspace identity or lookup.
- File-copy creation or recovery.
- `apply()` or `discard()`.
- Agent tools, prompts, UI state, approvals, or policy.
- Runtime-local cache semantics such as `node_modules` preservation.

## Usage

```ts
import { getSandbox } from "@cloudflare/sandbox";
import { Workspace } from "@cloudflare/workspace";
import { createWorkspaceSandboxCommandRunner } from "@cloudflare/workspace-adapter-sandbox";

const workspaces = Workspace.bind({
  artifacts: env.ARTIFACTS,
  objects: env.WORKSPACE_OBJECTS,
});
const workspace = workspaces.get(workspaceName);
const copy = await workspace.copies.create({ label: "agent-working-copy" });
if (copy.status === "error") return copy;

const runner = createWorkspaceSandboxCommandRunner((copyId) =>
  getSandbox(env.Sandbox, `${workspaceName}-${copyId}`, { sleepAfter: "60s" }),
);

const result = await runner.runCommand({
  files: copy.value.files,
  sandboxId: copy.value.id,
  root: "/workspace",
  command: "npm test",
});
```

A nonzero exit code is a command result, not a Workspace error. Files written under the mounted root are reconciled after the command exits. Publication remains a separate product decision through `copy.apply()` or `copy.discard()`.
