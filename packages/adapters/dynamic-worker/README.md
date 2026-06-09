# Workspace Dynamic Worker adapter

`@cloudflare/workspace-adapter-dynamic-worker` runs delegated Worker code with a scoped Workspace file capability.

It is an execution adapter, not Workspace core. The adapter knows how to load a Dynamic Worker and pass `env.WORKSPACE` to delegated code. Product code still decides which Workspace copy to expose, which paths are readable or writable, and whether changes are applied or discarded.

## What it owns

- Loading caller-provided module code with a Worker Loader binding.
- Passing a scoped Workspace file capability through `getEntrypoint(..., { props })`.
- Keeping the delegated Worker isolated from ambient outbound access.
- Returning delegated execution failures as `Result` values.

## What it does not own

- Workspace identity or lookup.
- File-copy creation or recovery.
- `apply()` or `discard()`.
- Agent tools, prompts, UI state, approvals, or policy.
- Sandbox/container lifecycle or command execution.

## Requirements

The calling Worker must configure a Worker Loader binding and enable the runtime features required by Worker Loader. The current examples use:

```jsonc
{
  "compatibility_flags": ["nodejs_compat", "experimental"],
  "worker_loaders": [{ "binding": "DYNAMIC_WORKERS" }]
}
```

The adapter defaults delegated workers to:

- compatibility date `2026-05-26`
- compatibility flags `nodejs_compat`, `disallow_importable_env`, `experimental`
- `allowExperimental: true`
- `globalOutbound: null`

`globalOutbound: null` is intentional: delegated code gets the capabilities passed to it, not ambient network access.

## Usage

Product code creates or recovers a Workspace working copy, exposes a concrete loopback `WorkerEntrypoint` for the scoped file capability, then passes that entrypoint stub to the runner.

```ts
import { Result } from "better-result";
import { WorkerEntrypoint } from "cloudflare:workers";
import {
  Workspace,
  type ScopedWorkspaceFileCapability,
  type ScopedWorkspaceCapabilityResult,
} from "@cloudflare/workspace";
import { createWorkspaceDynamicWorkerRunner } from "@cloudflare/workspace-adapter-dynamic-worker";

export class WorkspaceFiles extends WorkerEntrypoint<Env, { workspaceName: string; copyId: string }> {
  async readFile(path: string) {
    const capability = await this.capability();
    if (capability.status === "error") return capability;
    return capability.value.readFile(path);
  }

  async writeFile(path: string, contents: Uint8Array) {
    const capability = await this.capability();
    if (capability.status === "error") return capability;
    return capability.value.writeFile(path, contents);
  }

  async list(path: string) {
    const capability = await this.capability();
    if (capability.status === "error") return capability;
    return capability.value.list(path);
  }

  async stat(path: string) {
    const capability = await this.capability();
    if (capability.status === "error") return capability;
    return capability.value.stat(path);
  }

  private async capability(): Promise<ScopedWorkspaceCapabilityResult<ScopedWorkspaceFileCapability>> {
    const workspaces = Workspace.bind({
      artifacts: this.env.ARTIFACTS,
      objects: this.env.WORKSPACE_OBJECTS,
    });
    const workspace = workspaces.get(this.ctx.props.workspaceName);
    const copy = await workspace.copies.get(this.ctx.props.copyId);
    if (Result.isError(copy)) return { status: "error", error: copy.error };

    return {
      status: "ok",
      value: copy.value.files.scoped({ read: ["/src/**"], write: ["/src/**", "/notes/**"] }),
    };
  }
}

const runner = createWorkspaceDynamicWorkerRunner(env.DYNAMIC_WORKERS);
const result = await runner.run({
  code,
  workspace: ctx.exports.WorkspaceFiles({ props: { workspaceName, copyId } }),
});
```

Delegated code sees plain-object Workspace file results:

```ts
export default async function(env) {
  const readme = await env.WORKSPACE.readFile("/README.md");
  if (readme.status === "error") return readme;

  const write = await env.WORKSPACE.writeFile("/notes/summary.md", readme.value);
  if (write.status === "error") return write;

  return { wrote: "/notes/summary.md" };
}
```

Delegated code should return structured-clone-safe values. Do not return live RPC stubs from delegated workers.
