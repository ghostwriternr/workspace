# Architecture

This doc describes how the current prototype is built. For the product model,
see [`product-model.md`](./product-model.md). For the target API, see
[`product-api.md`](./product-api.md). For boundaries, see
[`product-boundaries.md`](./product-boundaries.md).

## System shape

Workspace has three layers:

```text
Product API
  current files, working copies, apply/discard, scoped files, mounts

Coordination
  WorkspaceObject Durable Object, one object per Workspace name

File authority
  Artifacts repositories, commits, refs, and tokens
```

Artifacts is the durable/versioned file authority. WorkspaceObject coordinates
metadata needed to use that authority reliably from Workers. Workspace exposes a
small work-surface API above both.

## Package layout

```text
packages/workspace/
  src/
    workspace.ts                  Workspace API and working-copy wrappers
    authority.ts                  authority contract the API depends on
    workspace-object.ts           Durable Object coordination metadata
    workers.ts                    Worker-runtime export for WorkspaceObject
    runtime-adapter.ts            SPI for runtime mount descriptors
    write-tree.ts                 streaming tree-write planner/chunker
    source-adapter.ts             public types for source adapter SPI
    source-adapter-registry.ts    internal connect-Artifacts seam
    artifacts/                    Artifacts authority + temporary Git driver
    model/                        path, entry, error, write-tree primitives
    projections/                  scoped file capability DTO helpers

packages/adapters/dynamic-worker/
  Dynamic Worker runner for scoped Workspace files

packages/adapters/sandbox/
  Sandbox attachment/capture adapter and shared base image contract

packages/sources/github/
  GitHub source adapter that imports through Artifacts and connects the
  resulting authority to a Workspace via the source-adapter SPI

examples/photo-agent-demo/
  Think photo agent using Sandbox + Dynamic Worker over one draft copy

examples/coding-agent-demo/
  Think coding agent importing public GitHub repos, then editing them via
  Dynamic Worker (`run`) and Sandbox (`shell`) over one working copy
```

## WorkspaceObject

WorkspaceObject is a coordination Durable Object, not a file backend.

It exists because current Artifacts lifecycle calls return useful serializable
metadata, while later repository handles do not consistently expose that data as
ordinary fields across Workers RPC/local remote-binding boundaries. Workspace
needs a durable place to remember the non-secret metadata required to reopen and
mutate the Artifacts authority.

WorkspaceObject may store coarse metadata:

- current repository/ref metadata, stored once per Workspace;
- working-copy identifiers, labels, and creation timestamps;
- working-copy base revisions for conflict checks;
- cleanup/retention metadata.

WorkspaceObject must not store file bytes, Git objects, path-level overlays,
tombstones, runtime scratch state, Sandbox state, Dynamic Worker state, source
lifecycle, or plaintext tokens.

Tokens are minted on demand from Artifacts.

## Artifacts authority

Artifacts owns file trees, commits, refs, repository lifecycle, and Git remotes.
Workspace should lean on those capabilities rather than rebuilding a custom file
store.

The Artifacts authority currently maps Workspace semantics as follows:

| Workspace concept | Current Artifacts implementation |
| ----------------- | -------------------------------- |
| Current files     | Artifacts repository/ref          |
| Working copy      | Hidden Artifacts Git ref          |
| Discard           | Delete the hidden ref             |
| Apply             | Promote the hidden ref to current |
| Revision          | Artifacts commit/history          |

The exact mechanics can change as Artifacts grows direct file APIs. The product
semantics should not.

## Temporary Git driver

Artifacts does not yet expose all file mutation APIs Workspace needs directly.
`packages/workspace/src/artifacts/git-driver.ts` therefore uses internal
`isomorphic-git` plus an in-memory filesystem to read, write, commit, and push
Artifacts repositories.

That driver is intentionally hidden. It should not leak into public APIs,
examples, agent prompts, or runtime adapters. It should be removed when
Artifacts exposes first-class file write/commit/apply primitives.

The driver can be memory-heavy for large repositories because writes and apply
paths may require enough Git objects to push successfully. Hidden refs keep
working copies cheaper than Artifacts repository forks, but the temporary Git
bridge is still not the desired long-term file mutation primitive.

## Runtime adapters

Runtime adapters depend on Workspace. Workspace does not depend on runtimes.

`packages/adapters/dynamic-worker` receives a working copy and exposes a scoped
`env.WORKSPACE` binding to loaded Worker code. The loaded code can read/write
only the paths granted by the parent and cannot apply or discard the copy.

`packages/adapters/sandbox` receives a working copy and exposes it to a Sandbox
as `/workspace`. The adapter is shaped around
[`artifact-fs`](https://github.com/cloudflare/artifact-fs): mount the
Artifacts-backed working-copy ref directly, hydrate blobs on demand, and
capture runtime writes back into the working-copy ref only when requested.
Sandbox outbound Workers/TLS auth should inject short-lived Artifacts Git
credentials outside the container, so tokens do not enter the Sandbox.

Command success, capture success, and publication are separate facts.
Publication still requires `copy.apply()`.

See [`runtime-adapters.md`](./runtime-adapters.md) for the runtime-facing model.

## Source adapters

Source adapters stay outside Workspace core. They may use Artifacts, GitHub,
S3, uploads, Hugging Face, or any other source-specific API to seed or export a
Workspace. `packages/sources/github` imports GitHub repositories through
Artifacts and then connects the captured authority to a Workspace.

Adapters bridge to a Workspace through `@cloudflare/workspace/source-adapter`,
which exposes a narrow `connectArtifactsRepository(workspace, { repository,
defaultBranch })` helper. The root `@cloudflare/workspace` API does not expose
that seam, so ordinary product code never handles repository remotes, default
branches, or tokens.

Workspace should not learn GitHub branches, pull requests, S3 prefixes, or Hugging
Face revisions. Adapters translate those source lifecycles into Workspace work
surfaces.

See [`sources.md`](./sources.md).

## Current implementation debt

- The temporary `isomorphic-git` bridge in `artifacts/git-driver.ts` is
  Workspace-internal and should be removed when Artifacts exposes direct file
  mutation APIs.
- The Sandbox adapter uses `artifact-fs` through a local base image and wrapper
  scripts. That base image is not published yet, and outbound Artifacts Git
  auth is implemented only for Workspace's mounted working-copy path, not as a
  general egress policy system.
- The GitHub source adapter imports public repositories but does not yet
  report the resolved Git commit, support private credentials, or export
  changes back to GitHub.

See [`known-limitations.md`](./known-limitations.md) for the full list.

## Design guardrails

- Use Artifacts for file authority; do not revive a custom DO+R2 file backend.
- Use WorkspaceObject for coordination; do not store path-level file state in it.
- Keep source lifecycles in source adapters.
- Keep execution lifecycles in runtime adapters/products.
- Keep apply/discard as trusted product decisions.
