# Known limitations

These are accepted limitations of the current Workspace prototype. Keep this file short and remove entries when they are resolved or no longer relevant.

## Revisions are full metadata copies

`snapshot()` copies the current `entries` table into `revision_entries`.

This is correct for proving immutable revision semantics, but it is O(N) Durable Object SQLite storage per snapshot. Long-term, Workspace may need delta revisions, chunked tree snapshots, or immutable tree objects stored outside Durable Object SQLite.

Revisit when:

- workspaces can contain many files,
- commits become frequent,
- container working-copy commits are introduced,
- Durable Object SQLite storage pressure becomes relevant.

## No blob garbage collection

R2 file contents are content-addressed and retained even after files are deleted or overwritten.

This keeps metadata and blob writes independent during the prototype. Long-term, Workspace needs blob reachability and garbage collection across mutable head and immutable revisions.

## Missing blob references are not distinct errors

If metadata points at a missing R2 blob, `readFile()` currently returns `PathNotFoundError`.

That is sufficient for the prototype, but long-term this is storage corruption or an internal consistency failure and should likely have a distinct error and observability path.

## Sessions copy full metadata

`beginSession()` copies the current `entries` table into `session_entries`, and `commit()` on a session replaces `entries` from that full copy.

This is correct for proving isolated working-session semantics, but it is O(N) Durable Object SQLite storage per open session and O(N) metadata work at begin/commit time. Long-term, sessions may need copy-on-write metadata, deltas, or immutable tree objects.

## No session garbage collection

Sessions left open indefinitely retain `session_entries` rows indefinitely.

There is no TTL, sweep, list, or purge API yet. Callers must explicitly `commit()` or `discard()` sessions. Long-term, Workspace needs session expiration or garbage collection before supporting high-volume or untrusted session creation.

## No merge or rebase model

Sessions record the head version they started from, and `commit()` rejects stale sessions when the head has newer changes.

That proves the safety boundary, but there is no merge, rebase, or conflict-detail model yet. Callers can inspect and discard a conflicted session, but Workspace does not yet help reconcile it with the newer head.

## No revision pruning

Revisions and the blobs they reference are retained indefinitely.

Long-term, Workspace needs retention policy, pruning, or export semantics. Keep this outside the core model until revision usage patterns are clearer.
