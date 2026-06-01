# Architecture

This is the "how it actually works" doc. For the conceptual model and why the pieces exist, see [`product-model.md`](./product-model.md). For boundaries and the in/out test, see [`product-boundaries.md`](./product-boundaries.md).

## The problem

Every product on Cloudflare that does interesting work with files ends up reinventing the same thing:

- An agent in a Sandbox edits files under `/workspace`. The parent Worker then has to copy results into something durable — R2, KV, a Durable Object — and stitch metadata back together.
- A Dynamic Worker loaded via Worker Loader wants source files and assets. Today they're inlined into the loader payload or glued in from R2.
- A multi-step agent wants a draft it can iterate on, preview, and only sometimes publish. There's no shared notion of "draft" between turns or between runtimes.
- Two concurrent users hit the same Worker; both write to the same R2 bucket; their changes interleave.

Workspace gives those products one shared primitive: a durable file tree with isolated working copies, an explicit publish boundary, and projections shaped to fit each runtime that needs to read or write the files.

## The model in five lines

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

Full vocabulary and target API live in [`product-api.md`](./product-api.md).

## Projections

Different runtimes need different shapes of access to the same durable state. Workspace defines the state once and exposes four projections:

| Projection | Consumer | Shape | Authority |
|---|---|---|---|
| Control | Trusted Worker / DO | `Workspace.get(...)`, current files, file copies, `apply()` | Full: file copies, apply, discard, revisions |
| Scoped file | Dynamic Worker, plugin, generated code | `env.WORKSPACE.{readFile,writeFile,list,stat}` | Read/write within allowed paths; no apply, no identity |
| Filesystem | Sandbox / container | Files at `/workspace`; explicit capture | Native file IO inside the runtime; apply stays with parent |
| Module / asset (planned) | Dynamic Worker via Worker Loader | Modules and asset bindings from a Workspace tree | Read-only over the chosen tree or revision |

The first three are built. Module/asset projections are documented in [`known-limitations.md`](./known-limitations.md).

## How a Workspace is built

A single Workspace is one Durable Object plus an R2 bucket.

### Storage

- **Durable Object SQLite**:
  - `entries` — file/dir metadata for current files (the head tree).
  - `revisions` + `revision_entries` — immutable snapshots of head.
  - `sessions` + `session_entries` — file copies (durable working-copy metadata, copy-on-begin from head).
  - `workspace_state.head_version` — monotonic counter. Each session remembers the head version it branched from, which is how stale commits get rejected.
- **R2 (`WORKSPACE_BLOBS`)**:
  - Content-addressed file bytes, keyed by digest. Metadata in SQL references blob keys.

### Runtime

- `WorkspaceObject` — the Durable Object entrypoint. It owns head operations (`mkdir`, `writeFile`, `readFile`, `list`, `stat`, `delete`, `snapshot`) and session-id operations for file copies (`sessionReadFile`, `sessionWriteFile`, `sessionList`, `sessionStat`, `sessionDelete`, `sessionCommit`, `sessionDiscard`).
- `Workspace.get(...)` — the product-facing package layer. It wraps Durable Object RPC DTOs into `better-result` `Result` values and exposes current files plus durable file copies (`workspace.files.copy(...)`, `copy.files`, `copy.apply()`, `copy.discard()`). Product code does not receive or manage session RPC stubs.

The Durable Object surface returns **Result-shaped DTOs over RPC** (`{ status: "ok", value }` / `{ status: "error", error }`). Internally the model uses `better-result` tagged errors — `InvalidPathError`, `PathNotFoundError`, `IsDirectoryError`, `NotDirectoryError`, `DirectoryNotEmptyError`, `PathAlreadyExistsError`, `RevisionNotFoundError`, `SessionNotFoundError`, `SessionConflictError`. Error classes don't survive structured clone, so they don't cross the RPC boundary.

### Tree abstraction

`ReadableTree` and `MutableTree` are implemented over SQLite as `headTree`, `revisionTree`, and `sessionTree`. Every file operation is written against those interfaces, so head reads, revision reads, and session reads/writes share one implementation. There's no per-target branching scattered through the operations layer.

### Directory semantics

Directories are **explicit** durable entries.

- `mkdir` creates one.
- `writeFile` requires the parent directory to exist.
- `delete` removes files and empty directories only.
- No implicit parent creation. No auto-pruning.

This trades convenience for clarity. It keeps the capture path, projections, and any comparison products want to build above Workspace well-defined.

## Storage shape, and where it's heading

A few choices in the current implementation are load-bearing, and a few are placeholder. It helps to be explicit about which is which.

### Today: SQLite metadata, R2 blobs

Metadata lives in the Durable Object's SQLite. File contents live in R2 as content-addressed blobs. The DO is the source of truth for the tree; an entry row points at a blob key, and R2 stores immutable bytes keyed by digest. Multiple entries pointing at the same digest share storage. This works well for the kinds of files the prototype has dealt with so far — photos, generated images, agent notes — and it scales as object storage scales.

The two real correctness rules:

- The DO, not R2, decides whether a file "exists". R2 object presence is an implementation detail.
- Blob keys are content-addressed and immutable. Overwrites create a new key; the old key is unreferenced and can be GC'd later.

As long as those hold, multiple writers don't corrupt the tree — they conflict at the SQLite level via head version, and either succeed or fail cleanly.

### Content references are the seam we want

The prototype treats "file content" and "R2 blob" as the same thing. That's fine for now, but it bakes in an assumption that won't hold for every workload:

- A coding agent materialising thousands of small source files into a Sandbox via per-file R2 reads is not where R2 shines.
- A model-weights file the size of a small disk shouldn't be copied into R2 just because some product wants to attach it to a Workspace.
- A file imported by reference from a GitHub commit doesn't have R2 bytes at all until something asks for them.

The long-term shape is a **content reference** on each entry, with a few variants:

- Workspace-owned blob in R2 (today's only case).
- Workspace-owned blob in DO storage, for small/hot files where R2 round-trips hurt.
- External source reference, hydrated on demand through an adapter (see [`sources.md`](./sources.md)).
- Cached external reference, where Workspace has a local copy keyed by source version.

We haven't built this yet, but it's worth keeping the door open: code that reads `entry.blobKey` directly is going to be in the way. Code that goes through a `ContentRef`-shaped boundary is not.

### Tree state and Durable Object facets

Today, head, working copies, and revisions all share one SQLite database inside one Durable Object. `beginSession()` copies the `entries` table into `session_entries`. `commit()` replaces `entries` from that copy. `snapshot()` copies it into `revision_entries`. This is correct, but it's O(N) at every fork/commit, and the metadata for every working copy and revision lives in the same actor.

The better long-term shape is to use Durable Object **facets** for each tree state. The Workspace root stays where authority lives — head version, copy registry, revision registry, the public RPC surface — and the actual tree metadata for head, each copy, and each revision lives in its own facet. A `ctx.facets.clone(src, dst)` call (currently landing in workerd/edgeworker) then becomes the natural primitive for:

- creating a working copy: clone `head` → `copies/<copyId>`.
- taking a revision: clone `head` → `revisions/<revId>`.
- applying a copy: clone `copies/<copyId>` → `head`.

With copy-on-write where the host filesystem supports it, those operations stop being O(N).

This is the direction, not the current state. The relevant facet APIs aren't shipped yet, and our prototype doesn't depend on them. What we should do today is keep the public API talking about file copies and revisions, not about session tables and entry rows, so that the implementation can move without breaking callers. The `ReadableTree` / `MutableTree` interfaces already help here.

### Atoms, briefly

It's worth naming these out loud:

- **Authority atom:** one Workspace Durable Object. Owns identity, head version, the public API, lifecycle decisions. Not changing.
- **Isolation atom:** a file copy (also a revision). Today: rows in a shared SQLite table. Likely future: a facet per tree state.
- **Byte ownership atom:** a content reference. Today: an R2 blob key. Likely future: a tagged ref pointing at R2, DO storage, an external source, or a cached external source.

Product code should only see the first two, and only through the names in [`product-api.md`](./product-api.md).

## How projections are implemented

### Scoped file capability

`copy.files.scoped(...)` wraps a file-copy file API and returns an `RpcTarget` exposing only `readFile`, `writeFile`, `list`, `stat`. It enforces a root prefix, allowed read globs, allowed write globs, path normalisation, and traversal rejection. The lower-level implementation is `packages/workspace/src/workspace/projections/scoped-file-capability.ts`.

It does **not** expose `apply`, `discard`, `beginSession`, `getByName`, revisions, or Workspace identity. This is the capability shape delegated code receives.

`packages/adapters/dynamic-worker` adapts that capability to Worker Loader. It keeps the WorkerEntrypoint RPC boundary serializable by forwarding `ScopedWorkspaceRpcResult` DTOs, then unwraps those DTOs inside the loaded Worker harness so delegated code sees ordinary `env.WORKSPACE.readFile(...)` / `writeFile(...)` methods. The adapter owns Dynamic Worker loading mechanics; examples still own copy lookup, scopes, agent state, and apply/discard policy.

### Filesystem projection

`packages/workspace/src/workspace/projections/working-copy-mount.ts`

`copy.files.attach(...)` materialises a file copy into a host filesystem — today, into a Sandbox container under `/workspace`. On `attachment.capture()`, it reads back changes and writes them into the copy as metadata + blob refs. The lower-level implementation is `attachWorkspaceMount(...)`.

The current implementation scans and hashes. A future implementation can be a real mount. The semantic boundary stays the same: the runtime sees a normal filesystem; the file copy sees the changes after capture.

## How the demo wires it together

`examples/photo-agent-demo` is a real Worker that exercises every primitive end-to-end. The point isn't "photo editing" — it's proving that the same Workspace draft is usable simultaneously from a Sandbox shell and from delegated Worker code, with one publication boundary.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Browser (React/Vite)                              │
│  upload      │ chat with PhotoAgent (useAgentChat)                        │
│  previews    │ passive — driven by agent.setState({ photo })              │
└──────┬───────────────────┬───────────────────────────────────────────────┘
       │ HTTP upload       │ WebSocket (Agents SDK)
       ▼                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                  Worker entrypoint (src/index.ts)                         │
│  routes upload/read/state; otherwise routeAgentRequest(...)               │
└──────┬─────────────────────────────────────────────────┬─────────────────┘
       │                                                 │
       ▼                                                 ▼
┌──────────────────┐                       ┌────────────────────────────────┐
│ WorkspaceObject  │  ◄── direct RPC ───── │ PhotoAgent (extends Think)     │
│ (DO + SQLite)    │                       │  tools:                        │
│ + R2 blobs       │                       │   listPhotoState               │
└──────────────────┘                       │   runWorkspaceCommand          │
                                           │   runDynamicWorker             │
                                           │   commitDraft / discardDraft   │
                                           └──┬──────────────────┬──────────┘
                                              │                  │
                              file copy files │                  │scoped capability
                                              ▼                  ▼
                                ┌──────────────────────┐ ┌─────────────────────────┐
                                │ Sandbox (container)  │ │ Worker Loader            │
                                │ /workspace mounted   │ │ Dynamic Worker w/        │
                                │ from draft copy      │ │ env.WORKSPACE (scoped)   │
                                │ ImageMagick, sh, …   │ │ readFile/writeFile/…     │
                                └──────────────────────┘ └─────────────────────────┘
                                          │                       │
                                          └────── both mutate the same draft ──────┐
                                                                                   │
                                                          PhotoAgent.commitDraft() ─┘
                                                          → copy.apply() → revision
```

Wiring choices worth knowing:

- **One draft per `PhotoAgent` instance.** The agent stores `draftEditId` in its own state. The Sandbox and the Dynamic Worker both bind to the same file copy, so a `convert` in Sandbox and a `writeFile('/notes/edit-summary.md')` from a Dynamic Worker land in one draft and apply together.
- **Sandboxes are scoped per draft.** `getSandbox(env.Sandbox, ${workspaceName}-${draftEditId}, { sleepAfter: "60s" })`. Concurrent users and drafts don't share `/workspace`.
- **The Dynamic Worker binding goes through a loopback `WorkerEntrypoint`.** `this.ctx.exports.WorkspaceFileCapability({ props: { workspaceName, draftEditId } })`. Worker Loader RPC references can't be serialised through `env`, but service stubs through entrypoint props can.
- **The UI is event-driven, not polled.** `PhotoAgent.setState({ photo })` pushes change keys over the existing WebSocket; the browser only fetches `/photos/{original|draft|current}` when keys change.
- **No tool implicitly publishes.** `commitDraft` is its own agent tool, gated on user intent.

## Repo layout

```
packages/workspace/
  src/workspace/
    model/        path / errors / operations / rpc / sessions / revisions — pure semantics
    storage/      schema, head state, sql-entry-tree, blob-store
    runtime/      WorkspaceObject (DO)
    projections/  scoped-file-capability, working-copy-mount

examples/photo-agent-demo/
  src/
    agent/        PhotoAgent (Think) + prompt
    photo/        draft-controller (product glue) + upload
    workspace/    Sandbox runner, loopback Workspace capability
    http/         upload / read / state / demo routes
    client/       React/Vite UI (useAgent, useAgentChat)

packages/source/github/
  src/             GitHub REST source adapter yielding WorkspaceTreeEntry values

packages/adapters/dynamic-worker/
  src/             Worker Loader runner and reusable Workspace capability entrypoint
```

See [`AGENTS.md`](../AGENTS.md) for the short map, conventions (`Result`, `better-result`, no `unwrap()`), and commands.

## See also

- [`product-model.md`](./product-model.md) — the conceptual model and principles.
- [`product-api.md`](./product-api.md) — the target user-facing API.
- [`product-boundaries.md`](./product-boundaries.md) — what Workspace doesn't do, and why.
- [`sources.md`](./sources.md) — how external systems (GitHub, Hugging Face, S3, …) relate to a Workspace.
- [`known-limitations.md`](./known-limitations.md) — accepted gaps in the prototype.
- [`photo-agent-demo.md`](./photo-agent-demo.md) — what the example app proves.
