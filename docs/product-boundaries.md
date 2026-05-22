# Product boundaries

Workspace is durable file state for Cloudflare execution environments.

It gives Workers a direct file-tree API and gives containers a normal local working copy. Those two views meet at an explicit durability boundary: local container writes become durable only when the working copy is committed.

## What Workspace owns

Workspace owns:

- a durable file tree,
- file and directory metadata,
- file contents as durable data,
- snapshots or recovery points of that tree,
- working-copy attachment semantics,
- explicit commit and discard of working-copy changes.

The core abstraction is file state, not execution.

## What Workspace does not own

Workspace does not own:

- command execution,
- `run` or `exec` APIs,
- container or sandbox lifecycle,
- agent orchestration,
- task scheduling,
- Git history, branches, refs, or remotes,
- Artifacts semantics,
- policy, grant, or audit systems,
- arbitrary object-bucket mounting,
- full distributed POSIX semantics.

Execution products decide how work runs. Workspace decides what durable files exist before and after that work.

## Primary views

### Worker view

Workers operate on durable Workspace state directly. The eventual API should feel like file-tree storage: read, write, list, delete, move, and snapshot.

### Container view

Containers see a local directory, such as `/workspace`, that ordinary tools can use without knowing about Cloudflare storage internals.

That directory is a working copy. It can be read and mutated locally while tools run. Its local mutations are not durable until explicitly committed.

## Durability rule

Workspace never makes container writes durable implicitly.

Not when a process writes a file.  
Not when a command exits.  
Not when a container exits.  
Not because a command succeeded.

The durability operation is an explicit commit. The matching escape hatch is discard.

## Initial constraints

The first useful model is intentionally narrow:

- one writer at a time,
- regular files and directories,
- basic metadata including executable bits,
- snapshots for recovery,
- lazy hydration for container reads,
- structured commits from a local working copy,
- clear failure for unsupported filesystem features.

## Decision test

For any proposed feature, ask:

1. Is this file state or execution?
2. Does this help Workers and containers share durable files?
3. Is this a core semantic or an integration detail?

If the answer points to execution, orchestration, Git, policy, or product integration, keep it outside the core Workspace model for now.
