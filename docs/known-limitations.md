# Known limitations

Accepted gaps in the current prototype. Each entry is intentional today and should be removed when it stops being intentional.

## Tree state is one shared SQLite, not facets

Head, working copies, and revisions all live in the same SQLite database inside one Durable Object. `beginSession()` copies `entries` into `session_entries`. `commit()` replaces `entries` from that copy. `snapshot()` copies into `revision_entries`. Correct, but O(N) at every fork/commit and O(N) storage per open copy or revision.

The direction this is heading is named in [`architecture.md`](./architecture.md): one facet per tree state, with `ctx.facets.clone()` doing the copies (and using copy-on-write where the platform supports it). The relevant platform APIs aren't shipped yet, so this is a future-implementation item, not an immediate one. In the meantime, the public API should not expose session tables or row-copy behaviour.

## Content is always an R2 blob

Every file entry points at a blob in `WORKSPACE_BLOBS`. That bakes in two assumptions that won't hold for every workload: that Workspace owns the bytes, and that they live in R2. We want a small `ContentRef` shape — see [`architecture.md`](./architecture.md) — so an entry can also point at an external source reference, a cached external reference, or eventually DO-local storage for small/hot files. Until that exists, every file content has to be eagerly imported as R2 bytes.

## No source provenance

Files imported from a GitHub commit, an S3 prefix, or any other external source aren't tagged with where they came from. Adapters can't tell which files have changed relative to their source, can't skip re-imports, and can't generate a clean export patch without doing their own bookkeeping. See [`sources.md`](./sources.md) and the metadata categories in [`product-model.md`](./product-model.md) for the shape this should take.

## No blob garbage collection

R2 file contents are content-addressed and retained even after files are deleted or overwritten. Keeps metadata and blob writes independent during the prototype.

Long-term, we need blob reachability across mutable head and immutable revisions, and a GC path.

## Missing blob references look like missing files

If metadata points at a blob that isn't in R2, `readFile()` returns `PathNotFoundError`. That's adequate for the prototype, but it's really storage corruption and should eventually have a distinct error and an observability signal.

## Filesystem projection scans host files

The current projection materialises files into the Sandbox filesystem and hashes host files during capture to detect changes. Proves `/workspace` semantics for the demo; it's not the production mount.

Long-term: a mount-like implementation that avoids full-tree scans and avoids reading unchanged file contents back into the Worker.

## GitHub source import fetches blobs one by one

The first GitHub source adapter uses GitHub REST tree/blob APIs: resolve a commit, fetch the recursive tree, then fetch each blob as the import stream is consumed. This keeps the adapter small and easy to test, but large repositories will be slow and API-call-heavy.

Future options include bounded concurrent blob fetching, tarball import, sparse import, or reference-based hydration once `ContentRef` exists.

## Dynamic Worker module and asset projections aren't built

The prototype validates scoped Dynamic Worker file capabilities over a draft. It does not yet load Dynamic Worker modules or static assets from Workspace trees.

These are documented projections in [`product-model.md`](./product-model.md); they're just unimplemented.

## No file-copy cleanup

File copies left open indefinitely retain `session_entries` indefinitely. Callers must explicitly apply or discard them; there's no sweep, no TTL, and no orphan recovery. Needed before high-volume or untrusted copy creation.

## No revision pruning

Revisions and the blobs they reference are retained indefinitely. No retention policy, pruning, or export semantics. Keep this outside the core model until revision usage patterns are clearer.
