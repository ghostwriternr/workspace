# Product boundaries

Workspace is durable file state for Cloudflare execution environments. Everything below either flows from that statement or is excluded by it.

For the conceptual model, see [`product-model.md`](./product-model.md). For the target API shape, see [`product-api.md`](./product-api.md). For how it's actually built, see [`architecture.md`](./architecture.md).

## What Workspace owns

- Workspace-owned durable files and directories.
- Workspace-owned file contents and generic file metadata.
- Working-copy semantics (file copies).
- Scoped file capabilities for delegated code.
- Runtime-independent filesystem mount and reconciliation semantics.
- Module and asset projections from Workspace trees (planned).
- Explicit apply and discard of working-copy changes.
- Immutable revisions as recovery points.

## What Workspace does not own

- Command execution. No `run`, no `exec`.
- Sandbox, container, or Dynamic Worker lifecycle.
- Dynamic Worker loading (Worker Loader is the consumer).
- Agent orchestration or task scheduling.
- Git history, branches, refs, remotes.
- Diff, patch, merge, or rebase between trees. Workspace tells you what's in a tree; it does not compute how trees differ. Products that need diffs build them above Workspace.
- Artifacts semantics.
- Source adapters — GitHub, GitLab, Hugging Face, S3, external R2, Artifacts, user uploads. Bridging external systems into Workspace is product work; see [`sources.md`](./sources.md).
- Policy, approval, grant, or audit systems.
- Arbitrary object-bucket mounting.
- Full distributed POSIX semantics.

Execution products decide how work runs. Workspace decides what Workspace-owned durable files exist before and after that work.

## Authority

Trusted product code (Workers, Durable Objects you wrote) may receive Workspace identity and control capabilities.

Delegated code (Dynamic Workers, plugins, generated code, Sandbox/container commands) should usually receive scoped capabilities, not Workspace identity. They can propose file-state changes within a working copy. The parent decides whether to publish.

## Publication

Workspace never publishes execution-local changes implicitly. Not when a process writes a file. Not when a command exits. Not when a Dynamic Worker returns. Not when a Sandbox shuts down. Not because execution succeeded.

The publish operation is `apply`. The escape hatch is `discard`.

Working-copy changes may be durable before they're published. Durable draft state and published current state are different concepts.

## Decision test

For any proposed feature, ask:

1. Is this file state, or is it execution?
2. Does it define Workspace semantics, or adapt them to one runtime or one source?
3. What authority does the caller receive?
4. Can delegated code receive a scoped capability instead of Workspace identity?
5. Is it a core semantic, or a product/controller concern?

If the answer points to execution, orchestration, loading, Git, policy, source-specific lifecycle, or product-specific domain state — keep it out of Workspace core. If it's an adapter, preserve the dependency direction: adapters consume Workspace semantics; Workspace doesn't consume adapters.

For the emerging vocabulary around file authorities, mounted views, runtime projections, and adapter responsibilities, see [`runtime-projections.md`](./runtime-projections.md).
