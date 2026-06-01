# Product model

This doc describes what Workspace is conceptually and the principles we keep coming back to when designing it. For the in/out test, see [`product-boundaries.md`](./product-boundaries.md). For the target user-facing API, see [`product-api.md`](./product-api.md). For how it's actually built, see [`architecture.md`](./architecture.md).

## What Workspace is

A Workspace is a durable file tree. You can:

- read and write its current files directly,
- branch the current files into an isolated working copy, edit that copy, and publish or throw away the result,
- hand that working copy to a Sandbox, container, or Dynamic Worker through a runtime-appropriate projection,
- snapshot the current files into an immutable revision.

The unit of "publish" is explicit. The unit of "isolate" is explicit. Everything between those two is durable but not yet live.

## Principles

### Workspace is file state, not execution

It owns files, directories, metadata, working copies, the publish boundary, the discard boundary, and revisions.

It does not own command execution, Dynamic Worker loading, container or Sandbox lifecycle, agent orchestration, scheduling, policy, or Git remotes. Those belong to the products built on top.

### Adapters depend on Workspace; Workspace doesn't depend on adapters

Workspace defines its semantics once. Each runtime gets a projection that maps those semantics onto its conventions: `/workspace` for a Sandbox, scoped `env.WORKSPACE` for a Dynamic Worker, direct RPC for a trusted Worker.

Workspace doesn't become Sandbox-shaped, Dynamic-Worker-shaped, or container-shaped. The projection lives in the projection layer.

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

Files in a Workspace might have come from a GitHub repo, a Hugging Face model, an S3 bucket, an Artifacts ref, or a user upload. Workspace doesn't know or care. Those systems have their own lifecycles, and bridging them is product work — see [`sources.md`](./sources.md).

Workspace can record where a file came from as metadata. It does not watch the source for changes.

## Semantic model

### Durable tree

A Workspace contains a tree of files and directories. Each entry has path, type, size, and timestamps. Two categories of metadata are part of the long-term model:

- **Generic file metadata** — content type, content digest, small string metadata.
- **Provenance metadata** — adapter id, source ref, source version, source path — for files imported from an external source. See [`sources.md`](./sources.md).

Directories are explicit. `mkdir` creates one; `writeFile` requires the parent to exist; `delete` removes empty directories only. The cost is a little extra explicit work; the benefit is that capture, projections, and any tree comparison products want to build above Workspace are well-defined.

### Working copies (file copies)

A working copy is an isolated, mutable view of the tree, initialized from the current files.

You can use it directly through a Worker, expose it to a Sandbox through a filesystem projection, or hand it to a Dynamic Worker through a scoped binding. Changes inside the copy don't affect current files until commit.

Working copies are durable. They can be looked up, listed, resumed, and cleaned up without the calling product having to track their state separately.

File copies are the **isolation atom** of Workspace — the unit you fork, edit, and either publish or throw away. Implementation can vary (today it's tables inside the Workspace Durable Object; long-term it's likely Durable Object facets — see [`architecture.md`](./architecture.md)). The product model doesn't change with the implementation.

### Apply and discard

`apply` publishes a working copy to current files and creates a revision. `discard` abandons it without changing current files.

A working copy that branched from an older head version is rejected at apply (`SessionConflictError`). The product can inspect, retry, or throw it away. There's no merge or rebase yet — see [`known-limitations.md`](./known-limitations.md).

### Revisions

Revisions are immutable recovery points of current files. They carry message, actor, timestamps, and small metadata.

They are not Git commits. Workspace won't grow branches, remotes, or rebase semantics. If you need history that complex, build it above Workspace, not inside it.

### Observability

Products need to know when files change. The current model exposes a head version counter; a working copy can ask whether it's stale. Richer change streams (per-path tokens, subscriptions) can come later.

## Projections

Each projection is a different shape of access to the same durable state.

### Trusted control

Product Workers and Durable Objects use Workspace directly:

```ts
const workspace = Workspace.get(env.WORKSPACES, name);
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

Sandboxes and containers see a working copy as a local directory. The product attaches it, runs commands, captures useful changes, and decides on apply:

```ts
const copyResult = await workspace.files.copy("photo-edit");
if (Result.isError(copyResult)) return copyResult;
const copy = copyResult.value;

const attachmentResult = await copy.files.attach(sandbox, "/workspace");
if (Result.isError(attachmentResult)) return attachmentResult;
const attachment = attachmentResult.value;

const result = await sandbox.exec("convert /workspace/photos/original.jpg ... /workspace/photos/current", {
  cwd: attachment.path,
});

if (result.success) {
  const capture = await attachment.capture();
  if (Result.isError(capture)) return capture;
}

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
  env: { WORKSPACE: scopedBinding, ASSETS: createWorkspaceAssetsBinding({ tree: revision, root: "/dist" }) },
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
- Product-facing filesystem attachments and capture (used by the demo's Sandbox).
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
