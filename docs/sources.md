# Sources

Sources are external systems that can provide or receive files: GitHub,
GitLab, Hugging Face, S3, user uploads, another Artifacts repository, or a
product-specific file store.

Workspace core does not own source lifecycle. Source adapters translate external
systems into Workspace work surfaces or export Workspace state back out.

For the product model, see [`product-model.md`](./product-model.md). For
boundaries, see [`product-boundaries.md`](./product-boundaries.md).

## The split

An external source has its own identity, authorization, lifecycle, and version
model. A GitHub branch can move. An S3 object can be overwritten. A Hugging Face
revision can be replaced. Workspace should not absorb those lifecycles.

Workspace owns a named durable work surface over Artifacts-backed file state.
Source adapters own the source-specific work needed to seed or export that work
surface.

```text
Source adapter         Workspace                 Artifacts
-------------          ---------                 ---------
resolve source  --->   work-surface API   --->   durable/versioned files
export result   <---   working-copy state <---   commits/refs
```

## What a source adapter does

A source adapter may:

- resolve a user input such as `owner/repo@main` to a stable source version;
- ask Artifacts or the source API to capture/import that version;
- connect the captured authority to a Workspace;
- stream generated/uploaded files into a working copy when no authority-backed
  capture exists;
- record provenance metadata when the product needs it;
- export a working copy or current files back to the external system.

A source adapter should not require product code to manually handle Artifacts
remotes, default branches, tokens, or WorkspaceObject registration.

Target product code should look like:

```ts
const github = createGitHubSource({ artifacts: env.ARTIFACTS });
const workspace = workspaces.get(workspaceName);

await github.importRepository({
  workspace,
  owner: "cloudflare",
  repo: "sandbox-sdk",
  ref: "main",
});
```

not like product logic that parses repository remotes, default branches, or
Git credentials itself.

An adapter may use a Workspace adoption seam internally after it creates or
imports an Artifacts repository, but ordinary callers should not handle remotes,
default branches, tokens, or WorkspaceObject metadata registration.

## Artifacts changes the import center

Before Workspace used Artifacts as its durable authority, eager source import
looked like this:

```text
source adapter streams every file -> Workspace writes bytes into its own store
```

That should no longer be the default for sources Artifacts can capture.

For GitHub, the better shape is:

```text
GitHub source lifecycle -> Artifacts capture/import -> Workspace work surface
```

The source is still GitHub from the product's point of view. But once the repo
is opened in Workspace, Workspace operates over an Artifacts-backed file
authority. That avoids making Workspace reimplement Git tree storage or stream
large repositories through a Worker unnecessarily.

## Streaming tree sources

Not every source can be captured as an Artifacts-backed authority. Uploads,
generated files, archives, and small external stores may still stream entries
into a working copy.

That path should use bounded tree writes:

```ts
await copy.files.writeTree("/", entries);
```

where `entries` is an iterable or async iterable. The implementation should
chunk by entry count and byte size. It should not buffer an entire large source
in memory.

Streaming tree writes are materialization into Workspace state. They are not a
generic source-overlay engine.

## No Workspace-managed source overlays

Earlier design notes described source snapshots mounted under Workspace-owned
overlays. That remains a useful way to reason about some product experiences,
but it should not push Workspace toward managing path-level overlay entries,
tombstones, or fallback reads itself.

While Artifacts is the durable file authority, Workspace should lean on
Artifacts repositories, commits, refs, and future direct file APIs. If a future
lazy source-view feature is needed, it should be designed around Artifacts and
source-adapter capabilities, not by rebuilding Git/tree semantics inside
WorkspaceObject.

## Provenance

Products may want to remember where files came from:

- adapter id;
- source identity;
- source version;
- source path;
- import time.

That is provenance. It is useful for display, export, and debugging. It is not
auto-sync.

Workspace should not watch GitHub, S3, Hugging Face, or any other source for
changes. A product that wants refresh, compare, or export behavior builds that
above Workspace with source adapters.

## Export

Export is the inverse of import and remains product/source-adapter behavior.
Examples:

- create a GitHub pull request from a working copy;
- upload current files to a Hugging Face model repository;
- sync selected files to S3;
- publish generated assets elsewhere.

Workspace exposes file state. Source adapters decide how to speak to external
systems.

## Boundaries

Source adapters should not turn Workspace into:

- a Git branch manager;
- a PR system;
- an S3 sync engine;
- a Hugging Face lifecycle manager;
- a source-overlay/tombstone store;
- a background auto-sync service.

They should consume Workspace capabilities and preserve the dependency
direction: source adapters depend on Workspace, not the other way around.
