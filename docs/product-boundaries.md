# Product boundaries

Workspace is durable file state for Cloudflare execution environments.

It gives trusted Workers and Durable Objects a direct file-tree API. It gives delegated code scoped file capabilities. It gives Sandboxes and containers a filesystem projection such as `/workspace`. It can provide Dynamic Workers with modules and static assets backed by Workspace state.

All of these are projections of the same core model: durable file trees, durable working copies, explicit commit/discard, and immutable recovery points.

See [`workspace-product-model.md`](./workspace-product-model.md) for the long-term product model.

## What Workspace owns

Workspace owns:

- durable files and directories,
- file contents and generic file metadata,
- working-copy semantics,
- scoped file capabilities,
- filesystem attachment semantics,
- module and asset projections from Workspace trees,
- explicit commit and discard of working-copy changes,
- snapshots or recovery points of durable file state.

The core abstraction is file state, not execution.

## What Workspace does not own

Workspace does not own:

- command execution,
- `run` or `exec` APIs,
- Dynamic Worker loading,
- container or Sandbox lifecycle,
- agent orchestration,
- task scheduling,
- Git history, branches, refs, or remotes,
- Artifacts semantics,
- policy, grant, approval, or audit systems,
- arbitrary object-bucket mounting,
- full distributed POSIX semantics.

Execution products decide how work runs. Workspace decides what durable files exist before and after that work.

## Authority rule

Trusted product code may receive Workspace identity and control capabilities.

Delegated code should usually receive scoped capabilities, not Workspace identity. Dynamic Workers, plugins, generated code, and Sandbox/container commands can propose file-state changes within a working copy. A trusted parent should normally decide whether to commit or discard those changes.

## Publication rule

Workspace never publishes execution-local or delegated changes implicitly.

Not when a process writes a file.  
Not when a command exits.  
Not when a Dynamic Worker returns.  
Not when a Sandbox or container exits.  
Not because execution succeeded.

The publication operation is an explicit commit. The matching escape hatch is discard.

Working-copy changes may be durable before they are published. Durable draft state and published head state are different concepts.

## Decision test

For any proposed feature, ask:

1. Is this file state or execution?
2. Does this define Workspace semantics, or adapt them to one execution environment?
3. What authority does the caller receive?
4. Can delegated code receive a scoped capability instead of Workspace identity?
5. Is this a core semantic or a product/controller concern?

If the answer points to execution, orchestration, Dynamic Worker loading, Git, policy, or product integration, keep it outside the core Workspace model. If it is an adapter, preserve the dependency direction: adapters consume Workspace semantics; Workspace does not depend on adapters.
