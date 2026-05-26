# Product boundaries

Workspace is durable file state for Cloudflare execution environments.

It gives Workers a direct file-tree API and gives containers a normal local working copy such as `/workspace`. Those two views meet at an explicit durability boundary: local container writes become durable only when the working copy is committed.

See [`workspace-product-model.md`](./workspace-product-model.md) for the long-term product model.

## What Workspace owns

Workspace owns:

- durable files and directories,
- file contents and generic file metadata,
- working-copy attachment semantics,
- explicit commit and discard of working-copy changes,
- snapshots or recovery points of durable file state.

The core abstraction is file state, not execution.

## What Workspace does not own

Workspace does not own:

- command execution,
- `run` or `exec` APIs,
- container or Sandbox lifecycle,
- agent orchestration,
- task scheduling,
- Git history, branches, refs, or remotes,
- Artifacts semantics,
- policy, grant, or audit systems,
- arbitrary object-bucket mounting,
- full distributed POSIX semantics.

Execution products decide how work runs. Workspace decides what durable files exist before and after that work.

## Durability rule

Workspace never makes container writes durable implicitly.

Not when a process writes a file.  
Not when a command exits.  
Not when a container exits.  
Not because a command succeeded.

The durability operation is an explicit commit. The matching escape hatch is discard.

## Decision test

For any proposed feature, ask:

1. Is this file state or execution?
2. Does this help Workers and containers share durable files?
3. Is this a core semantic or an integration detail?

If the answer points to execution, orchestration, Git, policy, or product integration, keep it outside the core Workspace model for now.
