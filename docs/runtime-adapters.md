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

A Dynamic Worker receives a scoped file capability, usually as
`env.WORKSPACE`.

```ts
await dynamicWorker.run({
  copy,
  code,
  scope: {
    read: "/**",
    write: "/**",
  },
});
```

Delegated code sees file methods:

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
const result = await sandbox.run({
  copy,
  command: "npm test",
  root: "/workspace",
});
```

Use Sandbox when the task needs process execution, package managers, native
binaries, or a filesystem-heavy toolchain.

### Current implementation

The current adapter is intentionally simple:

1. materialize the working copy into the Sandbox path;
2. run the command with an appropriate working directory;
3. scan the mounted path after the command;
4. write changed regular files back into the working copy;
5. return command output and reconcile information.

This proves the Workspace publication boundary, but it is not the desired
long-term Sandbox filesystem implementation.

### Target implementation direction

The Sandbox adapter should move toward
[`artifact-fs`](https://github.com/cloudflare/artifact-fs) over the
Artifacts-backed working-copy ref.

Target flow:

```text
Workspace working-copy ref
  -> artifact-fs FUSE mount at /workspace
  -> command runs against a normal Git working tree
  -> adapter captures dirty worktree state into the working-copy ref
  -> copy.apply() or copy.discard() remains a product decision
```

`artifact-fs` owns the runtime filesystem mechanics: lazy blob hydration,
copy-on-write writes, local filesystem behavior, and Git-compatible working tree
operations. Workspace should not rebuild those mechanics in WorkspaceObject or
in a path-level overlay store.

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

The current Sandbox adapter is still simple: it materializes and scans a working
copy path. Richer runtime-local mount handling is future work.

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
- hide whether runtime changes were reconciled into durable state.

Adapters should be explicit at semantic boundaries and quiet about routine
plumbing.
