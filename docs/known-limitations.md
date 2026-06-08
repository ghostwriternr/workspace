# Known limitations

Accepted gaps in the current prototype. Each entry is intentional today and should be removed when it stops being intentional.

## File mutation uses temporary internal Git plumbing

Workspace is backed by Artifacts, but Artifacts does not yet expose direct file write, commit, and apply/discard APIs. `packages/workspace` currently uses internal `isomorphic-git` + in-memory filesystem plumbing to clone, edit, commit, and push repositories.

That plumbing is intentionally hidden behind `Workspace.fromArtifacts(...)`. It should be deleted when Artifacts exposes first-class file mutation APIs.

## Writes clone repositories in memory

Current reads use shallow clones where possible, but writes and apply paths need enough Git history and objects to push successfully. Large repositories can be slow or memory-heavy.

This is a migration-era implementation detail, not a Workspace API promise.

## Empty directories are not durable entries

Artifacts/Git does not preserve empty directories. Workspace can infer directories from file paths for `list` and `stat`, and scoped writes create parent paths as needed, but an empty `mkdir` with no files under it is not a durable artifact in the current backend.

If real callers need durable empty directories, the Artifacts file API or Workspace layer needs an explicit representation.

## No source provenance

Files imported from a GitHub commit, an S3 prefix, or any other external source aren't tagged with where they came from. Adapters can't tell which files have changed relative to their source, can't skip re-imports, and can't generate a clean export patch without doing their own bookkeeping. See [`sources.md`](./sources.md) and the metadata categories in [`product-model.md`](./product-model.md) for the shape this should take.

## Filesystem projection scans host files

The current projection materializes files into the Sandbox filesystem and hashes host files during reconcile to detect changes. Proves `/workspace` semantics for the demo; it's not the production mount.

Long-term: a mount-like implementation that avoids full-tree scans and avoids reading unchanged file contents back into the Worker.

## GitHub import depends on Artifacts import behavior

The coding-agent demo imports public GitHub repositories through Artifacts. Workspace does not currently provide a separate GitHub source adapter, preserve source provenance, or control GitHub-specific import details such as symlink handling.

Future options include source provenance, source-backed mounted views, or product-owned source adapters when a caller needs import behavior that differs from Artifacts.

## Dynamic Worker module and asset projections aren't built

The prototype validates scoped Dynamic Worker file capabilities over a working copy. It does not yet load Dynamic Worker modules or static assets from Workspace trees.

These are documented projections in [`product-model.md`](./product-model.md); they're just unimplemented.

## No file-copy cleanup

File copies left open indefinitely remain as Artifacts forks. Callers must explicitly apply or discard them; there's no sweep, no TTL, and no orphan recovery. Needed before high-volume or untrusted copy creation.

## No revision pruning

Revisions are retained by the Artifacts repository history. There is no Workspace-level retention policy, pruning, or export semantics. Keep this outside the core model until revision usage patterns are clearer.
