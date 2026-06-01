# Workspace Dynamic Worker adapter

`@cloudflare/workspace-adapter-dynamic-worker` runs delegated Worker code with a scoped Workspace file capability.

It is an execution adapter, not Workspace core. The adapter knows how to load a Dynamic Worker and present `env.WORKSPACE` to delegated code. Product code still decides which Workspace copy to expose, which paths are readable or writable, and whether changes are applied or discarded.

## What it owns

- Loading caller-provided module code with a Worker Loader binding.
- Passing a scoped Workspace file capability through `getEntrypoint(..., { props })`.
- Keeping the RPC boundary serializable: file capability methods return `ScopedWorkspaceRpcResult` DTOs.
- Exposing ergonomic delegated-code methods that either return values or throw ordinary JavaScript errors.

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

Product code creates or recovers a Workspace file copy, then exposes a scoped file capability through a loopback `WorkerEntrypoint`.

```ts
import { Result } from "better-result";
import {
  Workspace,
  type ScopedWorkspaceFileCapability,
  type ScopedWorkspaceRpcResult,
} from "@cloudflare/workspace";
import {
  WorkspaceFileCapabilityEntrypoint,
  createWorkspaceDynamicWorkerRunner,
} from "@cloudflare/workspace-adapter-dynamic-worker";

type Props = {
  workspaceName: string;
  copyId: string;
};

export class WorkspaceFileCapability extends WorkspaceFileCapabilityEntrypoint<Env, Props> {
  protected async getWorkspaceFileCapability(): Promise<ScopedWorkspaceRpcResult<ScopedWorkspaceFileCapability>> {
    const workspace = Workspace.get(this.env.WORKSPACES, this.ctx.props.workspaceName);
    const copy = await workspace.files.getCopy(this.ctx.props.copyId);
    if (Result.isError(copy)) {
      return { status: "error", error: copy.error };
    }

    return {
      status: "ok",
      value: copy.value.files.scoped({
        read: ["/src/**"],
        write: ["/src/**", "/notes/**"],
      }),
    };
  }
}

const runner = createWorkspaceDynamicWorkerRunner(env.DYNAMIC_WORKERS);
const result = await runner.run({
  code,
  workspace: ctx.exports.WorkspaceFileCapability({
    props: { workspaceName, copyId },
  }),
});
```

Delegated code sees normal file methods:

```ts
export default async function(env) {
  const readme = await env.WORKSPACE.readFile("/README.md");
  await env.WORKSPACE.writeFile("/notes/summary.md", readme);
  return { wrote: "/notes/summary.md" };
}
```

If a Workspace operation returns an error DTO, the harness throws an ordinary `Error` inside delegated code. The runner returns delegated execution failures as `Result.err({ tag: "WorkspaceDynamicWorkerExecutionError", message })`.

Delegated code should return structured-clone-safe values. Do not return live RPC stubs from delegated workers.
