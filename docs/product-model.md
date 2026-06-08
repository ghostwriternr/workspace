# Product model

This doc describes what Workspace is conceptually and the principles we keep coming back to when designing it. For the in/out test, see [`product-boundaries.md`](./product-boundaries.md). For the target user-facing API, see [`product-api.md`](./product-api.md). For the emerging runtime vocabulary, see [`runtime-projections.md`](./runtime-projections.md). For how it's actually built, see [`architecture.md`](./architecture.md).

## What Workspace is

A Workspace is a durable file tree. You can:

- read and write its current files directly,
- branch the current files into an isolated working copy, edit that copy, and publish or throw away the result,
- hand that working copy to a Sandbox, container, or Dynamic Worker through a runtime-appropriate projection,
- snapshot the current files into an immutable revision.

The unit of "publish" is explicit. The unit of "isolate" is explicit. Everything between those two is durable but not yet live.

## Principles

### Workspace is file state, not execution

It owns the Workspace-owned file tree: files, directories, metadata, working copies, the publish boundary, the discard boundary, and revisions.

It does not own command execution, Dynamic Worker loading, container or Sandbox lifecycle, agent orchestration, scheduling, policy, or Git remotes. Those belong to the products built on top.

### Adapters depend on Workspace; Workspace doesn't depend on adapters

Workspace defines its semantics once. Runtime adapters consume those semantics and project Workspace-owned authorities, or mounted views containing them, into runtime-native shapes: `/workspace` for a Sandbox, scoped `env.WORKSPACE` for a Dynamic Worker, direct RPC for a trusted Worker.

Workspace doesn't become Sandbox-shaped, Dynamic-Worker-shaped, or container-shaped. Runtime mechanics live in adapters and projection layers.

### Capabilities are the boundary

What a caller can do with a Workspace depends on the capability it received, not on which runtime is calling.

Trusted product code can receive full control: identity, file copies, apply, discard, revisions. Delegated code (Dynamic Worker, plugin, generated code) should usually receive a scoped file capability: read or write under specific paths, no apply authority, no Workspace identity.

A Sandbox or container sees a filesystem; the publish decision stays with the parent.

### Durable doesn't mean published

A working copy is durable. It survives crashes, reconnects, and agent turns. That's deliberate — agent and human workflows want to step away and come back to in-progress work.

But durable isn't the same as live. The current files don't change until apply. This matters for previews, drafts, multi-turn agent work, and Dynamic Worker test runs.

### Apply and discard are explicit

Workspace never publishes implicitly. Not when a process writes a file. Not when a command exits. Not when a Dynamic Worker returns. Not when a Sandbox shuts down. Not because execution succeeded.

The publish operation is `apply`. The escape hatch is `discard`. A product can call them "make current" and "throw away", but the semantic is the same.

### Product concepts stay above Workspace

Workspace doesn't know about original photos, draft edits, code artifacts, agent tasks, or approval rules. Products express those through their own controllers and domain language. Workspace gives them the durable file substrate to do it on.

### Sources are not Workspace

Files in a Workspace might have come from a GitHub repo, a Hugging Face model, an S3 bucket, an Artifacts ref, or a user upload. If a product imports those bytes, Workspace owns the imported file state. If a product mounts a stable source snapshot beside a Workspace-owned overlay, the source still owns unchanged source bytes. Bridging those systems is product/source-adapter work — see [`sources.md`](./sources.md).

Workspace can record where imported files came from as metadata. It does not watch the source for changes.

## Semantic model

### Durable tree

A Workspace contains a tree of Workspace-owned files and directories. Each entry has path, type, size, and timestamps. A product may compose that tree with external source authorities in a mounted view, but those source-owned files are not automatically Workspace entries. Two categories of metadata are part of the long-term model:

- **Generic file metadata** — content type, content digest, small string metadata.
- **Provenance metadata** — adapter id, source ref, source version, source path — for files imported from an external source. See [`sources.md`](./sources.md).

Directories are explicit. `mkdir` creates one; `writeFile` requires the parent to exist; `delete` removes empty directories only. The cost is a little extra explicit work; the benefit is that reconcile, projections, and any tree comparison products want to build above Workspace are well-defined.

### Working copies (file copies)

A working copy is an isolated, mutable view of Workspace-owned file state, usually initialized from current files.

You can use it directly through a Worker, expose it to a Sandbox through a filesystem projection, or hand it to a Dynamic Worker through a scoped binding. In source-backed project views, a working copy can act as the writable overlay on top of a stable source snapshot. Changes inside the copy don't affect current files until apply, and they don't affect external sources until product export.

Working copies are durable. They can be looked up, listed, resumed, and cleaned up without the calling product having to track their state separately.

File copies are the **isolation atom** of Workspace — the unit you fork, edit, and either publish or throw away. Today they are Artifacts forks behind the Workspace API. The product model doesn't change with the implementation.

### Apply and discard

`apply` publishes a working copy to current files and creates a revision. `discard` abandons it without changing current files.

A working copy can be rejected at apply if the underlying authority cannot publish it cleanly. The product can retry, export, or throw it away. There's no merge or rebase in Workspace — see [`product-boundaries.md`](./product-boundaries.md).

### Revisions

Revisions are immutable recovery points of current files. They carry message, actor, timestamps, and small metadata.

They are not Git commits. Workspace won't grow branches, remotes, or rebase semantics. If you need history that complex, build it above Workspace, not inside it.

### Observability

Products need to know when files change. Today they generally refresh state after explicit Workspace operations. Richer change streams (per-path tokens, subscriptions) can come later when real callers need them.

## Projections

Each current projection is a different shape of access to Workspace-owned durable state. The broader model also allows mounted views that compose Workspace-owned overlays with source snapshots and runtime-local authorities; see [`runtime-projections.md`](./runtime-projections.md).

### Trusted control

Product Workers and Durable Objects use Workspace directly:

```ts
const workspace = Workspace.fromArtifacts({
  artifacts: env.ARTIFACTS,
  object: env.WORKSPACE_OBJECTS.getByName(name),
  name,
});
const copyResult = await workspace.files.copy("edit");
if (Result.isError(copyResult)) return copyResult;

const copy = copyResult.value;
const write = await copy.files.write("/src/index.ts", source);
if (Result.isError(write)) return write;

const apply = await copy.apply();
if (Result.isError(apply)) return apply;
```

Appropriate for code that owns user intent and decides apply/discard.

### Scoped file capability

Delegated code gets familiar file methods, but only within the authority granted by the parent:

```ts
await env.WORKSPACE.readFile("/data/input.json");
await env.WORKSPACE.writeFile("/output/result.json", bytes);
await env.WORKSPACE.list("/data");
```

Bounded by root prefix, read globs, write globs, optional delete, no apply authority, no Workspace identity. This is what Dynamic Workers get.

### Filesystem

Sandboxes and containers see a working copy, or a mounted view containing a working copy, as a local directory. The product attaches it, runs commands, reconciles Workspace-owned mounted paths back into the working copy, and decides on apply or export:

```ts
const copyResult = await workspace.files.copy("photo-edit");
if (Result.isError(copyResult)) return copyResult;
const copy = copyResult.value;

const mountResult = await copy.files.attach(sandbox, "/workspace");
if (Result.isError(mountResult)) return mountResult;
const mount = mountResult.value;

const result = await sandbox.exec(
  "convert /workspace/photos/original.jpg ... /workspace/photos/current",
  {
    cwd: mount.path,
  },
);

const reconcile = await mount.reconcile();
if (Result.isError(reconcile)) return reconcile;

const apply = await copy.apply();
if (Result.isError(apply)) return apply;
```

The implementation may be FUSE, a native mount, or a Sandbox-specific mechanism. Workspace is not defined as FUSE and won't chase full distributed POSIX. Unsupported filesystem features should fail clearly.

### Dynamic Worker module and asset (planned)

A Workspace tree or revision can provide module sources and asset bindings to a Worker loaded via Worker Loader:

```ts
const worker = env.LOADER.load({
  mainModule: "src/index.js",
  modules: await modulesFromWorkspace(copy, "/src"),
  env: {
    WORKSPACE: scopedBinding,
    ASSETS: createWorkspaceAssetsBinding({ tree: revision, root: "/dist" }),
  },
});
```

Useful for code-mode previews, generated apps, and user-uploaded platforms. Not built yet.

## Authority

The distinction that matters is authority, not runtime type.

- **Trusted code** can receive Workspace identity and control capabilities. It owns apply and discard.
- **Delegated code** should usually receive a scoped capability and propose changes within a working copy. The parent decides whether to publish.
- **Filesystem tools** mutate files naturally inside a working copy. Those mutations stay in the copy until the parent applies it.

The safety rule is consistent across all three:

```
Execution can propose file-state changes.
Trusted product code decides whether to publish them.
```

## Where we are

Built:

- Durable head tree with explicit directories.
- Content-addressed blobs in R2.
- Durable working copies, recoverable by id.
- Optimistic conflict detection on apply.
- Immutable revisions.
- Product-facing scoped file capabilities (used by the demo's Dynamic Worker).
- Product-facing filesystem mounts and reconciliation (used by the demo's Sandbox).
- Streaming bulk tree writes (`writeTree`) on file copies.

Not built yet — see [`known-limitations.md`](./known-limitations.md):

- Provenance metadata for files imported from external sources.
- Generic file metadata (content type, digest).
- File-copy cleanup / orphan recovery.
- Production filesystem projection (no scan, no rehash).
- Dynamic Worker module and asset projections.

Deliberately out of scope:

- Diff, patch, merge, or rebase between trees. Workspace inventories trees; it doesn't compare them.
- Full POSIX, Git semantics, agent orchestration, Dynamic Worker loading, Sandbox lifecycle, policy systems. See [`product-boundaries.md`](./product-boundaries.md).
