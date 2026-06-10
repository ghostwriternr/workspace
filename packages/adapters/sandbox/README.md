# Workspace Sandbox adapter

`@cloudflare/workspace-adapter-sandbox` attaches a Workspace working copy to a Cloudflare Sandbox filesystem path and lets callers explicitly capture changes back into that working copy.

It is not a command runner. The Cloudflare Sandbox SDK already owns `getSandbox`, `sandbox.exec`, streaming, timeouts, environment variables, ports, sessions, sleep/destroy, and other runtime behavior. This adapter only fills the Workspace gap: make the durable working copy available at a runtime path and capture Workspace-owned changes when requested.

## What it owns

- Attaching a Workspace working copy to a Sandbox path such as `/workspace`.
- Hiding the working-copy mount descriptor used by the runtime.
- Capturing mounted filesystem changes back into the durable working copy.
- Returning attach/capture failures as `Result` values.

## What it does not own

- Sandbox lookup or lifecycle policy.
- Shell command execution.
- Streaming, ports, PTYs, sessions, or `runCode`.
- `apply()` or `discard()`.
- Agent tools, prompts, UI state, approvals, or source export.

## Usage

```ts
import { getSandbox } from "@cloudflare/sandbox";
import { Workspace } from "@cloudflare/workspace";
import { attachWorkspaceCopyToSandbox } from "@cloudflare/workspace-adapter-sandbox";

const workspaces = Workspace.bind({
  artifacts: env.ARTIFACTS,
  objects: env.WORKSPACE_OBJECTS,
});
const workspace = workspaces.get(workspaceName);
const copy = await workspace.copies.create({ label: "agent-working-copy" });
if (copy.status === "error") return copy;

const sandbox = getSandbox(env.Sandbox, `${workspaceName}-${copy.value.id}`, {
  sleepAfter: "60s",
});
const mount = await attachWorkspaceCopyToSandbox({
  copy: copy.value,
  sandbox,
  path: "/workspace",
});
if (mount.status === "error") return mount;

const command = await sandbox.exec("npm test", {
  cwd: mount.value.path,
  timeout: 120_000,
});

const capture = await mount.value.capture();
```

A nonzero command exit code is a Sandbox result, not a Workspace error. Capture is explicit and separate from command execution. Publication remains a separate product decision through `copy.apply()` or `copy.discard()`.

## Direction

The adapter is intended to use `artifact-fs` as its filesystem foundation: mount the Artifacts-backed hidden working-copy ref at `/workspace`, let Sandbox-native APIs operate on that tree, and capture dirty state back into the same working-copy ref.
