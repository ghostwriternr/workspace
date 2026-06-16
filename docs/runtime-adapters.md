# Runtime adapters

Runtime adapters make Workspace working copies usable from execution
environments. They are adapters over Workspace semantics, not part of Workspace
core.

For the product model, see [`product-model.md`](./product-model.md). For API
shape, see [`product-api.md`](./product-api.md). For implementation, see
[`architecture.md`](./architecture.md).

## Boundary

Workspace owns durable file work-surface semantics:

```text
current files -> working copy -> apply or discard
```

Runtime adapters own runtime mechanics:

- Dynamic Worker loading;
- Sandbox/container lifecycle;
- command execution;
- filesystem materialization;
- runtime-local caches and scratch;
- mapping runtime IO back into a working copy.

The parent product owns user intent and publication. Runtime work can propose
file changes by writing a working copy; it does not publish current files.

## Dynamic Worker adapter

A Dynamic Worker receives a scoped file capability, usually exposed to the
delegated code as `env.WORKSPACE`.

```ts
import { createWorkspaceDynamicWorkerRunner } from "@cloudflare/workspace-adapter-dynamic-worker";

const runner = createWorkspaceDynamicWorkerRunner(env.DYNAMIC_WORKERS);

await runner.run({
  code,
  workspace: copy.files.scoped({ read: "/**", write: "/**" }),
});
```

In practice the scoped capability is built inside a parent `WorkerEntrypoint`
so the delegated Worker receives a live RPC stub (a directly-constructed
`RpcTarget` cannot cross the Worker Loader boundary). The dynamic-worker
adapter README shows that loopback pattern in full.

Delegated code sees plain file methods:

```ts
await env.WORKSPACE.readFile("/src/index.ts");
await env.WORKSPACE.writeFile("/src/index.ts", bytes);
await env.WORKSPACE.list("/src");
await env.WORKSPACE.stat("/src/index.ts");
```

It does not receive Workspace identity, arbitrary lookup, apply/discard, source
export authority, or Artifacts handles.

This is the preferred runtime for lightweight Worker-native inspection and file
updates. It avoids container startup and keeps authority narrow.

## Sandbox adapter

A Sandbox receives a filesystem view of one working copy, normally under
`/workspace`.

```ts
import { attachWorkspaceCopyToSandbox } from "@cloudflare/workspace-adapter-sandbox";
import { getSandbox } from "@cloudflare/sandbox";

const sandbox = getSandbox(env.Sandbox, `${workspaceName}-${copy.id}`, {
  sleepAfter: "10m",
});
const mount = await attachWorkspaceCopyToSandbox({
  copy,
  sandbox,
  path: "/workspace",
});
if (Result.isError(mount)) return mount;

const result = await sandbox.exec("npm test", { cwd: mount.value.path });
const capture = await mount.value.capture();
```

The Sandbox SDK owns command execution, streaming, environment variables,
timeouts, ports, sessions, and lifecycle. The Workspace Sandbox adapter owns a
smaller seam: attach the durable working copy at a runtime path and capture
Workspace-owned changes back into that copy when product or agent code asks.
The adapter package also provides the local Sandbox base image contract used by
examples: `workspace-mount`, `workspace-capture`, `artifact-fs`, `git`, and
FUSE dependencies. Local FUSE dev is opt-in through a patched `workerd`
installed by `just install-fuse-workerd`; normal dev and production behavior do
not use that binary.

Use Sandbox when the task needs process execution, package managers, native
binaries, or a filesystem-heavy toolchain.

### Current implementation

The Sandbox adapter uses
[`artifact-fs`](https://github.com/cloudflare/artifact-fs) over the
Artifacts-backed working-copy ref. The current local base image builds
`artifact-fs` without blobless clone filtering because the Artifacts Git
endpoint does not yet support that partial-clone contract reliably.

Flow:

```text
Workspace working-copy ref
  -> artifact-fs FUSE mount at /workspace
  -> command runs against a normal Git working tree
  -> adapter captures dirty worktree state into the working-copy ref
  -> copy.apply() or copy.discard() remains a product decision
```

`artifact-fs` owns the runtime filesystem mechanics: lazy blob hydration,
copy-on-write writes, local filesystem behavior, and Git-compatible working tree
operations. The adapter package owns the small wrapper commands that adapt
Workspace's hidden working-copy refs to the current `artifact-fs` CLI. Workspace
should not rebuild those mechanics in WorkspaceObject or in a path-level
overlay store.

Sandbox outbound Workers/TLS auth should be the credential boundary for this
flow. The Sandbox should mount a token-free HTTPS Artifacts remote, while a
trusted outbound handler injects short-lived Artifacts Git credentials outside
the container. The first version should keep that handler narrow: one working
copy, one Artifacts Git host, HTTPS only, and no general egress policy system.

Capture is not publication. A command may commit and push changes to the
working-copy Artifacts ref; current files still do not change until trusted
product code calls `copy.apply()`.

## Runtime-local state

Some runtime paths are intentionally not Workspace-owned. Examples:

- `node_modules`;
- `.venv`;
- compiler caches;
- temporary files;
- downloaded toolchains;
- build scratch directories.

These are runtime-local authorities with their own lifecycle. They are not
"Workspace files excluded by a pattern." Treating them as separate authority is
what lets products preserve useful caches without accidentally publishing them.

The current Sandbox adapter mounts one Workspace-owned working-copy path.
Richer runtime-local mount handling is future work.

## Future projections

Future adapters may expose Workspace trees as:

- Worker Loader modules;
- static asset bindings;
- read-only revision views;
- preview deployments;
- long-lived container mounts.

Those adapters should keep the same boundary: execution can read/write a scoped
or mounted working copy; trusted product code decides apply/discard/export.

## What runtime adapters should not do

Runtime adapters should not:

- decide whether a working copy is published;
- store durable file authority independent of Workspace/Artifacts;
- expose Workspace identity to delegated code by default;
- implement source-specific lifecycle such as GitHub PRs;
- introduce Git branch/rebase/merge semantics into Workspace;
- hide whether runtime changes were captured into durable state.

Adapters should be explicit at semantic boundaries and quiet about routine
plumbing.
