# Architecture

This is the "how it actually works" doc. For the conceptual model and why the pieces exist, see [`product-model.md`](./product-model.md). For boundaries and the in/out test, see [`product-boundaries.md`](./product-boundaries.md).

## The problem

Every product on Cloudflare that does interesting work with files ends up reinventing the same thing:

- An agent in a Sandbox edits files under `/workspace`. The parent Worker then has to copy results into something durable and stitch metadata back together.
- A Dynamic Worker loaded via Worker Loader wants source files and assets.
- A multi-step agent wants a working copy it can iterate on, preview, and only sometimes publish.
- Two concurrent users need isolated file state instead of shared runtime scratch space.

Workspace gives those products one shared primitive: a durable file tree with isolated working copies, an explicit publish boundary, and projections shaped to fit each runtime that needs to read or write the files.

## The current Workspace-owned model in five lines

```
current files         durable head of a Workspace
file copy             durable, isolated, mutable view of current files
attach                make a file copy visible to a runtime (Sandbox, Dynamic Worker, …)
apply / discard       publish the file copy to current files, or throw it away
revisions             immutable recovery points of current files
```

Two rules carry most of the weight:

1. A file copy is **durable but not published**. It survives across requests, agent turns, and process failures. Only `apply()` makes it current.
2. Workspace **never publishes implicitly**. Not when a Sandbox exits, not when a Dynamic Worker returns, not because a command succeeded. The parent decides.

The current product API lives in [`product-api.md`](./product-api.md). The broader mounted-view vocabulary lives in [`runtime-projections.md`](./runtime-projections.md).

## Current projections

Different runtimes need different shapes of access to Workspace-owned state. The current implementation exposes these projections over current files and file copies:

| Projection               | Consumer                               | Shape                                                       | Authority                                                  |
| ------------------------ | -------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| Control                  | Trusted Worker / DO                    | `Workspace.fromArtifacts(...)`, current files, file copies, `apply()` | Full: file copies, apply, discard, revisions       |
| Scoped file              | Dynamic Worker, plugin, generated code | `env.WORKSPACE.{readFile,writeFile,list,stat}`              | Read/write within allowed paths; no apply, no identity     |
| Filesystem               | Sandbox / container                    | Files at `/workspace`; explicit reconcile                   | Native file IO inside the runtime; apply stays with parent |
| Module / asset (planned) | Dynamic Worker via Worker Loader       | Modules and asset bindings from a Workspace tree            | Read-only over the chosen tree or revision                 |

The first three are built for Workspace-owned file copies. Module/asset projections are documented in [`known-limitations.md`](./known-limitations.md). The broader mounted-view model, where projections can compose Workspace-owned overlays with source and runtime-local authorities, is described in [`runtime-projections.md`](./runtime-projections.md).

## How a Workspace is built

`packages/workspace` is anchored around Artifacts:

- `Workspace.fromArtifacts({ artifacts, object, name })` creates the product-facing Workspace object.
- Artifacts owns the durable/versioned repository.
- `WorkspaceObject` stores per-Workspace control metadata needed to use Artifacts reliably from Workers.
- Workspace presents current files, file copies, scoped capabilities, attach/reconcile, apply, and discard above those authorities.
- Temporary internal `isomorphic-git` plumbing fills the current gap until Artifacts exposes direct file mutation APIs.

The public package surface does not expose Git, Artifacts repository handles, temporary clone state, or the old storage/runtime internals. Callers work in Workspace terms.

### Current implementation seam

Artifacts already provides repository lifecycle, import, fork, delete, Git remotes, tokens, and read APIs. Workspace needs file mutation and apply/discard semantics. Until Artifacts grows those direct APIs, `packages/workspace/src/artifacts/` contains an internal authority and driver that:

- clones an Artifacts repo into an in-memory filesystem for reads or writes;
- commits and pushes file writes back to the Artifacts repo;
- maps `workspace.files.copy()` to an Artifacts fork;
- maps `copy.discard()` to deleting the fork;
- maps `copy.apply()` to pushing the fork state back to the base repository.

That is implementation plumbing, not product vocabulary. It should be deleted when Artifacts exposes direct file write/commit/apply primitives.

### Directory semantics

Artifacts/Git does not preserve empty directories as first-class entries. Workspace still exposes directory-shaped `list`/`stat` behavior from file paths, and scoped writes create parents as needed. Empty directory durability is no longer a core guarantee of the Artifacts-backed prototype; see [`known-limitations.md`](./known-limitations.md).

## How projections are implemented

### Scoped file capability

`copy.files.scoped(...)` wraps a file-copy file API and returns an object exposing only `readFile`, `writeFile`, `list`, and `stat`. It enforces a root prefix, allowed read globs, allowed write globs, path normalization, and traversal rejection. The implementation is `packages/workspace/src/workspace/projections/scoped-file-capability.ts`.

It does **not** expose `apply`, `discard`, repository identity, revisions, or Workspace identity. This is the capability shape delegated code receives.

`packages/adapters/dynamic-worker` adapts that capability to Worker Loader. It keeps the WorkerEntrypoint boundary serializable by forwarding `ScopedWorkspaceCapabilityResult` DTOs, then unwraps those DTOs inside the loaded Worker harness so delegated code sees ordinary `env.WORKSPACE.readFile(...)` / `writeFile(...)` methods. The adapter owns Dynamic Worker loading mechanics; examples still own copy lookup, scopes, agent state, and apply/discard policy.

### Filesystem projection

`copy.files.attach(...)` materializes a file copy into a host filesystem — today, into a Sandbox container under `/workspace`. On `mount.reconcile()`, it reads back changes and writes them into the copy. `packages/adapters/sandbox` wraps that boundary for shell command execution.

The current implementation scans and writes files through the product file-copy API. A future implementation can be a real mount. The semantic boundary stays the same: the runtime sees a normal filesystem; the file copy sees the changes after reconcile.

## How the demos wire it together

`examples/photo-agent-demo` proves that one Workspace working copy — called a draft in the product UI — is usable simultaneously from a Sandbox shell and from delegated Worker code, with one publication boundary.

`examples/coding-agent-demo` imports public GitHub repositories through Artifacts, then exposes Workspace-backed Dynamic Worker and Sandbox tools to a Think coding agent.

Both examples use the same pattern:

1. Trusted Worker code opens a Workspace with `Workspace.fromArtifacts({ artifacts, object, name })`.
2. The product creates or recovers a file copy.
3. Runtime adapters receive only scoped file access or a mounted `/workspace` view.
4. Runtime work reconciles into the file copy.
5. The product or user chooses `apply()` or `discard()`.

No runtime tool implicitly publishes.

## Repo layout

```
packages/workspace/
  src/
    artifacts/     Artifacts authority + temporary internal Git driver
    model/         path / errors / write-tree types
    projections/   scoped-file-capability, working-copy-mount
    workspace.ts   Workspace, file copies, attach/reconcile, writeTree
    workspace-object.ts  per-Workspace Durable Object control metadata

packages/adapters/dynamic-worker/
  src/             Worker Loader runner for scoped Workspace file capabilities

packages/adapters/sandbox/
  src/             Sandbox command runner for mounted Workspace file copies

examples/photo-agent-demo/
  src/             Think photo agent, upload/read routes, React UI

examples/coding-agent-demo/
  src/             Think coding agent, GitHub import, React UI
```

See [`AGENTS.md`](../AGENTS.md) for the short map, conventions (`Result`, `better-result`, no `unwrap()`), and commands.

## See also

- [`product-model.md`](./product-model.md) — the conceptual model and principles.
- [`product-api.md`](./product-api.md) — the target user-facing API.
- [`product-boundaries.md`](./product-boundaries.md) — what Workspace doesn't do, and why.
- [`sources.md`](./sources.md) — how external systems (GitHub, Hugging Face, S3, …) relate to a Workspace.
- [`known-limitations.md`](./known-limitations.md) — accepted gaps in the prototype.
- [`photo-agent-demo.md`](./photo-agent-demo.md) — what the example app proves.
