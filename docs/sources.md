# Sources

A Workspace doesn't know where its files came from. Uploaded bytes, a checkout of a GitHub repo, a Hugging Face model snapshot, a slice of an S3 bucket — they all land in Workspace the same way: as durable files in a tree.

This doc explains why that matters, what stays out of Workspace, and how products bridge external systems into a Workspace.

For the conceptual model, see [`product-model.md`](./product-model.md). For boundaries, see [`product-boundaries.md`](./product-boundaries.md).

## The split

External systems have their own lifecycle. A GitHub branch moves. An S3 object is overwritten. A Hugging Face revision is reissued. Artifacts versions expire.

Workspace doesn't track any of that. It owns the file state a product chose to import, and that's it. If `main` moves on GitHub, the Workspace doesn't change. If a model revision is replaced, the imported files don't change.

That's deliberate. Workspace is meant to be a stable, inspectable, publishable working tree. Reasoning about it has to be possible without reasoning about every system it might have been seeded from.

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

## Adapters live outside

The product code that talks to GitHub, Hugging Face, S3, or anywhere else is an **adapter**. Adapters are not part of Workspace. They live in product code, in separate packages, in whatever shape fits the source.

Anyone should be able to write one. The interface Workspace needs to support them is small:

- A way to write file bytes into current files or a file copy.
- A way to record where those bytes came from, if the product cares.
- A way to read them back.

No part of Workspace core depends on a specific adapter, and no adapter needs Workspace's permission to exist.

## Provenance, not auto-sync

Workspace can record where a file came from as part of its metadata — adapter id, source ref, source version, source path. That's useful for products that want to:

- Show "this came from `github.com/foo/bar@abc123`" in a UI.
- Generate an export patch against the original ref.
- Skip re-importing a file whose source version hasn't changed.

It does not mean Workspace watches the source. There is no background sync, no rebase-on-import, no automatic refresh. If a product wants those, they're product behavior on top of Workspace primitives.

The rule is: **provenance is recorded, but lifecycle stays with the source.**

## Hydration modes

Adapters don't have to copy everything into Workspace eagerly.

- **Eager import.** Read the source bytes, write them as Workspace files. Simple. Right for small repos, uploads, small datasets, generated outputs. This is what the prototype does today for everything.
- **Reference.** Record the source ref and a digest if available; don't copy bytes until a runtime needs them. Right for large model weights, large datasets, or sparse access. Requires a hydration step at use time.
- **Cached external.** Like reference, but Workspace stores a copy of the bytes after the first read. Subsequent reads are local. The source ref + version is the cache key.
- **Overlay.** The Workspace holds only the diff relative to a source snapshot. Right for coding-agent edits against a large repo, where most files are unchanged and exporting a patch is the goal. Requires a real source-snapshot anchor.

The prototype only implements eager import. The other modes are real future work, but the choice is per-adapter and per-file, not a global Workspace setting.

## Internal R2 is not a source

A product can build an "external R2 source adapter" that imports from a user's R2 bucket. That is not the same thing as the internal R2 bucket Workspace uses for its own content storage.

- **Internal R2 (`WORKSPACE_BLOBS`).** Workspace's content store. Lifecycle owned by Workspace. Should be treated as private implementation detail; products shouldn't read or write it directly.
- **External R2 source.** A bucket the product owns. Lifecycle owned by the product. Workspace reads through an adapter, same as any other source.

The fact that both happen to be R2 is incidental. The boundary is who owns the lifecycle.

## Export is the inverse

The same shape works in reverse. A product can:

- Generate a patch from a Workspace draft and open a GitHub PR.
- Upload a Workspace revision's files to a Hugging Face model repo.
- Sync a directory in current files to an S3 prefix.
- Hand a Workspace revision tree to Artifacts as a Git push.

None of that is Workspace core. Workspace exposes the file state; product adapters do the export. Same direction-of-dependency rule as import.

## What this means for products

A coding agent, a data-science agent, a publishing pipeline, a generated-app preview — each one will need at least one source adapter, sometimes several. The pattern is consistent:

1. The product resolves a source snapshot (commit SHA, revision id, manifest).
2. The product imports or references files into a Workspace.
3. The agent (or user) edits a working copy.
4. The product exports the result somewhere — back to the source, to a different destination, or nowhere.
5. The product decides retention.

Workspace's job is steps 2 through (whatever the product calls) 4. Steps 1 and 5 are firmly product territory.

## See also

- [`product-model.md`](./product-model.md) — what Workspace is conceptually.
- [`product-boundaries.md`](./product-boundaries.md) — what stays out.
- [`known-limitations.md`](./known-limitations.md) — including the current "file content always equals R2 blob" assumption, which gets in the way of non-eager source modes.
