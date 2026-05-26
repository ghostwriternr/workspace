# Workspace product model

Workspace is durable file state for Cloudflare execution environments.

The product promise is simple: Workers can manipulate durable files through a direct API, and containers can use the same files through a normal local working copy such as `/workspace`. Local changes become durable only when explicitly committed. The matching escape hatch is discard.

This document captures the long-term product model and the durable semantics we want to preserve as the implementation changes.

## Product principles

### Workspace is file state, not execution

Workspace owns durable files, directories, metadata, working copies, commits, discards, and revisions.

Workspace does not own command execution, container lifecycle, Sandbox lifecycle, agent orchestration, task scheduling, product policy, or Git remotes and branches. Execution products decide how work runs. Workspace decides what durable files exist before and after that work.

### The bridge is part of Workspace

The bridge between durable Workspace state and execution-local filesystems is part of Workspace.

That bridge is not an execution API. It is the file-state mechanism that lets execution environments read, mutate, inspect, commit, or discard durable working copies.

### The container interface should be mount-like

The long-term container-facing interface should be mount-like: ordinary tools should use `/workspace` as a local filesystem view backed by Workspace working-copy semantics.

FUSE, a platform-native mount, or an equivalent virtual filesystem mechanism may implement that view. Workspace should not be defined as FUSE, but FUSE-like mounting is the expected production shape for containers.

Workspace should not attempt full distributed POSIX behavior. Unsupported filesystem features should fail clearly.

### Durability is explicit

Workspace never makes container writes durable implicitly.

Not when a process writes a file.  
Not when a command exits.  
Not when a container exits.  
Not because a command succeeded.

A working copy becomes durable only through an explicit commit. Discard abandons local working-copy changes.

### Product semantics stay above Workspace

Workspace should not know product concepts such as original photo, current image, draft edit, code artifact, or agent task.

Products should express those concepts through their own controllers, manifests, UI state, or domain tools. Workspace provides the durable file-state substrate those products rely on.

## Primary views

### Worker view

Workers operate on durable Workspace state directly.

The API should feel like file-tree storage: read, write, list, delete, move, stat, snapshot, begin a working copy, commit, and discard. Expected domain failures should be structured values, not thrown exceptions.

Direct Worker writes are useful for simple storage operations, internal maintenance, and low-level ergonomics. Product-visible user changes should generally flow through working copies so they have clear commit boundaries and revision history.

### Container view

Containers see a local directory such as `/workspace`.

Ordinary tools should work against that directory without knowing about Durable Objects, R2, revisions, or Workspace internals. Reads may hydrate data lazily. Writes are local working-copy changes until commit.

The mount-like view should support the useful subset of filesystem behavior needed by normal tools while keeping the Workspace semantics narrow:

- regular files and directories,
- basic metadata,
- clear errors for unsupported features,
- explicit commit and discard,
- no promise of full distributed POSIX behavior.

### Agent and product view

Agents should usually receive product-level tools, not raw Workspace mutation tools.

For example, a photo agent should receive tools like "save draft", "make draft current", or "throw away draft" rather than generic low-level write and commit primitives. This keeps agent behavior aligned with product semantics while Workspace remains the durable state boundary.

The Sandbox or container is the freedom boundary for execution. Workspace is the durability boundary for files.

## Core semantic model

### Durable tree

A Workspace contains a durable tree of files and directories.

The tree should preserve enough metadata for products and tools to use files correctly. At minimum this includes path, type, size, timestamps, and basic file metadata. Content type and small generic user metadata are likely part of the long-term model.

### Working copies

A working copy is an isolated mutable view of a Workspace tree.

A working copy can be used directly through Worker APIs or exposed to a container through the mount-like interface. Changes inside the working copy do not affect durable head until commit.

Working copies should be recoverable and inspectable. Products need to explain open drafts, abandon stale work, and resume interrupted sessions without storing every semantic detail outside Workspace.

### Commit and discard

Commit publishes a working copy to durable head and creates a recovery point. Discard abandons the working copy without changing head.

Commit should be explicit and product-visible. A product may call it "make current", "publish", "save draft", or another domain phrase, but the Workspace semantic is the same: publish this candidate file tree as durable state.

### Revisions

Revisions are immutable recovery points for durable Workspace state.

They are not Git commits. Workspace should not grow branches, remotes, rebases, or repository semantics. Revision metadata should be sufficient to explain durable changes: message, actor, timestamps, and small generic metadata.

### Conflict safety

A working copy should not silently overwrite newer head changes.

The initial conflict model can stay conservative: reject stale commits and let products inspect, retry, or discard. Diff is the next useful recovery primitive. Merge and rebase can wait until concrete product needs force them.

### Metadata

Workspace metadata should stay generic.

Good candidates:

- content type,
- executable bit,
- timestamps,
- content digest,
- small string metadata,
- revision or commit metadata.

Bad candidates:

- product-specific labels as core concepts,
- artifact lifecycle states,
- agent task state,
- policy or audit decisions.

### Observability

Products need to know when durable file state changed.

Workspace should expose simple version or change-token semantics before adding richer live subscriptions. A product should be able to ask what version head is at, whether a working copy is stale, and which paths changed at a coarse level.

## Working-copy bridge

The working-copy bridge is the highest-leverage missing product layer.

The desired flow is:

```text
begin a Workspace working copy
mount or attach it at /workspace in an execution environment
let normal tools read and write local files
track working-copy changes behind that filesystem view
commit or discard explicitly
```

A representative product flow should look like:

```ts
const workingCopy = await workspace.beginWorkingCopy({ label: "draft edit" });

const mount = await workingCopy.attach({
  target: sandbox,
  path: "/workspace",
});

await sandbox.exec("convert /workspace/photos/original.jpg ... /workspace/photos/current");

await mount.flush();
await workingCopy.commit({ message: "Publish edited photo" });
```

The exact names and implementation can change. The important shape is stable:

1. Workspace defines the durable candidate tree.
2. Execution receives a local filesystem view.
3. Tools mutate files naturally.
4. Workspace tracks the resulting working-copy changes.
5. Commit or discard remains explicit.

The photo demo now uses this shape at the product boundary: commands operate on `/workspace`, and successful changes flush back into the draft working copy. The remaining long-term gap is the production container mount implementation behind that semantic boundary.

## Current progress

### Established

- Workspace is durable file state, not execution.
- Workers can operate on durable files through a direct API.
- Working copies provide isolated mutable trees.
- Commit and discard are explicit durability boundaries.
- Revisions provide immutable recovery points.
- Stale working-copy commits must not silently overwrite newer head changes.

### Validated by the photo demo

- Workspace works as a durable state boundary for AI-assisted work.
- Product-specific agent tools should sit above Workspace primitives.
- Sandbox is the right execution boundary for broad native command freedom.
- Users understand draft/current language better than session/commit language.
- A `/workspace` working-copy bridge removes product glue from agent command workflows.

### Missing next

- Production mount-like container working-copy implementation.
- Working-copy descriptors, listing, recovery, and cleanup.
- Diff or changed-path inspection for working copies and revisions.
- Generic file metadata such as content type.
- Public version/change-token observability.
- Revision metadata for product-visible history.

### Deferred

- Full distributed POSIX behavior.
- Git branches, remotes, rebases, and repository semantics.
- Agent orchestration as part of Workspace core.
- Sandbox or container lifecycle ownership.
- Policy, grants, audit systems, and artifact lifecycle semantics.
- Merge behavior before concrete product pressure exists.

## Decision test

For any proposed Workspace feature, ask:

1. Is this durable file state or execution?
2. Does it help Workers and containers share durable files?
3. Does it clarify commit, discard, revision, metadata, or working-copy behavior?
4. Is it a core semantic, or a product/controller concern?

If the answer points to command execution, orchestration, Git, policy, product-specific domain state, or container lifecycle, keep it outside Workspace core.
