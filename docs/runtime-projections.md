# Runtime projections and mounted file views

Workspace is the durable, product-owned file authority root. It is not a thing that is copied into a runtime and later blindly synced back.

This document explains the file-state model behind that statement. It is written from first principles for readers who are new to Workspace, agents, Dynamic Workers, Sandboxes, and source adapters. It is not an API specification. Names may change. The goal is to make the concepts precise enough that future APIs and adapters have a shared foundation.

AI agents are not the only audience for Workspace, but they are the workload that most consistently exposes weak file-state semantics. An agent works through tools, across turns, and often across multiple execution environments. If ownership, durability, and publication are ambiguous, the agent will make bad claims or preserve the wrong files. The vocabulary below should therefore stay clear enough for an agent-facing tool contract and precise enough for platform code.

## Current implementation status

The current prototype has durable current files, durable working copies, `apply()` / `discard()`, scoped file capabilities for Dynamic Workers, and a simple filesystem mount API (`copy.files.attach(...)` / `mount.reconcile()`). Today that mount implementation materializes one Workspace file copy into a host directory and reconciles regular files back by scanning and hashing.

The current prototype also uses eager source import: source adapters stream bytes into Workspace-owned R2 blobs through `copy.files.writeTree(...)`.

This document describes the stronger model we want the implementation to grow toward. Runtime-local mounts, mounted-view composition, source-backed mounted views, working-copy overlays over source snapshots, working-copy generations, and a first-class Sandbox adapter package are not built yet.

## The problem

Products that use agents or generated code almost always need to move files across boundaries:

- A GitHub repository is imported or referenced so an agent can edit it.
- A Dynamic Worker reads and writes project files through a scoped binding.
- A Sandbox runs `npm test` in a project directory.
- A package manager creates `node_modules` under the project root.
- A code generator writes `src/generated/client.ts`.
- A build creates `dist/` or `.next/cache/`.
- A failed test writes logs or snapshots.
- A user decides whether the proposed work should become accepted project state.

A naive model says:

```text
sync Workspace into /workspace
run command
sync /workspace back into Workspace
```

That model fails quickly, especially for agents. A human can sometimes inspect the runtime and infer what happened. An agent usually sees only tool inputs and outputs. If a tool says a command ran but hides whether files were reconciled, which paths were runtime-local, or whether the working copy is now stale, the agent cannot reason accurately about the next step.

`node_modules` may need to exist under `/workspace` for tools to work, but it should not become durable Workspace state. A generated source file should probably be kept. A build cache should probably stay runtime-local. A source file from GitHub may be read from a stable source snapshot rather than imported into Workspace-owned storage. A long-running Sandbox has local state that can become stale if a Dynamic Worker edits the same working copy.

The deeper question is not "which paths should sync?" The deeper question is:

> Who owns each path, what authority does a runtime receive over it, and when do runtime-local changes become durable Workspace state?

Workspace needs a model that answers that question once, then lets each runtime adapter implement the right mechanics for its environment.

## Core position

Workspace defines durable product-owned file state, working copies, publication, and minimal runtime-independent file authority concepts.

Runtime adapters are not optional convenience wrappers. They are where the Workspace model becomes usable in real execution environments.

Source adapters are also not just sample code. They are how products resolve external systems into stable file authorities or import streams without making Workspace core depend on GitHub, S3, Hugging Face, or any other source lifecycle.

The boundary is:

- Workspace defines the durable product-owned authority root, current files, working copies, revisions, and minimal file-state contracts.
- Runtime adapters expose Workspace-backed and other mounted authorities in shapes that each runtime can use.
- Source adapters resolve external systems into stable snapshots or file streams that products can mount, import, or export.
- Products decide user intent, source selection, execution sequence, and whether to apply, discard, or export durable work.

Workspace should not own command execution, Sandbox lifecycle, Worker Loader mechanics, package manager behavior, Git remotes, source lifecycles, or agent orchestration. But Workspace and its adapter ecosystem should make file boundaries explicit enough that product authors do not reinvent hydration, materialization, reconciliation, cache preservation, and authority shaping for every app or every agent toolbelt.

## One lifecycle, all concepts

One realistic coding-agent flow exercises the full model:

```text
1. User opens github.com/acme/app@main.
2. Source adapter resolves main -> commit abc123.
3. Product creates a mounted project view:
     /              overlay(Workspace working copy over GitHub source snapshot)
     /node_modules  Sandbox runtime-local dependency cache
     /tmp           Sandbox scratch
     /dist          artifact authority for build output
4. Agent searches the mounted view.
5. Agent uses a Dynamic Worker to edit files through a scoped projection.
6. Agent uses a Sandbox to run npm test against /workspace.
7. Sandbox projection refreshes source/overlay files and preserves node_modules.
8. Command writes source changes, cache files, and build output.
9. Reconciliation classifies those writes by mounted authority.
10. Reconciliation writes Workspace-owned runtime changes into the Workspace working copy.
11. Product either exports the overlay to GitHub, applies imported Workspace-owned files, or discards the working copy.
```

This single lifecycle explains why the concepts are distinct:

- GitHub owns unchanged source bytes.
- Workspace owns the durable writable overlay.
- Sandbox owns dependency cache and scratch.
- A product artifact authority owns build output.
- A mounted view gives the agent one project namespace.
- Runtime projections expose that namespace in runtime-native ways.
- Reconciliation is not publication.
- Apply is not export.
- Tool outputs must report which boundary was crossed.

The rest of this document defines the vocabulary behind that lifecycle.

## Vocabulary groups

Not every named thing below is the same kind of primitive. Keeping the groups separate prevents the model from turning into a flat taxonomy.

### Foundational mental model

These concepts should be understandable to platform developers and reflected in agent-facing tool contracts:

- file authority;
- Workspace;
- working copy;
- source snapshot;
- mounted view;
- mount;
- overlay;
- projection;
- runtime adapter;
- source adapter;
- runtime-local state;
- artifact authority;
- apply and export.

### Lifecycle verbs

These describe movement across authority and runtime boundaries:

- hydration;
- materialization;
- refresh;
- reconciliation.

### Technical machinery

These are likely necessary internally, but they should not dominate the user or agent mental model:

- Workspace content storage reference;
- generation;
- projection token or lease.

### Current API terms

Some terms exist today because of the current implementation. They should not be mistaken for the whole long-term model:

- `attach`, the current API method that creates a filesystem mount;
- session;
- commit, where older internals mean `apply`.

## Foundational mental model

### File authority

A file authority owns the truth for a set of paths. It can answer:

- what files and directories exist;
- what their bytes and metadata are;
- whether a caller may read, write, or delete them;
- where a write becomes durable;
- what version or consistency contract applies.

Examples:

- Workspace current files;
- a Workspace working copy;
- an immutable Workspace revision;
- a GitHub commit snapshot;
- an S3 object-prefix snapshot;
- a Sandbox runtime cache;
- a runtime scratch directory;
- a product-owned artifact store;
- a future asset or module source view.

Authority means "owner of truth for this path." It does not imply the authority is durable, published, writable, or Workspace-owned. Runtime scratch can be a file authority with a weak lifetime. A Workspace working copy is a durable writable file authority. A GitHub commit snapshot is an external read-only authority.

This is a model-facing distinction as much as an implementation distinction. An agent can safely say it changed a Workspace-owned path only if the tool contract makes that authority clear. Writing a runtime-local cache path is not the same kind of event.

### Workspace

A Workspace is a durable product-owned authority root. It contains Workspace-owned file authorities:

- current files, which are the published live Workspace-owned tree;
- working copies, which are durable, isolated, mutable Workspace-owned authorities;
- revisions, which are immutable recovery points of Workspace-owned state.

A Workspace is not an execution environment. It does not run commands. It decides what durable Workspace files exist.

Not every project view needs to be only a Workspace tree. A large coding-agent project may be a mounted view composed from a source snapshot plus a Workspace-owned overlay. In that case, Workspace owns the durable writable layer, while the source snapshot still owns unchanged source bytes.

### Working copy

A working copy is the isolation atom for Workspace-owned changes. It is durable and mutable, but not published.

Agents, humans, Dynamic Workers, Sandboxes, or other tools can write to a working copy. Those changes survive turns and requests. They do not affect current files until trusted product code applies the working copy.

This distinction is central:

```text
reconciled into working copy  !=  published as current files
```

For source-backed project views, a working copy can also serve as a writable overlay on top of a stable source snapshot authority. The working copy still owns durable writes and tombstones. The source snapshot still owns unchanged base files.

A working copy represents one coherent proposed future for the Workspace-owned layer of a project. It is not merely a diff, command log, or runtime session.

### Source snapshot

A source is an external system that can provide files: GitHub, S3, Hugging Face, Artifacts, user uploads, and so on.

A source snapshot is a stable resolved version of that source exposed as a file authority. For example, `main` in a GitHub repository is not a safe file authority because it can move. A resolved commit SHA is.

Today source snapshots are imported by streaming entries into Workspace working copies. Future designs may also mount source snapshots directly as read-only authorities. In both cases, Workspace should preserve the distinction between external source ownership and Workspace-owned durable state.

A source snapshot can be the read-only base of a project view:

```text
read path:
  if Workspace overlay has a write for path, read overlay
  else if Workspace overlay has a tombstone for path, path is absent
  else read source snapshot

write path:
  write Workspace overlay

delete path:
  create Workspace overlay tombstone
```

The invariants are:

- mutable source refs resolve to stable snapshots before entering the model;
- writes never mutate the source snapshot;
- deletes are represented explicitly in Workspace-owned state;
- reads are coherent, with overlay state shadowing base state;
- source read failures are read/materialization failures, not ambiguity about whether a path exists;
- export back to the source is product/source-adapter behavior, not Workspace publication.

This is deliberately different from storing external source blob references inside Workspace current files or revisions. External sources remain file authorities in mounted views. Workspace-owned entries should represent Workspace-owned durable file state.

### Mounted view

A mounted view is a path namespace composed from one or more file authorities.

Example view paths:

```text
/                  overlay(Workspace working copy over GitHub source snapshot)
/node_modules      Sandbox runtime cache
/tmp               Sandbox scratch
/vendor/react      GitHub source snapshot
/dist              artifact authority or runtime-local output
```

The mounted view is not itself necessarily durable. It describes what a runtime or caller sees at each path and which authority owns each part of that namespace.

This is the key replacement for thinking in terms of one global sync policy. `node_modules` is not "Workspace but excluded." It is runtime-local state mounted at a path tools expect. A GitHub source file is not "Workspace with an external content ref." It is source-owned state mounted into the view, possibly overlaid by Workspace-owned edits.

For agents, this prevents a common reasoning failure: seeing a familiar path under `/workspace` and assuming it is a proposed durable project change. The mounted view is the source of truth for what that path means.

### Mount

A mount binds a file authority to a path inside a mounted view.

A mount answers:

- which authority owns this path prefix;
- whether the mount is readable or writable;
- whether writes are durable, runtime-local, or rejected;
- what consistency model applies;
- how the mount appears to a runtime projection.

The term is mount-like, not POSIX. Workspace should not promise full distributed POSIX semantics or arbitrary object-bucket mounting. A mount in this model is an ownership edge between a path prefix and a file authority.

A mount may expose an authority's whole namespace or a subtree. If subtrees are supported, path rewriting must be explicit: a mount at view path `/generated` backed by Workspace subtree `/src/generated` means view path `/generated/client.ts` maps to authority path `/src/generated/client.ts`. Without that explicit mapping, a mount is assumed to expose the authority at the same path.

### Overlay

An overlay composes a writable authority over a read-only base authority at the same view path.

This is useful for source-backed projects:

```text
view /
  writable overlay: Workspace working copy
  read-only base:   GitHub commit snapshot
```

Reads see the overlay first. Writes go to the overlay. Deletes become overlay tombstones. The base remains unchanged.

Overlay mounts let an agent work with a large source snapshot without importing every byte into Workspace. The agent still sees one project tree. Workspace still owns only the durable proposed changes.

Multiple read-only bases may be useful later, but they require explicit precedence and directory-merge rules. Until those rules are designed, the conceptual model assumes one writable overlay over one stable base.

### Projection

A projection adapts either a single file authority or a composed mounted view into a runtime's native access shape.

Examples:

- Dynamic Worker projection: `env.WORKSPACE.readFile`, `writeFile`, `list`, `stat`.
- Sandbox projection: files visible under `/workspace`.
- Future module projection: Workspace or source-backed files passed to Worker Loader as modules.
- Future asset projection: a mounted view or Workspace tree exposed as an asset binding.

A projection is runtime-shaped. The same working copy can be projected as a scoped RPC capability to a Dynamic Worker and as files under `/workspace` to a Sandbox. Agent tools should expose the projection's natural shape without leaking irrelevant mechanics: a Dynamic Worker tool can talk about `env.WORKSPACE`, while a Sandbox shell tool can talk about `/workspace`, reconcile, and runtime-local paths.

### Runtime adapter

A runtime adapter implements a projection for a concrete execution environment.

Examples:

- a Dynamic Worker adapter passes a scoped Workspace file capability into Worker Loader;
- a Sandbox adapter materializes a mounted view into a container filesystem and reconciles changes back.

Runtime adapters are first-class package surfaces. They are not sample glue. They solve runtime-specific file boundary problems while preserving Workspace's runtime-independent semantics. They are also where model-facing execution tools can get sane defaults without making every product author teach the agent about RPC, host filesystems, or reconcile internals.

### Source adapter

A source adapter resolves an external system into stable file state. It does not project a mounted view into an execution runtime.

Examples:

- a GitHub source adapter resolves a repository ref to a commit SHA and yields file entries;
- an S3 source adapter resolves an object prefix to object versions;
- a Hugging Face source adapter resolves a model revision.

Source adapters live outside Workspace core. Some may be provided as packages in the Workspace ecosystem, but Workspace core must not depend on them.

### Runtime-local state

Runtime-local state is file state owned by an execution environment, even if it appears under a project directory.

Examples:

- `node_modules`;
- `.venv`;
- package-manager caches;
- build caches;
- temporary extraction directories;
- long-running server state.

Runtime-local state may persist while a Sandbox instance sleeps and wakes. It may disappear when the runtime is destroyed. It should not become Workspace state unless product code deliberately copies selected files into a Workspace-owned mount. Agent-facing tools should describe runtime-local outputs as runtime-local, not as staged Workspace changes.

Scratch is a runtime-local area with no durability expectation, such as `/tmp` or intermediate command output. It is useful for execution but is not a separate Workspace primitive.

### Artifact authority

Artifacts are outputs a product may want to keep, serve, download, or inspect without making them current Workspace files.

Examples:

- build bundles;
- coverage reports;
- preview images;
- compiled binaries;
- test logs.

Workspace core should not define artifact lifecycle. A product may mount a separate artifact authority, or it may copy selected artifacts into Workspace-owned paths if that is the product's intent.

### Apply and export

Apply publishes a Workspace working copy to Workspace current files. Discard abandons the working copy.

Export sends Workspace-owned state, often a working-copy overlay, to an external system through product/source-adapter code.

Apply and export are distinct:

- `apply` changes Workspace current files;
- export may open a GitHub pull request, push to Artifacts, upload to S3, or do nothing;
- reconcile is neither apply nor export.

This separation is critical for agents: they can experiment, stage durable results, and report them without implying that the live project or external source changed.

## Mounted-view rules and contract

### Composition rules

A mounted view needs explicit composition rules or "mount" remains only a metaphor. The exact API is open, but the model should have these rules:

1. **Path lookup uses the most specific mount.** If `/` is an overlay and `/node_modules` is runtime-local, then `/node_modules/react/index.js` belongs to the runtime-local authority.
2. **Overlaps must be explicit.** A child mount may shadow a parent mount only if the view says so. Accidental overlap should be rejected.
3. **Overlay order is explicit.** In an overlay, writable Workspace state shadows base source state. Tombstones hide base entries.
4. **Reads dispatch to the owning authority.** Reading `/src/index.ts` may go to a Workspace overlay or to a source snapshot base depending on overlay state. Reading `/node_modules/react/index.js` goes to runtime-local cache.
5. **Writes and deletes dispatch to the owning writable authority.** If a path is read-only, writes fail. If a path is runtime-local, writes stay runtime-local. If a path is Workspace-owned, accepted writes can become working-copy state.
6. **Directory operations compose mount boundaries.** `stat("/node_modules")` routes to the `/node_modules` child mount. `list("/")` should include child mount names such as `node_modules` even if the parent authority does not contain that directory. Overlay directory listings merge visible overlay entries with non-tombstoned base entries.
7. **No matching mount is an error inside the view.** A view should not silently route unknown view paths to Workspace or scratch.
8. **Refresh respects ownership.** Refreshing a Sandbox projection updates Workspace-backed and source-backed paths while preserving runtime-local child mounts.
9. **Reconciliation respects ownership.** Capturing a Sandbox projection writes changes from Workspace-owned writable mounts back to Workspace, ignores runtime-local mounts, and rejects or reports unsupported entries according to the projection contract.
10. **Tool output should reflect routing.** Agent-facing tools should report whether writes were reconciled into a working copy, remained runtime-local, were ignored, or failed because the view had no writable authority for that path.

Example:

```text
view mount /              -> overlay(Workspace working copy over GitHub source snapshot)
view mount /node_modules  -> Sandbox runtime cache
host root /workspace
```

Then:

```text
/workspace/src/index.ts              -> view /src/index.ts          -> overlay or source base
/workspace/node_modules/react/index  -> view /node_modules/react... -> Sandbox runtime cache
```

Deleting `/workspace/node_modules` does not delete a Workspace `/node_modules` entry because the runtime-local child mount owns that subtree. If a product wants a real Workspace-owned `/node_modules`, it should not mount runtime-local state at that path.

A Sandbox projection has a host boundary as well as a view boundary. If the view is projected at host path `/workspace`, files written to container path `/tmp` are outside the projected view. They remain Sandbox-owned runtime state and are ignored by Workspace refresh/reconcile unless product code explicitly copies them into a mounted path.

### Mounted-view contract

Every runtime can expose files differently, but any projection of a mounted view must preserve these invariants:

1. **Every path has one owning authority or explicit overlay stack, or it is invalid.** No silent fallback to Workspace, scratch, or runtime globals.
2. **Most-specific mount wins.** Child mounts can shadow parent mounts only when explicit.
3. **Overlay order is stable.** Workspace-owned overlay state shadows source base state; writes never mutate source bases.
4. **Ownership determines durability.** A write to a Workspace-owned mount can become durable Workspace state. A write to runtime-local state does not.
5. **Projection never implies publication.** No projection can make Workspace current files change without trusted `apply`. No projection can mutate an external source without an explicit product export.
6. **Adapters may materialize, cache, hydrate, or lazily access files, but must preserve authority semantics.** Mechanics can vary; ownership cannot.
7. **Boundary crossings must be reportable.** If runtime state becomes durable, durable state becomes current, source state is imported, or a projection refuses reconcile, the caller needs structured truth.
8. **Runtime-local state is a real authority.** It is not an ignored Workspace subtree.
9. **Source snapshots are stable authorities.** Mutable source refs must resolve before they enter a mounted view.
10. **Staleness must be explicit when it can affect correctness.** Materialized projections should refresh, reject, or report stale state rather than silently operating on an old view.

These invariants are the adapter test. A Sandbox adapter, Dynamic Worker adapter, module projection, source-backed view, or asset projection may all have different mechanics, but if they violate these rules then a platform developer or AI agent cannot reason about files consistently.

## Runtime escalation model

Runtimes are tools, not homes for the project. The working copy is the durable writable home for proposed changes.

The execution ladder is:

```text
trusted Worker / Durable Object
  -> Dynamic Worker / Dynamic Durable Object
  -> Sandbox / container
```

This is not a strict sequence. It is an authority, cost, and capability ladder.

Trusted Workers and Durable Objects own orchestration, user intent, source import/export coordination, and apply/discard. They can hold Workspace identity because they are product code.

Dynamic Workers and Dynamic Durable Objects are for generated or delegated code that can work through scoped file capabilities. They are lighter than containers and do not need a full filesystem projection for the common case.

Sandboxes and containers are for tasks that need process execution, package managers, native tools, language runtimes, preview servers, or local filesystem conventions.

The model has these invariants:

1. **The working copy is the durable writable anchor.** Runtimes can be created, refreshed, slept, destroyed, or replaced. The task's proposed changes remain in the working copy until trusted code applies, discards, or exports them.
2. **Use the leanest sufficient runtime.** Direct file tools are enough for targeted reads and edits. Dynamic Workers are enough for JavaScript inspection and transformation. Sandboxes or containers are for real commands and native filesystem workflows.
3. **Escalation changes projection, not project truth.** Moving from a Dynamic Worker to a Sandbox changes how the runtime sees files. It does not create a new published project state.
4. **Execution authority stays scoped.** A heavier runtime does not imply more Workspace authority. Delegated code and commands can propose file-state changes, but they should not receive apply/discard authority by default.
5. **Parallel runtimes coordinate through working copies.** One coherent task may share a working copy across runtimes. Independent experiments, competing approaches, or subagents should usually use separate working copies.
6. **Materialized runtimes must refresh or report staleness.** If one projection changes a working copy, another materialized projection must not silently operate on old files when correctness depends on freshness.
7. **Results accumulate in the working copy, not current files.** Runtime outputs become durable only when written or reconciled into the working copy. They become current only when trusted code applies the copy.
8. **Runtime-local state does not define project truth.** A warm Sandbox may preserve caches or temporary files, but the durable working copy remains the shared writable layer.
9. **Tool outputs should guide future runtime choice.** If a Dynamic Worker cannot perform a task because package-manager or native command execution is required, the agent can escalate to Sandbox. If a Sandbox command shows the next step is a pure text transform, the agent can return to lighter tools.

The product promise is that agents and platforms can move across this ladder, or use multiple rungs in one task, while still reasoning about one durable working copy and one explicit publication/export boundary.

## Working copy sharing and forking

A working copy represents one coherent proposed future for the Workspace-owned layer of a project.

That is the rule of thumb for deciding whether work should share a copy or fork into separate copies. Sharing is useful when tools are collaborating on one line of work. Forking is useful when work represents independent possibilities.

Share a working copy when:

- direct file tools, Dynamic Workers, and Sandboxes are collaborating on one task;
- edits, generated files, tests, and fixes are part of one attempted solution;
- the user expects one apply or export operation to accept the whole result;
- runtime-local state belongs to the same execution context for that proposed future.

Fork separate working copies when:

- trying multiple alternative approaches;
- running independent subagents;
- doing speculative experiments;
- comparing generated variants;
- isolating risky commands;
- letting two users edit concurrently;
- testing a source import without affecting current task state.

The invariants are:

1. **A working copy is one proposed future.** It is not merely a diff, a command log, or a runtime session.
2. **One apply publishes one working copy as a unit in Workspace-owned projects.** In source-backed workflows, one export can similarly accept the overlay as a unit.
3. **Coherent toolchains should share a copy.** A Dynamic Worker transform followed by a Sandbox test and a direct file edit can all contribute to the same proposed future.
4. **Independent experiments should fork.** Separate copies avoid coordination between unrelated attempts and let the product or user choose later.
5. **Subagents should usually get separate copies unless explicitly collaborating.** Parallel agents are independent by default.
6. **Shared copies need coordination.** Materialized projections must refresh or report staleness when another tool changes the same copy.
7. **Separate copies need selection.** Workspace does not decide which future is best.
8. **Workspace does not merge competing futures.** Products may compare views, copy selected files, generate patches, or build merge workflows above Workspace, but merge/rebase is not core Workspace behavior.
9. **Runtime-local state belongs to a projection of a working copy.** A warm Sandbox cache is tied to the proposed future it supports, not to the global project.
10. **Source imports should usually stage into a fresh working copy.** The product can apply the import if it should become Workspace-owned current files, or discard it if the import fails or is only exploratory.

For agents, the simple rule is: use the task's active working copy for one coherent line of work; create a separate working copy for independent experiments; do not assume Workspace will merge them later.

## Materialized projection lifecycle

A materialized runtime projection is not the working copy. It is a runtime-local view of one or more file authorities.

Sandbox and container projections are the main example. They expose files through a local filesystem, so they must materialize authority state into the runtime and later reconcile runtime changes back.

The conceptual lifecycle is:

```text
create projection
  -> materialize or refresh
  -> execute
  -> reconcile
  -> reconcile accepted changes
  -> reuse, refresh again, or destroy
```

The lifecycle does not have to be exposed as these exact API steps, but every materialized projection needs this shape somewhere.

### Create projection

Creating a projection binds a mounted view to a runtime host location, such as `/workspace` in a Sandbox.

This does not publish anything. It also does not make the runtime the owner of Workspace state. It establishes the relationship between a working copy, source bases, runtime-local authorities, and the runtime path where execution will happen.

### Materialize or refresh

Materialization makes the mounted view locally usable. Refresh updates an existing materialization from the backing authorities.

A materialized projection represents some generation of each backing authority. If the Workspace working copy changes through another projection, a direct file tool, or a Dynamic Worker, the materialized view may become stale.

A projection should not execute against stale Workspace-owned state when correctness depends on freshness. The adapter can satisfy that invariant by refreshing before every command, tracking generations and refreshing only when stale, or rejecting execution until refreshed. The agent should not have to guess.

Refresh must respect ownership. It should update Workspace-backed and source-backed paths while preserving runtime-local mounts such as dependency caches.

### Execute

Execution is runtime-owned. A shell command, language interpreter, package manager, or server reads and writes local files according to normal runtime rules.

During execution, the materialized view can diverge from its backing authorities. That is expected. Local filesystem compatibility is the reason the projection exists.

Command failure is not projection failure. `npm test` exiting `1` is useful command output. A failure to materialize, refresh, or reconcile is a projection/platform failure.

### Reconciliation

After execution, reconciliation classifies runtime state by mounted authority. Workspace-owned writable paths may be reconciled into the working copy. Runtime-local paths remain runtime-local. Source-backed read-only paths are not mutated; changes to those view paths are reconciled as Workspace overlay writes if allowed. Paths outside the projected host boundary remain runtime-owned. Unsupported or oversized files may reject reconcile before any durable mutation happens.

Reconcile is explicit and bounded. Runtime changes do not become durable merely because a command exits.

### Reuse or destroy

A projection can be reused while its backing working copy remains valid. Reuse is valuable because runtime-local state such as `node_modules`, `.venv`, or build caches can survive across commands without becoming Workspace state.

Projection lifetime is not working-copy lifetime. Destroying a Sandbox can lose runtime-local state, but it does not discard reconciled Workspace files. Discarding a working copy invalidates projections that depend on it. Applying a working copy may close or invalidate projections depending on product lifecycle, but apply still happens through trusted Workspace control, not through the runtime.

Runtime-local state is scoped to the projection and the proposed future it supports. A warm dependency cache belongs to that working copy's execution context, not to the global project.

### Agent-facing lifecycle rule

If an agent edits a file through one tool and then runs a Sandbox command, the command should see the edit. If a Sandbox command preserves dependencies and the agent later edits source through a Dynamic Worker, the next Sandbox command should refresh source while preserving dependency cache.

The adapter owns that freshness/reconcile lifecycle. The agent should see truthful results, not manage materialization details.

## Lifecycle verbs

### Hydration

Hydration fetches bytes from the authority that owns them so they can be read, searched, materialized, or cached.

Examples:

- reading an R2 blob for a Workspace-owned file;
- fetching a GitHub blob from a source snapshot authority;
- filling a runtime cache before command execution;
- caching a source read in a product-owned cache.

Hydration makes bytes available. It does not by itself change ownership, publish files, or materialize a runtime filesystem.

### Materialization

Materialization is the act of making files from an authority or mounted view physically available in a runtime-specific representation.

Examples:

- writing Workspace files into a Sandbox directory;
- writing source snapshot files into a Sandbox directory;
- turning mounted view files into Worker Loader module strings;
- populating a local runtime cache from hydrated bytes.

Materialization is not ownership transfer and not publication.

### Refresh

Refresh updates a runtime projection from the current state of its backing authorities.

For a Sandbox projection, refresh might update `/workspace/src` from the latest source snapshot plus Workspace overlay while preserving runtime-local `/workspace/node_modules`.

Refresh exists because materialized runtimes can become stale. If a Dynamic Worker edits a working copy after a Sandbox view was materialized, the Sandbox projection must either refresh before the next command or detect that it is stale.

### Reconciliation

Reconciliation compares runtime-side state with backing authorities and decides how accepted changes move back into those authorities.

For a Sandbox projection, reconciliation may scan a filesystem tree, classify files by mount owner, detect created/modified/deleted files, ignore runtime-local mounts, and reject unsupported entries.

Reconciliation may produce a plan before it mutates anything. A plan can identify files to create, modify, delete, ignore, or reject. That makes all-or-nothing reconcile possible: if scanning discovers a stale baseline, unsupported entry, or oversized file, the projection can fail before writing half the changes into Workspace.

This planning step also gives agent tools a truthful summary. The agent can tell the user which files were reconciled, which were ignored as runtime-local, and which blocked reconcile.

### Reconcile

Reconcile applies an accepted reconciliation plan to a durable writable authority, usually a Workspace working copy.

Reconcile does not publish. It only makes runtime results durable inside the working copy.

```text
Sandbox /workspace/src/index.ts changed
  -> reconcile
  -> Workspace working copy /src/index.ts changed
  -> apply or export later if trusted product code chooses
```

## Consistency and boundary reporting

A consistency contract describes when a projection is fresh, when it can diverge, and how it becomes consistent again.

| Access shape                     | Freshness model                                      | Write path                     | Reconciliation point                       |
| -------------------------------- | ---------------------------------------------------- | ------------------------------ | ------------------------------------------ |
| Dynamic Worker scoped capability | Each operation calls the authority                   | Directly into the working copy | Per operation                              |
| Sandbox filesystem projection    | Local materialized view can diverge during execution | Runtime filesystem first       | Refresh/reconcile boundaries               |
| Source snapshot                  | Stable once resolved                                 | Usually read-only              | Import, overlay, or product source refresh |
| Runtime-local cache              | Runtime-owned                                        | Runtime filesystem             | No Workspace freshness guarantee           |

This language matters because Workspace is used in distributed systems. A product cannot have local filesystem performance, arbitrary long-running execution, immediate global consistency, and conflict-free writes for free. Projection boundaries make the tradeoffs explicit.

It also matters for agent reliability. If a Sandbox view may be stale until refresh, or if a command did not reconcile files, the tool contract must say so. Otherwise the agent will reason from a false filesystem model.

Workspace projections have distributed-systems tradeoffs even though Workspace is not a distributed POSIX filesystem.

### Generation and projection tokens

A generation is a monotonic version for an authority's file state. A working copy generation could increment on writes, deletes, and reconciles. A source snapshot generation is its resolved immutable version. A runtime-local authority may have only runtime-owned versioning.

A projection token or lease is one possible implementation mechanism for coordination. For example, a Sandbox projection may know it materialized working copy generation 42. If the working copy reaches generation 43 before reconcile, the projection may need to refresh or reject reconcile.

Generation is likely to become important as projections become long-lived. Lease/token mechanics should remain implementation details until a public API needs them.

### Boundary-reporting principle

Workspace should not force every runtime action into one universal result shape. Different boundaries need different reports.

Useful boundary types include:

- **File operation:** read, write, list, stat, delete through a file authority.
- **Execution step:** Dynamic Worker code, Sandbox shell command, interpreter run.
- **Projection step:** attach, materialize, refresh, reconcile.
- **Publication step:** apply or discard.
- **Source step:** resolve, mount, import, hydrate, or export external file state.

The system should be quiet about routine mechanics and explicit at semantic boundaries. An agent does not need to hear about every blob read from R2 or every file refreshed into a Sandbox when everything is routine. It does need to know when the meaning of file state changes.

Semantic boundaries include:

- external source state becoming Workspace-owned state;
- source state being mounted as a read-only base;
- runtime-local state becoming durable working-copy state;
- durable working-copy state becoming current files;
- a working-copy overlay being exported to an external source;
- a materialized runtime view refreshing from an authority;
- a projection becoming stale or refusing reconcile;
- an authority rejecting a read or write;
- execution failing versus the platform/projection failing;
- files being ignored, rejected, or summarized because they are too large or unsupported.

The reporting obligation is therefore:

> Every time file state crosses an authority boundary, projection boundary, publication boundary, or export boundary, the system should report enough structured information for platform code and agents to distinguish authority, durability, and publication.

That does not mean every operation returns a giant audit log. Direct file operations can be concise. Sandbox command results need more detail because a shell can produce many filesystem effects behind one command. Hydration can stay invisible unless it fails or matters for provenance, cost, or latency.

The practical split is:

- Workspace and adapters enforce and report file-state truth: authority, access, runtime-local versus durable state, reconcile, publication, staleness, and failures.
- Platforms decide intent: source choice, runtime choice, working-copy lifecycle, artifacts, approvals, retention, and whether to apply or export.
- Agents decide action: inspect, edit, run code, run shell commands, diagnose failures, and summarize without overclaiming publication.

Workspace makes file-state truth machine-readable. Adapters make that truth runtime-native. Platforms decide intent. Agents act on truthful, bounded tool outputs.

## Search as a model test

Search is a useful test of whether the vocabulary is doing real work.

If a project is a mounted view, grep should search the view, not only Workspace-owned entries and not blindly every runtime-local file. This is an adapter/tool concern rather than a required Workspace-core grep API. Overlay semantics matter:

- changed Workspace overlay files shadow source base files;
- tombstones hide deleted source base files;
- runtime-local mounts such as `node_modules` are skipped unless the tool explicitly targets them;
- source reads may hydrate bytes from the source authority;
- outputs should be bounded and report skipped files or hydration failures.

An agent should be able to ask a project-level search tool for matches without knowing which files are source-owned, Workspace-owned, or cached. The tool should still return truthful details when those distinctions affect correctness.

## Why adapters are critical

The Workspace core cannot solve runtime-specific or source-specific mechanics without becoming execution-shaped or source-shaped. But product authors should not have to solve those mechanics from scratch.

Adapters are the layer that makes the model practical. They are also the layer that makes agent tools trustworthy: a `run` tool, a `shell` tool, a source import/export flow, and a future preview tool can each expose the right semantics while sharing Workspace's apply/discard boundary for Workspace-owned state.

### Dynamic Worker adapter responsibilities

A Dynamic Worker adapter should handle:

- Worker Loader harness construction;
- passing scoped file capabilities through Worker RPC safely;
- hiding RPC DTO details from loaded code;
- ensuring delegated code receives file authority but no apply authority;
- returning outputs that distinguish delegated-code results from platform failures;
- future module and asset projections from Workspace-backed or source-backed views.

Dynamic Workers are naturally capability-oriented. They do not need full filesystem materialization for the common case.

### Sandbox adapter responsibilities

A Sandbox adapter should handle:

- binding a mounted view to a Sandbox filesystem path such as `/workspace`;
- materializing Workspace-backed and source-backed mounts;
- preserving runtime-local mounts such as dependency caches;
- refreshing tracked files before execution when needed;
- running commands with the right working directory;
- distinguishing command failure from projection failure;
- reconciling runtime filesystem changes;
- reconciling Workspace-owned changes into Workspace-backed writable authorities;
- exposing useful command and reconciliation summaries that an agent can repeat without overclaiming publication.

A Sandbox adapter can be opinionated about Sandbox mechanics without putting Sandbox concepts into Workspace core.

### Source adapter responsibilities

A source adapter should handle:

- resolving mutable references to stable snapshots;
- exposing source files as import entries or read-only file authorities;
- preserving provenance metadata when available;
- fetching bytes lazily or eagerly according to the source's economics;
- exporting Workspace-owned overlays back to the external system when the product asks.

Source adapters depend on Workspace concepts. Workspace should not depend on source-specific lifecycles. Export may read a composed view, but it writes through product/source-adapter code; Workspace core does not decide patch shape, pull request behavior, or remote mutation.

## What Workspace should and should not own

Workspace and its core package should own:

- the durable product-owned authority root;
- Workspace-owned current files, working copies, revisions;
- publication semantics for Workspace-owned state;
- source-independent tree write primitives;
- minimal runtime-independent file authority interfaces;
- shared reconciliation vocabulary;
- safety invariants that apply to Workspace-owned file state regardless of runtime.

Workspace should not own:

- command execution;
- Sandbox lifecycle;
- Dynamic Worker loading;
- agent orchestration;
- package-manager semantics;
- Git branches, remotes, merge, rebase, or status;
- source-specific lifecycles;
- external source byte ownership;
- artifact lifecycle;
- arbitrary object-bucket mounting;
- full distributed POSIX behavior.

Adapters should own runtime-specific and source-specific projection behavior. Products should own user intent and domain language.

## Design tests

A proposed term or API belongs in this model only if it answers a distinct question.

- File authority: who owns this file state?
- Workspace: where does product-owned durable file state live?
- Working copy: where do durable unpublished changes accumulate?
- Source snapshot: which stable external file authority is the view based on?
- Mounted view: what path namespace is being presented?
- Mount: which authority owns this path prefix?
- Overlay: how do writable Workspace changes compose over a read-only base?
- Projection: how does this view appear in this runtime?
- Runtime adapter: who knows execution-runtime mechanics?
- Source adapter: who knows external-source mechanics?
- Runtime-local state: what exists for execution but is not Workspace state?
- Artifact authority: what valuable output is retained without becoming current Workspace files?
- Hydration: how do bytes behind an authority become available?
- Materialization: how do files become locally usable in a runtime?
- Refresh: how does local runtime state catch up to the authority?
- Reconciliation: how are local runtime changes classified and planned?
- Reconcile: when do runtime changes become durable in a writable authority?
- Apply: when does durable unpublished Workspace state become current?
- Export: when does Workspace-owned state leave Workspace for an external system?
- Consistency contract: when can this view be stale, and how is that handled?

If a new concept cannot answer a distinct question, it should not become part of the vocabulary. A useful extra test is whether an agent-facing tool could explain the concept without leaking implementation internals or lying about durability.

## Open questions

These questions should be resolved by future design and implementation work, not guessed in this document.

- What is the smallest public API that expresses mounted views without making simple products think about every authority explicitly?
- Should mounted views be a Workspace core API, an adapter-level API, or a shared lower-level contract?
- How should runtime-local mounts be represented so common project behavior is easy without relying on fragile global ignore lists?
- How should source snapshot authorities compose with Workspace-owned overlays in product APIs?
- What generation mechanism is needed for long-lived Sandbox projections?
- How should reconciliation failures remain atomic when scanning discovers large files, unsupported entries, or stale baselines?
- How should artifacts be represented when outputs are valuable but should not become current Workspace files?
- Which parts of this vocabulary should be public user-facing language, and which should remain implementation/design language?

## North star

Workspace is the durable product-owned file authority root. Runtime adapters expose Workspace-backed, source-backed, runtime-local, and artifact authorities as mount-like views native to each execution environment. Execution can produce files, but only the mounted authority for a path decides whether those files become durable Workspace state. Trusted product code decides whether durable Workspace-owned state becomes current or exported.

This model should be clear enough for platform code and for AI agents operating through tools. If the system cannot explain where a file came from, who owns it, whether it was reconciled, and whether it was applied or exported, then the abstraction is not finished.
