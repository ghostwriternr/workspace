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
    workspace.ts          Workspace API and working-copy wrappers
    authority.ts          authority contract used by the API
    workspace-object.ts   Durable Object coordination metadata
    workers.ts            Worker-runtime export for WorkspaceObject
    artifacts/            Artifacts authority + temporary Git driver
    model/                path, entry, error, write-tree primitives
    projections/          scoped file capability and file mount internals

packages/adapters/dynamic-worker/
  Dynamic Worker runner for scoped Workspace files

packages/adapters/sandbox/
  Sandbox command runner for mounted Workspace working copies

examples/photo-agent-demo/
  Think photo agent using Sandbox + Dynamic Worker over one draft copy

examples/coding-agent-demo/
  Think coding agent using Artifacts import, Dynamic Worker, and Sandbox
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
as `/workspace`. The current implementation materializes files and scans for
changes after a command. The target implementation should use
[`artifact-fs`](https://github.com/cloudflare/artifact-fs) to mount the
Artifacts-backed working-copy repository directly, hydrate blobs on demand, and
capture command writes back into the working-copy repo. Sandbox outbound
Workers/TLS auth should inject short-lived Artifacts Git credentials outside
the container, so tokens do not enter the Sandbox.

Command success, capture/reconcile success, and publication are separate facts.
Publication still requires `copy.apply()`.

See [`runtime-adapters.md`](./runtime-adapters.md) for the runtime-facing model.

## Source adapters

Source adapters stay outside Workspace core. They may use Artifacts, GitHub,
S3, uploads, Hugging Face, or any other source-specific API to seed or export a
Workspace. The coding-agent demo currently imports GitHub repositories through
Artifacts and then works through Workspace APIs.

Workspace should not learn GitHub branches, pull requests, S3 prefixes, or Hugging
Face revisions. Adapters translate those source lifecycles into Workspace work
surfaces.

See [`sources.md`](./sources.md).

## Current implementation debt

The current implementation still has migration-era surfaces:

- `apply()` needs stronger stale-base conflict semantics.

These are not target architecture. They are cleanup targets documented in
[`product-api.md`](./product-api.md) and [`known-limitations.md`](./known-limitations.md).

## Design guardrails

- Use Artifacts for file authority; do not revive a custom DO+R2 file backend.
- Use WorkspaceObject for coordination; do not store path-level file state in it.
- Keep source lifecycles in source adapters.
- Keep execution lifecycles in runtime adapters/products.
- Keep apply/discard as trusted product decisions.
