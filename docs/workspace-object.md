# WorkspaceObject

Workspace should use Durable Objects for coordination, not as a custom file
backend.

Artifacts remains the durable file authority: repository contents, commits,
forks, Git remotes, and tokens belong there. WorkspaceObject is the per-
Workspace Durable Object that records the small amount of durable control
metadata Workspace needs in order to use Artifacts reliably from Workers today.

## Why this exists

The current Artifacts binding exposes two useful but different surfaces.
Lifecycle operations such as `create`, `import`, and `fork` return plain
serializable metadata, including the repository remote and default branch.
Later lookup through `get` returns a live RPC repository handle. That handle is
excellent for methods such as `createToken`, but its data fields are not a
stable source of serializable metadata across local remote bindings and Worker
RPC boundaries.

Workspace therefore needs a durable place to remember the non-secret metadata
returned at lifecycle boundaries. Keeping that in isolate memory is too fragile;
keeping it in app-specific Agent state makes every caller reinvent the same
workaround. A per-Workspace Durable Object is the right coordination atom.

## Responsibility split

```text
Artifacts
  owns versioned file state, bytes, commits, forks, remotes, and token minting

WorkspaceObject
  owns Workspace control metadata for one Workspace

Agents / product Workers
  own user intent, chat state, UI state, and apply/discard decisions

Runtime adapters
  own Dynamic Worker loading, Sandbox execution, and runtime projection mechanics
```

WorkspaceObject does not make Workspace a custom storage backend again. It is a
small control object over Artifacts, not a file tree store.

## What WorkspaceObject stores

WorkspaceObject stores durable metadata such as:

- the Artifacts repository name for current files;
- the repository remote URL needed by the temporary Git driver;
- the branch/ref Workspace should use for that repository;
- working-copy repository names and their base repository;
- timestamps or lightweight lifecycle metadata needed for cleanup.

It should not store:

- file bytes;
- Git objects;
- revisions or snapshots independent of Artifacts;
- plaintext tokens;
- Sandbox state;
- Dynamic Worker state;
- agent chat/session state;
- source-specific lifecycle such as GitHub branches, PRs, or remotes.

Tokens are minted on demand from Artifacts with `repo.createToken(...)` and are
not persisted by WorkspaceObject.

## Shape

Workspace construction should make both authorities explicit:

```ts
const workspace = Workspace.fromArtifacts({
  artifacts: env.ARTIFACTS,
  object: env.WORKSPACE_OBJECTS.getByName(workspaceName),
  name: workspaceName,
});
```

The object is sharded by Workspace name. There should not be one global
Workspace registry Durable Object.

Workspace operations then coordinate with both authorities:

- creating or importing current files records the Artifacts repository metadata
  in WorkspaceObject;
- creating a working copy forks the Artifacts repository and records the copy
  metadata in WorkspaceObject;
- reading and writing file bytes still goes through Artifacts, using temporary
  internal Git plumbing while direct Artifacts file mutation APIs are missing;
- applying a working copy publishes through Artifacts and clears copy metadata;
- discarding a working copy deletes the Artifacts fork and clears copy metadata.

## Boundary

WorkspaceObject exists because current Artifacts APIs do not yet expose the
exact direct file mutation and serializable repository-access methods Workspace
needs. If Artifacts later grows those APIs, WorkspaceObject may shrink. Until
then, it is the durable coordination layer that keeps Workspace usable without
recreating a file backend.

The design rule is:

```text
Use Durable Objects for Workspace identity and coordination.
Use Artifacts for Workspace file authority.
```
