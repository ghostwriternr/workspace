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
| Control | Trusted Worker / DO | `workspace.beginSession()`, file ops, `commit()` | Full: sessions, commit, discard, revisions |
| Scoped file | Dynamic Worker, plugin, generated code | `env.WORKSPACE.{readFile,writeFile,list,stat}` | Read/write within allowed paths; no commit, no identity |
| Filesystem | Sandbox / container | Files at `/workspace`; capture-on-flush | Native file IO inside the runtime; commit stays with parent |
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

- `WorkspaceObject` — the Durable Object entrypoint. Head operations (`mkdir`, `writeFile`, `readFile`, `list`, `stat`, `delete`, `snapshot`, `beginSession`, `getSession`).
- `WorkspaceSession extends RpcTarget` — a live capability handle returned by `beginSession()`. Same file API as head but isolated; adds `commit()` and `discard()`. Sessions are also recoverable by `sessionId` via `getSession()` for stateless callers.

Both surfaces return **Result-shaped DTOs over RPC** (`{ ok: true, value }` / `{ ok: false, error }`). Internally the model uses `better-result` tagged errors — `InvalidPathError`, `PathNotFoundError`, `IsDirectoryError`, `NotDirectoryError`, `DirectoryNotEmptyError`, `PathAlreadyExistsError`, `RevisionNotFoundError`, `SessionNotFoundError`, `SessionConflictError`. Error classes don't survive structured clone, so they don't cross the RPC boundary.

### Tree abstraction

`ReadableTree` and `MutableTree` are implemented over SQLite as `headTree`, `revisionTree`, and `sessionTree`. Every file operation is written against those interfaces, so head reads, revision reads, and session reads/writes share one implementation. There's no per-target branching scattered through the operations layer.

### Directory semantics

Directories are **explicit** durable entries.

- `mkdir` creates one.
- `writeFile` requires the parent directory to exist.
- `delete` removes files and empty directories only.
- No implicit parent creation. No auto-pruning.

This trades convenience for clarity. It makes diff, capture, and future projections tractable.

## How projections are implemented

### Scoped file capability

`packages/workspace/src/workspace/projections/scoped-file-capability.ts`

A factory that wraps a session and returns an `RpcTarget` exposing only `readFile`, `writeFile`, `list`, `stat`. It enforces a root prefix, allowed read globs, allowed write globs, optional delete permission (off by default), path normalisation, and traversal rejection.

It does **not** expose `commit`, `discard`, `beginSession`, `getByName`, revisions, or Workspace identity. This is what gets passed into a Dynamic Worker as `env.WORKSPACE`.

### Filesystem projection

`packages/workspace/src/workspace/projections/working-copy-mount.ts`

`attachWorkspaceMount(...)` materialises a session's files into a host filesystem — today, into a Sandbox container under `/workspace`. On `flush()`, it reads back changes and writes them into the session as metadata + blob refs.

The current implementation scans and hashes. A future implementation can be a real mount. The semantic boundary stays the same: the runtime sees a normal filesystem; the session sees the changes after flush.

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
                            session capability│                  │scoped capability
                                              ▼                  ▼
                                ┌──────────────────────┐ ┌─────────────────────────┐
                                │ Sandbox (container)  │ │ Worker Loader            │
                                │ /workspace mounted   │ │ Dynamic Worker w/        │
                                │ from draft session   │ │ env.WORKSPACE (scoped)   │
                                │ ImageMagick, sh, …   │ │ readFile/writeFile/…     │
                                └──────────────────────┘ └─────────────────────────┘
                                          │                       │
                                          └────── both mutate the same draft ──────┐
                                                                                   │
                                                          PhotoAgent.commitDraft() ─┘
                                                          → session.commit() → revision
```

Wiring choices worth knowing:

- **One draft per `PhotoAgent` instance.** The agent stores `draftEditId` in its own state. The Sandbox and the Dynamic Worker both bind to the same session, so a `convert` in Sandbox and a `writeFile('/notes/edit-summary.md')` from a Dynamic Worker land in one draft and publish together.
- **Sandboxes are scoped per draft.** `getSandbox(env.Sandbox, ${workspaceName}-${draftEditId}, { sleepAfter: "60s" })`. Concurrent users and drafts don't share `/workspace`.
- **The Dynamic Worker binding goes through a loopback `WorkerEntrypoint`.** `this.ctx.exports.WorkspaceFileCapability({ props: { workspaceName, draftEditId } })`. Worker Loader RPC references can't be serialised through `env`, but service stubs through entrypoint props can.
- **The UI is event-driven, not polled.** `PhotoAgent.setState({ photo })` pushes change keys over the existing WebSocket; the browser only fetches `/photos/{original|draft|current}` when keys change.
- **No tool implicitly commits.** `commitDraft` is its own agent tool, gated on user intent.

## Repo layout

```
packages/workspace/
  src/workspace/
    model/        path / errors / operations / rpc / sessions / revisions — pure semantics
    storage/      schema, head state, sql-entry-tree, blob-store
    runtime/      WorkspaceObject (DO), WorkspaceSession (RpcTarget)
    projections/  scoped-file-capability, working-copy-mount

examples/photo-agent-demo/
  src/
    agent/        PhotoAgent (Think) + prompt
    photo/        draft-controller (product glue) + upload
    workspace/    Sandbox runner, Dynamic Worker runner, loopback capability
    http/         upload / read / state / demo routes
    client/       React/Vite UI (useAgent, useAgentChat)
```

See [`AGENTS.md`](../AGENTS.md) for the short map, conventions (`Result`, `better-result`, no `unwrap()`), and commands.

## See also

- [`product-model.md`](./product-model.md) — the conceptual model and principles.
- [`product-api.md`](./product-api.md) — the target user-facing API.
- [`product-boundaries.md`](./product-boundaries.md) — what Workspace doesn't do, and why.
- [`known-limitations.md`](./known-limitations.md) — accepted gaps in the prototype.
- [`photo-agent-demo.md`](./photo-agent-demo.md) — what the example app proves.
