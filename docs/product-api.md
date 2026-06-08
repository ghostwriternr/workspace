# Product API

This doc describes the user-facing API we want product code (and agent tools) to see for today's Workspace-owned file trees. The current-files, file-copy, filesystem mount/reconciliation, and scoped file layers exist today. See [`architecture.md`](./architecture.md) for how the lower layers work, and `examples/photo-agent-demo` for the proving ground.

For the conceptual model behind these names, see [`product-model.md`](./product-model.md). For the broader mounted-view direction — source snapshots, runtime-local mounts, overlays, and runtime adapters — see [`runtime-projections.md`](./runtime-projections.md).

## Current product shape

A product or agent author should be able to read Workspace code and follow it without knowing about Artifacts handles, temporary Git plumbing, RPC stubs, loopback entrypoints, or projection internals. For a Workspace-owned tree, they should see:

```
current files
  → file copy
  → attach to a runtime
  → reconcile changes
  → apply or discard
```

```ts
const workspace = Workspace.fromArtifacts(env.ARTIFACTS, "family-photo");

const write = await workspace.files.write("/photos/original.jpg", imageBytes);
if (Result.isError(write)) return write;

const copyResult = await workspace.files.copy("crop-square");
if (Result.isError(copyResult)) return copyResult;
const copy = copyResult.value;

const mountResult = await copy.files.attach(sandbox, "/workspace");
if (Result.isError(mountResult)) return mountResult;
const mount = mountResult.value;

const result = await sandbox.exec(
  "convert photos/original.jpg -gravity center -crop 1024x1024+0+0 +repage photos/current",
  { cwd: mount.path },
);

const reconcile = await mount.reconcile();
if (Result.isError(reconcile)) return reconcile;

const apply = await copy.apply(); // or: await copy.discard();
if (Result.isError(apply)) return apply;
```

The intent is intentionally boring. Product code says what it wants; the lower layers handle the plumbing. Expected Workspace failures are `Result` values, not thrown exceptions or raw RPC DTOs.

## Vocabulary

| Term          | Meaning                                                   |
| ------------- | --------------------------------------------------------- |
| Workspace     | The durable file-state resource.                          |
| Current files | The Workspace's live, durable file tree.                  |
| File copy     | An isolated, durable, mutable copy of current files.      |
| Mount         | A way for a runtime to access a file copy.                |
| Reconcile     | Bring Workspace-owned mounted file changes back into the file copy. |
| Apply         | Make a file copy become the current files.                |
| Discard       | Throw away a file copy without changing current files.    |
| Scoped files  | Limited file access granted to delegated code.            |

We avoid implementation terms (Git remote, token, RPC result, stub disposal, loopback, projection, mount host) at the surface. They can exist underneath.

## Current files and file copies

`workspace.files` is the current tree.

```ts
await workspace.files.read(path); // Result<Uint8Array, WorkspaceCurrentFileError>
await workspace.files.write(path, bytes); // Result<void, WorkspaceCurrentFileError>
await workspace.files.list(path);
await workspace.files.stat(path);
await workspace.files.delete(path);
```

`workspace.files.copy(name)` creates a durable, isolated, mutable copy initialised from the current files.

```ts
const copyResult = await workspace.files.copy("agent-edit");
if (Result.isError(copyResult)) return copyResult;

const copy = copyResult.value;
const write = await copy.files.write("/notes/summary.md", bytes);
if (Result.isError(write)) return write;
```

A copy is durable but not live. It can outlive a request, an agent turn, or a process. Applying is a separate decision.

## Writing many files

Source adapters, uploads, and anything that materialises a tree of files at once shouldn't have to call `write` per file and `mkdir` per directory. File copies can write a tree under an explicit Workspace root:

```ts
await copy.files.writeTree("/generated", entries);
```

The root is an absolute Workspace directory path. Entry paths are relative to that root. Entries may be an array, a sync iterable, or an async iterable, so source adapters can yield files as they discover them instead of buffering the whole tree.

```ts
const copyResult = await workspace.files.copy("github-import");
if (Result.isError(copyResult)) return copyResult;

const copy = copyResult.value;
const imported = await copy.files.writeTree("/repo", githubSource.files());
if (Result.isError(imported)) {
  await copy.discard();
  return imported;
}

const applied = await copy.apply();
if (Result.isError(applied)) return applied;
```

Workspace validates and writes bounded batches into the copy. A batch is all-or-nothing, but the whole source stream is staged in the copy over time. Sources yield plain file entries. If reading the source stream fails, `writeTree` returns `WorkspaceTreeSourceError`; discard the copy. Current files are unchanged until `apply()` succeeds.

Absolute entry paths, traversal segments, empty segments, and NUL bytes are rejected. Parent paths are materialized as needed by the underlying file authority. Existing files may be overwritten. If a source yields the same path more than once, the later entry wins. Omitted files are left alone; this is materialization, not sync, diff, or replace.

Batches are bounded by entry count and accumulated content bytes before they cross into the Workspace write layer. A single entry larger than the batch byte limit returns `WorkspaceTreeEntryTooLargeError`.

Bulk import is the natural integration point for source adapters — see [`sources.md`](./sources.md).

## Filesystem mounts and reconciliation

Mounts are the current stepping stone for making file copies usable from a runtime. For Sandboxes and containers, that means files appear under a local path like `/workspace`.

```ts
const mountResult = await copy.files.attach(sandbox, "/workspace");
if (Result.isError(mountResult)) return mountResult;

const mount = mountResult.value;
await sandbox.exec("npm test", { cwd: mount.path });
const reconcile = await mount.reconcile();
if (Result.isError(reconcile)) return reconcile;
```

`reconcile()` is the mount's responsibility, not the copy's. It records execution-local file changes back into the file copy.

This distinction exists because not every runtime is a live mount. Today's Sandbox integration materialises files into the container and reads changes back on reconcile. A future native mount might make reconcile automatic or unnecessary — but the product-level model stays the same: execution changes become file-copy state before they become current Workspace state.

This mount API is narrower than the mounted-view model in [`runtime-projections.md`](./runtime-projections.md). It does not yet express source bases, runtime-local child mounts, overlays, refresh, or generation checks.

Reconcile is not publication. Reconciled files are still isolated in the copy.

## Apply and discard

`apply()` is the only publication path from a file copy to current files.

```ts
const applied = await copy.apply();
if (Result.isError(applied)) return applied;
```

After apply, current Workspace files reflect the copy; a recovery point can be created.

`discard()` abandons a file copy without changing current files.

```ts
const discarded = await copy.discard();
if (Result.isError(discarded)) return discarded;
```

Two different boundaries, two different verbs:

```
reconcile: runtime projection changes become durable in the copy
apply:     this copy becomes current Workspace files
```

Reconcile is runtime-adapter plumbing. Apply should reflect product or user intent.

## Scoped files for delegated code

Delegated code (Dynamic Workers, plugins, generated code) should usually get a scoped file capability, not Workspace identity.

```ts
const files = copy.files.scoped({
  read: "/input/**",
  write: "/output/**",
});

await dynamicWorker.run({
  code,
  env: { WORKSPACE: files },
});
```

Inside the delegated code:

```ts
await env.WORKSPACE.readFile("/input/data.json");
await env.WORKSPACE.writeFile("/output/result.json", bytes);
await env.WORKSPACE.list("/input");
await env.WORKSPACE.stat("/input/data.json");
```

A scoped file capability should expose familiar file operations and nothing more. No Workspace identity, no arbitrary lookup, no apply/discard, no revision management.

## Two audiences, one API

Platform developers use the primitives directly:

```ts
const copyResult = await workspace.files.copy("edit");
if (Result.isError(copyResult)) return copyResult;

const copy = copyResult.value;
const mountResult = await copy.files.attach(sandbox, "/workspace");
if (Result.isError(mountResult)) return mountResult;

const mount = mountResult.value;
const result = await sandbox.exec(command, { cwd: mount.path });
const reconcile = await mount.reconcile();
if (Result.isError(reconcile)) return reconcile;

const applied = await copy.apply();
if (Result.isError(applied)) return applied;
```

Agents get tool-shaped versions of the same model:

```
open file copy
attach copy to sandbox
run sandbox command
reconcile sandbox changes
inspect copy files
apply copy
discard copy
```

Tool descriptions should stay concrete:

```
Reconcile files changed under /workspace in the Sandbox into the active file copy.
This keeps the result for preview or further edits, but does not change current Workspace files.
```

## What product code shouldn't need to do

Out of the happy path:

- managing Artifacts repository handles or tokens,
- handling temporary Git remotes directly,
- branching on raw transport result shapes,
- disposing RPC stubs,
- knowing about loopback entrypoint transport,
- constructing scoped capability plumbing by hand,
- understanding Sandbox mount-host internals,
- creating parent directories before every `writeFile`.

These details belong in lower layers. They shouldn't be the first thing a product developer or agent author sees.

## Boundary rules

- Workspace does not run commands.
- Workspace does not own Sandbox, container, or Dynamic Worker lifecycle.
- A runtime does not decide when a copy becomes current.
- Reconcile does not imply apply.
- Apply should be explicit and product-visible.
- Products choose their own user-facing language. A photo app may say "draft"; a code product may say "preview". Workspace stays generic underneath.

## Current gap

The prototype now exposes current files, durable file copies, filesystem mounts, reconciliation, scoped file capabilities, `apply()`, and `discard()` through this product-facing layer.

Future implementation should be judged by whether code like `examples/photo-agent-demo` can express runtime delegation in these terms without exposing raw Workspace machinery.
