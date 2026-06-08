# Known limitations

Accepted gaps in the current prototype. Remove entries when they stop being
true.

## Target API is not fully implemented

The docs describe the target API shape:

```ts
const workspaces = Workspace.bind({ artifacts, objects });
const workspace = workspaces.get(name);
const copy = await workspace.copies.create({ label: "agent-edit" });
```

The current code still exposes transitional surfaces such as
`Workspace.fromArtifacts({ artifacts, object, name })` and
`workspace.files.copy(...)`. Example import/create flows also still perform some
manual WorkspaceObject metadata registration.

Those names are implementation debt, not product direction.

## File mutation uses temporary internal Git plumbing

Workspace is backed by Artifacts, but Artifacts does not yet expose direct file
write, commit, and apply/discard APIs for the full Workspace flow.
`packages/workspace` currently uses internal `isomorphic-git` plus an in-memory
filesystem to clone, edit, commit, and push repositories.

That plumbing is hidden behind the Workspace API. It should be deleted when
Artifacts exposes first-class file mutation primitives.

## Writes can be memory-heavy

Current write and apply paths may need enough Git history and objects to push
successfully. Large repositories can be slow or memory-heavy.

This is an implementation limitation of the temporary Git bridge, not a
Workspace API promise.

## Apply conflict semantics need hardening

A working copy should record the current/base revision it was created from.
`apply()` should fail with a stale-base/conflict error if current files changed
before the copy is applied.

The current Artifacts-backed apply path still needs this default safety before
Workspace is suitable for concurrent product use.

## Empty directories are not durable entries

Artifacts/Git does not preserve empty directories. Workspace can infer
directories from file paths for `list` and `stat`, and scoped writes can create
parents as needed, but an empty `mkdir` with no files beneath it is not durable
in the current Artifacts-backed prototype.

If real callers need durable empty directories, the Artifacts file API or
Workspace layer needs an explicit representation that does not turn Workspace
into a parallel file store.

## Source provenance is not modeled yet

Source adapters can import or seed Workspace state, but Workspace does not yet
record where files came from. That limits display, export, and adapter-specific
change calculation.

Provenance should be metadata about Workspace state, not source lifecycle or
auto-sync.

## GitHub import is adapter-shaped but not clean yet

The coding-agent demo imports public GitHub repositories through Artifacts, but
some implementation details still leak through the demo controller. The target
shape is a source adapter that targets a Workspace handle and hides Artifacts
metadata plumbing from product code.

## Sandbox adapter still materializes and scans

The current Sandbox adapter materializes files into the Sandbox filesystem and
scans/hashes host files after each command. This proves `/workspace` semantics,
but it is not the desired Artifacts-backed Sandbox implementation.

The target direction is an `artifact-fs` FUSE mount over the working-copy
Artifacts repository, with Sandbox outbound Workers/TLS auth injecting
short-lived Artifacts Git credentials outside the container. That should avoid
full-tree materialization, avoid scanning unchanged files, and keep tokens out
of sandboxed code.

## Runtime-local mounts are basic

The current Sandbox adapter does not deeply model runtime-local authorities such
as `node_modules`, `.venv`, compiler caches, or scratch directories. Products
can still avoid publishing those paths by controlling commands and scopes, but a
richer runtime-local mount model is future adapter work.

## Dynamic Worker module and asset projections are not built

The prototype validates scoped Dynamic Worker file capabilities over a working
copy. It does not yet load Dynamic Worker modules or static assets from
Workspace trees.

## No working-copy cleanup

Working copies left open indefinitely remain as Artifacts forks. Callers must
explicitly apply or discard them; there is no sweep, TTL, or orphan recovery.

## No revision retention policy

Revisions are retained by the Artifacts repository history. There is no
Workspace-level retention, pruning, or export policy yet.
