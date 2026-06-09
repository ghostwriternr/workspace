# Product model

Workspace is an agent-friendly work surface over Artifacts-backed durable file
state.

It gives products a named place to keep files, create isolated working copies,
hand those copies to runtimes, and decide when proposed work becomes current.
Artifacts owns the versioned file authority underneath. Workspace owns the
work-surface semantics above it.

For the target API, see [`product-api.md`](./product-api.md). For the current
implementation, see [`architecture.md`](./architecture.md). For boundaries, see
[`product-boundaries.md`](./product-boundaries.md).

## Core idea

A Workspace has:

- **current files** — the accepted file tree for the work surface;
- **working copies** — durable, isolated file authorities for proposed work;
- **apply** — publish one working copy as current;
- **discard** — throw away one working copy;
- **runtime projections** — ways to expose a working copy to runtimes such as
  Dynamic Workers and Sandboxes.

A working copy is durable but not published. It can survive requests, browser
reconnects, agent turns, and runtime failures. Nothing changes current files
until trusted product code applies the copy.

That is the main semantic Workspace provides:

```text
current files -> working copy -> runtime work -> apply or discard
```

## Artifacts is the file authority

Artifacts owns durable versioned file state: file trees, commits, refs, bytes,
and Git-compatible repository mechanics. Workspace does not try to recreate
that storage layer.

Workspace sits above Artifacts and adds the product shape that agents and apps
need:

- stable named workspaces;
- current files and working copies;
- scoped capabilities for delegated code;
- filesystem projection boundaries;
- explicit apply/discard semantics;
- small coordination metadata through a Durable Object.

The important distinction is:

```text
Artifacts decides how file trees are stored and versioned.
Workspace decides how product code works with those trees.
```

Workspace should not grow a parallel path-level overlay store, tombstone table,
blob store, or Git implementation while Artifacts is the chosen durable file
authority. Temporary Git plumbing exists only because current Artifacts APIs do
not yet expose every file mutation primitive Workspace needs.

## WorkspaceObject coordinates, not stores

Workspace uses a per-workspace Durable Object for coordination metadata that
Artifacts does not currently expose durably enough across Workers bindings.
That object may record coarse metadata such as:

- the current Artifacts repository/ref used by the Workspace;
- working-copy repository/ref metadata;
- labels, creation timestamps, and cleanup metadata;
- base revisions needed for safe apply/conflict checks.

It must not store:

- file bytes;
- Git objects;
- per-path overlays or tombstones;
- runtime scratch state;
- Sandbox or Dynamic Worker state;
- source-specific lifecycle state such as GitHub branches or pull requests;
- plaintext tokens.

If the coordination object starts owning path-level file semantics, Workspace is
sliding back toward a custom file backend. That is the wrong direction.

## Sources seed or export workspaces

External systems such as GitHub, Hugging Face, S3, user uploads, and other
Artifact repositories are sources. They have their own lifecycle and should
stay outside Workspace core.

A source adapter may import, capture, or seed a Workspace from an external
source. A GitHub adapter, for example, can resolve a repository ref, ask
Artifacts to capture it, and connect that Artifacts-backed authority to a
Workspace. The product action might feel like "open this GitHub repo in a
Workspace", but Workspace core should not become GitHub-aware.

Likewise, exporting a working copy back to GitHub, Hugging Face, S3, or another
destination is adapter/product behavior. Workspace exposes file state and
working-copy boundaries; adapters decide how to talk to external systems.

## Runtime adapters project working copies

Execution environments need runtime-native access to files:

- a Dynamic Worker wants a scoped `env.WORKSPACE` binding;
- a Sandbox wants files under `/workspace`;
- a future Worker Loader flow may want modules or static assets from a tree.

Runtime adapters consume Workspace capabilities and expose them in the shape a
runtime expects. Workspace itself does not run commands, load Dynamic Workers,
manage containers, install packages, or decide which command should run.

The parent product keeps publication authority. Runtime work can write a
working copy; only trusted product code applies or discards it.

## Capability boundaries

Capabilities, not runtime identity, define authority.

Trusted product code can receive a full Workspace handle. It can create working
copies, apply them, discard them, and decide source/import/export behavior.

Delegated code should receive narrower capabilities:

- a scoped file capability with read/write access under specific paths;
- a mounted filesystem view of one working copy;
- a read-only module or asset view.

Delegated code should not receive Workspace identity or apply/discard authority
unless a product intentionally grants it.

## What Workspace is not

Workspace is not:

- an execution environment;
- a Sandbox or container lifecycle manager;
- a Dynamic Worker loader;
- a Git porcelain;
- a source adapter;
- a diff, patch, merge, or rebase engine;
- a policy or approval system;
- a custom replacement for Artifacts file storage.

Workspace should stay small at the center: durable work-surface semantics over
Artifacts-backed file authorities, with adapters around it.
