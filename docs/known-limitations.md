# Known limitations

Accepted gaps in the current prototype. Each entry is intentional today and should be removed when it stops being intentional.

## Revisions are full metadata copies

`snapshot()` copies the entire `entries` table into `revision_entries`. Correct for proving immutable revision semantics, but O(N) Durable Object SQLite storage per snapshot.

Revisit when: workspaces hold many files, commits become frequent, or DO SQLite pressure shows up. The likely fix is delta revisions, chunked tree snapshots, or immutable tree objects stored outside DO SQLite.

## Sessions copy full metadata

`beginSession()` copies the current `entries` table into `session_entries`. `commit()` replaces `entries` from that copy. Correct for proving isolated working-copy semantics, but O(N) at begin/commit and O(N) storage per open session.

Same likely fix: copy-on-write metadata, deltas, or immutable tree objects.

## No blob garbage collection

R2 file contents are content-addressed and retained even after files are deleted or overwritten. Keeps metadata and blob writes independent during the prototype.

Long-term, we need blob reachability across mutable head and immutable revisions, and a GC path.

## Missing blob references look like missing files

If metadata points at a blob that isn't in R2, `readFile()` returns `PathNotFoundError`. That's adequate for the prototype, but it's really storage corruption and should eventually have a distinct error and an observability signal.

## Filesystem projection scans host files

The current projection materialises files into the Sandbox filesystem and hashes host files during `flush()` to detect changes. Proves `/workspace` semantics for the demo; it's not the production mount.

Long-term: a mount-like implementation that avoids full-tree scans and avoids reading unchanged file contents back into the Worker.

## Dynamic Worker module and asset projections aren't built

The prototype validates scoped Dynamic Worker file capabilities over a draft. It does not yet load Dynamic Worker modules or static assets from Workspace trees.

These are documented projections in [`product-model.md`](./product-model.md); they're just unimplemented.

## No session garbage collection

Sessions left open indefinitely retain `session_entries` indefinitely. No TTL, sweep, list, or purge API. Callers must explicitly `commit()` or `discard()`.

Needed before high-volume or untrusted session creation.

## No merge or rebase

Sessions record the head version they started from. `commit()` rejects stale sessions. That's the safety boundary; there's no merge, rebase, or conflict-detail model yet. Callers can inspect and discard, but Workspace doesn't yet help reconcile.

## No revision pruning

Revisions and the blobs they reference are retained indefinitely. No retention policy, pruning, or export semantics. Keep this outside the core model until revision usage patterns are clearer.

## The user-facing API isn't built

The prototype exposes sessions, RPC result DTOs, scoped capabilities, and filesystem projection helpers directly. The target shape in [`product-api.md`](./product-api.md) — `workspace.files.copy(...)`, `attachment.capture()`, `copy.apply()` — is the next product layer.

Until that exists, callers (including `examples/photo-agent-demo`) handle the lower-level shape directly.
