# Known limitations

These are accepted limitations of the current Workspace prototype. Keep this file short and remove entries when they are resolved or no longer relevant.

## Revisions are full metadata copies

`commit()` copies the current `entries` table into `revision_entries`.

This is correct for proving immutable revision semantics, but it is O(N) Durable Object SQLite storage per commit. Long-term, Workspace may need delta revisions, chunked tree snapshots, or immutable tree objects stored outside Durable Object SQLite.

Revisit when:

- workspaces can contain many files,
- commits become frequent,
- container working-copy commits are introduced,
- Durable Object SQLite storage pressure becomes relevant.

## No blob garbage collection

R2 file contents are content-addressed and retained even after files are deleted or overwritten.

This avoids metadata/blob atomicity problems for now. Long-term, Workspace needs blob reachability and garbage collection across mutable head and immutable revisions.

## Missing blob references are not distinct errors

If metadata points at a missing R2 blob, `readFile()` currently returns `PathNotFoundError`.

That is sufficient for the prototype, but long-term this is storage corruption or an internal consistency failure and should likely have a distinct error and observability path.

## No base-revision conflict model

Workers currently mutate one current head, and `commit()` snapshots that head.

Container working-copy commits will likely need a base revision and conflict handling so a working copy can explicitly commit changes without silently overwriting concurrent writes.

## No revision pruning

Revisions and the blobs they reference are retained indefinitely.

Long-term, Workspace needs retention policy, pruning, or export semantics. Keep this outside the core model until revision usage patterns are clearer.
