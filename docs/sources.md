# Sources

A Workspace doesn't own external sources. Uploaded bytes, a checkout of a GitHub repo, a Hugging Face model snapshot, a slice of an S3 bucket — a product may import them into Workspace-owned files, or it may mount a stable source snapshot beside a Workspace-owned writable layer.

This doc explains why that matters, what stays out of Workspace, and how products bridge external systems into a Workspace.

For the conceptual model, see [`product-model.md`](./product-model.md). For boundaries, see [`product-boundaries.md`](./product-boundaries.md).

## The split

External systems have their own lifecycle. A GitHub branch moves. An S3 object is overwritten. A Hugging Face revision is reissued. Artifacts versions expire.

Workspace doesn't track any of that. It owns the file state a product chose to import or write into Workspace-owned layers, and that's it. If `main` moves on GitHub, a previously resolved source snapshot doesn't move. If a model revision is replaced, imported Workspace files don't change.

That's deliberate. Workspace is meant to provide stable, inspectable, publishable file state. Reasoning about it has to be possible without letting every external lifecycle leak into Workspace core.

## What a "source" is

A source is whatever a product treats as the upstream for some files. Examples:

- A Git ref (GitHub, GitLab, [Artifacts](https://developers.cloudflare.com/artifacts/)).
- A Hugging Face model or dataset at a specific revision.
- A prefix in an S3 or R2 bucket.
- A user upload from a browser.
- Another Workspace revision.

Sources have:

- An **identity** the product understands (`github:owner/repo`, `hf:org/model`, `s3:bucket/prefix`, …).
- A **snapshot** if the source supports it: a commit SHA, a revision id, an etag manifest, a content digest. Strongly-versioned sources let products reason about reproducibility; weakly-versioned ones don't.
- A way to **read** files (and sometimes a way to **list** them).

Workspace itself doesn't need to understand any of that. Products do.

## Source adapters live outside core

The product code that talks to GitHub, Hugging Face, S3, or anywhere else is a **source adapter**. Source adapters are not part of Workspace core. They live in product code or separate packages, in whatever shape fits the source.

The Workspace ecosystem can provide source adapter packages, but the dependency direction stays the same: source adapters consume Workspace concepts; Workspace core does not depend on source-specific lifecycles.

Anyone should be able to write one. The integration surface stays small:

- Workspace core needs source-independent tree write primitives for eager import.
- The broader Workspace ecosystem needs shared file-authority concepts for products that want source-backed views.
- Products may record provenance for Workspace-owned bytes, if they care.
- Source adapters need a way to read source bytes when a view, import, search, or export needs them.

No part of Workspace core depends on a specific adapter, and no adapter needs Workspace's permission to exist.

## What a source adapter does

For eager import, a source adapter is small. The shape it exposes to product code is roughly:

- **Resolve a snapshot.** Take whatever the user gave you (`github:owner/repo@main`, `s3:bucket/prefix`, …) and return an identity plus a strongly-versioned snapshot — a commit SHA, an etag manifest, a revision id. Strong versioning is what lets a product reason about reproducibility.
- **List files in that snapshot.** Yield file records — `{ path, contents, metadata? }` — typically as an async iterable so large sources can stream rather than buffer.
- **Optionally exclude paths.** Skip `.git/`, `node_modules/`, build caches, secrets, anything the product doesn't want imported.

The product creates a file copy, then hands the adapter's iterable to `copy.files.writeTree(root, entries)` (see [`product-api.md`](./product-api.md)). `root` is the absolute Workspace directory where the source should land; each entry path is relative to that root. If the adapter stream fails, the product discards the copy. If import succeeds, the product decides whether to apply the copy. The adapter itself doesn't call `apply` and doesn't hold Workspace identity.

The coding-agent demo imports GitHub repositories through Artifacts because Artifacts is the durable/versioned file authority for that flow. If a product wants to own source import behavior outside Artifacts, it can still implement this adapter shape in product code or a separate package. A trivial S3 or external-R2 source adapter would follow the same pattern against object APIs. Source adapters should stay small: the cost of supporting a new source is bounded, and the surface a product has to trust stays narrow. Future source-backed mounted views will need an additional read-only file authority shape, but that should stay outside Workspace core for the same dependency-direction reason.

## Provenance, not auto-sync

Workspace can record where a file came from as part of its metadata — adapter id, source ref, source version, source path. That's useful for products that want to:

- Show "this came from `github.com/foo/bar@abc123`" in a UI.
- Generate an export patch against the original ref.
- Skip re-importing a file whose source version hasn't changed.

It does not mean Workspace watches the source. There is no background sync, no rebase-on-import, no automatic refresh. If a product wants those, they're product behavior on top of Workspace primitives.

The rule is: **provenance is recorded, but lifecycle stays with the source.**

## Ways sources participate

Adapters don't have to copy everything into Workspace eagerly.

- **Eager import.** Read the source bytes, write them as Workspace-owned files. Simple. Right for small repos, uploads, small datasets, generated outputs. This is what the prototype does today for everything.
- **Mounted source snapshot.** Resolve the source to a stable snapshot and expose it as a read-only file authority in a mounted view. Right for large repos, model weights, datasets, or sparse access. Workspace does not own unchanged source bytes in this mode.
- **Workspace overlay.** Compose a Workspace-owned writable layer over a source snapshot. Reads see overlay changes first and then source files. Writes and deletes land in Workspace-owned state. Right for coding-agent edits where most source files are unchanged and export is the likely outcome.
- **Product cache.** Cache source bytes in product- or Workspace-owned storage after reads, without changing the source's ownership. Useful for latency and rate limits; cache lifecycle must be explicit.

The prototype only implements eager import. The other modes are real future work. The important boundary is ownership: importing makes bytes Workspace-owned; mounting keeps bytes source-owned; overlay writes are Workspace-owned.

## External object storage is a source

A product can build an R2 or S3 source adapter that imports from a bucket it owns. That bucket remains an external source authority: its lifecycle, auth, retention, and refresh behavior belong to the product adapter, not Workspace core.

Artifacts is different in this prototype because Workspace uses it as the durable/versioned Workspace authority. External object stores, GitHub, Hugging Face, and similar systems remain source authorities unless a product explicitly imports their bytes into Workspace-owned state.

## Export is the inverse

The same shape works in reverse. A product can:

- Generate a patch from a Workspace working copy or overlay and open a GitHub PR.
- Upload a Workspace revision's files to a Hugging Face model repo.
- Sync a directory in current files to an S3 prefix.
- Hand a Workspace revision tree to Artifacts as a Git push.

None of that is Workspace core. Workspace exposes the file state; product adapters do the export. Same direction-of-dependency rule as import.

## What this means for products

A coding agent, a data-science agent, a publishing pipeline, a generated-app preview — each one will need at least one source adapter, sometimes several. The pattern is consistent:

1. The product resolves a source snapshot (commit SHA, revision id, manifest).
2. The product imports files into a Workspace file copy, or mounts a stable source snapshot beside a Workspace-owned working copy/overlay.
3. The agent (or user) edits the Workspace-owned working copy/overlay.
4. The product exports the result somewhere — back to the source, to a different destination, or nowhere.
5. The product decides retention.

Workspace's job is the durable file-state part of steps 2 and 3: represent imported Workspace-owned files, provide working copies or overlays, and preserve edits until the product applies or discards them. Mounted source snapshots and export in step 4 are product/source-adapter work over Workspace-compatible file authorities. Steps 1 and 5 are firmly product territory.

## See also

- [`product-model.md`](./product-model.md) — what Workspace is conceptually.
- [`product-boundaries.md`](./product-boundaries.md) — what stays out.
- [`runtime-projections.md`](./runtime-projections.md) — how sources, file authorities, mounted views, and runtime projections relate.
- [`known-limitations.md`](./known-limitations.md) — including current eager-import and temporary Git-plumbing assumptions.
