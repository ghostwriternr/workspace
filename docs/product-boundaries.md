# Product boundaries

Workspace is durable file work-surface semantics over Artifacts-backed file
authorities. Everything below follows from that statement.

For the conceptual model, see [`product-model.md`](./product-model.md). For the
target API, see [`product-api.md`](./product-api.md). For implementation, see
[`architecture.md`](./architecture.md).

## What Workspace owns

- Named workspaces as durable work surfaces.
- Current files.
- Durable working copies.
- Apply and discard semantics.
- Scoped file capabilities for delegated code.
- Runtime-independent attach/capture semantics used by adapters.
- Small coordination metadata needed to use Artifacts reliably.
- Revisions/recovery points as exposed by the underlying file authority.

## What Workspace does not own

- Command execution, `run`, or `exec`.
- Sandbox, container, or Dynamic Worker lifecycle.
- Dynamic Worker loading.
- Agent orchestration, task scheduling, chat state, or approval flow.
- Git porcelain: branches, remotes, status, merge, rebase, checkout, or PRs.
- Diff, patch, merge, or tree-comparison APIs.
- Source lifecycle: GitHub, GitLab, Hugging Face, S3, external R2, uploads, or
  product-specific file systems.
- Export lifecycle: pull requests, releases, model uploads, object sync.
- Policy, grants, audit systems, or user permissions.
- Full distributed POSIX semantics.
- Custom durable file/blob storage that duplicates Artifacts.
- Path-level source overlays or tombstone stores implemented beside Artifacts.

Execution products decide how work runs. Source adapters decide how external
systems are imported or exported. Workspace decides what the Workspace work
surface means and when a working copy becomes current.

## Authority

Trusted product code may receive Workspace identity and control capabilities.
It can create working copies, apply them, discard them, and invoke source or
runtime adapters.

Delegated code should usually receive scoped capabilities:

- a scoped file binding for a Dynamic Worker;
- a mounted filesystem view of a working copy for a Sandbox;
- a read-only module or asset view.

Delegated code should not receive apply/discard authority by default.

## Publication

Workspace never publishes execution-local changes implicitly. Not when a
process writes a file. Not when a command exits. Not when a Dynamic Worker
returns. Not because execution succeeded.

The publication operation is `apply`. The escape hatch is `discard`.

Working-copy changes can be durable before they are published. Durable proposed
state and accepted current state are different concepts.

## Decision test

For any proposed feature, ask:

1. Is this Workspace file-state semantics, or is it execution/source/product
   lifecycle?
2. Does Artifacts already own this file-authority behavior?
3. Would adding this require Workspace to store path-level file state outside
   Artifacts?
4. Can delegated code receive a scoped capability instead of Workspace identity?
5. Is this needed by a real caller now?

If the answer points to execution, orchestration, source-specific lifecycle,
Git UX, policy, diff/merge behavior, or product-specific domain state, keep it
outside Workspace core. If it is an adapter, preserve the dependency direction:
adapters consume Workspace semantics; Workspace does not consume adapters.
