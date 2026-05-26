# Workspace product model

Workspace is durable file state for Cloudflare execution environments.

The product promise is not "a filesystem" and not "a storage bucket". The product promise is a durable file tree with working-copy semantics that can be projected into different execution environments with the right authority boundary.

Trusted Workers and Durable Objects can manipulate Workspace state directly. Sandboxes and containers can receive a filesystem projection such as `/workspace`. Dynamic Workers can receive scoped bindings, module sources, and static assets backed by Workspace. In every case, Workspace owns durable file state; execution environments receive capabilities over that state.

This document captures the long-term product model and the durable semantics we want to preserve as the implementation changes. See [`workspace-product-api.md`](./workspace-product-api.md) for the intended product-facing API vocabulary and happy path.

## Product principles

### Workspace is file state, not execution

Workspace owns durable files, directories, metadata, working copies, publication boundaries, discards, and revisions.

Workspace does not own command execution, Dynamic Worker loading, container lifecycle, Sandbox lifecycle, agent orchestration, task scheduling, product policy, or Git remotes and branches. Execution products decide how work runs. Workspace decides what durable files exist before and after that work.

### Workspace defines semantics; adapters consume them

Execution environments depend on Workspace behavior, not the other way around.

Workspace should not become Sandbox-shaped, Dynamic-Worker-shaped, or container-shaped. It defines durable file-state semantics once, then exposes those semantics through projections that fit each execution environment.

### Capabilities are the projection boundary

Workspace should expose capabilities over file state:

- trusted control capabilities for product Workers and Durable Objects,
- scoped file capabilities for delegated or generated code,
- filesystem capabilities for Sandboxes and containers,
- module and asset capabilities for Dynamic Workers.

A capability grants specific authority. It should be possible to grant a Dynamic Worker read access to `/src/**` and write access to `/output/**` without giving it Workspace identity, revision management, or commit authority.

### Durable does not always mean published

Working-copy changes can be durable before they are published.

A draft, proposed change, or session should survive crashes and reconnects. Commit publishes that durable candidate state to head. Discard abandons it. This distinction matters for agent workflows, collaborative editing, previews, and Dynamic Worker test runs.

### Commit and discard are explicit

Workspace never publishes execution-local changes implicitly.

Not when a process writes a file.  
Not when a command exits.  
Not when a Dynamic Worker returns.  
Not when a Sandbox or container exits.  
Not because execution succeeded.

The publication operation is an explicit commit. The matching escape hatch is discard.

### Product semantics stay above Workspace

Workspace should not know product concepts such as original photo, current image, draft edit, code artifact, chat thread, agent task, or approval policy.

Products should express those concepts through their own controllers, manifests, UI state, or domain tools. Workspace provides the durable file-state substrate those products rely on.

## Core semantic model

### Durable tree

A Workspace contains a durable tree of files and directories.

The tree should preserve enough metadata for products and tools to use files correctly. At minimum this includes path, type, size, timestamps, and basic file metadata. Content type and small generic user metadata are likely part of the long-term model.

### Working copies

A working copy is an isolated mutable view of a Workspace tree.

A working copy may be durable before it is published. It can be used directly through Worker APIs, exposed to a Sandbox or container through a filesystem projection, or exposed to Dynamic Worker code through scoped bindings. Changes inside the working copy do not affect durable head until commit.

Working copies should be recoverable and inspectable. Products need to explain open drafts, abandon stale work, and resume interrupted sessions without storing every semantic detail outside Workspace.

### Commit and discard

Commit publishes a working copy to durable head and creates a recovery point. Discard abandons the working copy without changing head.

Commit should be explicit and product-visible. A product may call it "make current", "publish", "merge", "save draft", or another domain phrase, but the Workspace semantic is the same: publish this candidate file tree as durable head state.

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

## Workspace capability projections

Workspace core is independent of execution. Execution environments consume projections of Workspace state.

### Trusted Worker and Durable Object control projection

Product-owned Workers and Durable Objects can use Workspace's control API directly.

This projection can expose Workspace identity and orchestration operations:

```ts
const workspace = env.WORKSPACES.getByName(name);
const workingCopy = await workspace.beginWorkingCopy();
await workingCopy.writeFile("/src/index.ts", source);
await workingCopy.commit();
```

This is appropriate for trusted product code that owns user intent, policy decisions, commit/discard, and error translation.

### Scoped file capability projection

Delegated code should receive scoped capabilities, not Workspace identity.

A scoped file capability may expose familiar file methods:

```ts
await env.WORKSPACE.readFile("/data/input.json");
await env.WORKSPACE.writeFile("/output/result.json", bytes);
await env.WORKSPACE.list("/data");
```

But it should be constrained by the authority granted by the parent:

- root prefix,
- allowed read paths,
- allowed write paths,
- delete permission,
- maximum file sizes or operation budgets,
- no commit authority by default,
- no arbitrary Workspace lookup by default.

This is the natural projection for Dynamic Worker code, plugins, generated code, and other delegated execution.

### Filesystem projection

Sandboxes and containers can receive a filesystem projection of a working copy.

The user-visible shape is a local directory such as `/workspace`:

```text
begin a Workspace working copy
attach it at /workspace in an execution environment
let normal tools read and write local files
track working-copy changes behind that filesystem view
commit or discard explicitly
```

A representative product flow:

```ts
const workingCopy = await workspace.beginWorkingCopy({ label: "draft edit" });

const mount = await attachWorkspaceFilesystem({
  workingCopy,
  target: sandbox,
  path: "/workspace",
});

await sandbox.exec("convert /workspace/photos/original.jpg ... /workspace/photos/current");

await mount.flush();
await workingCopy.commit({ message: "Publish edited photo" });
```

The implementation may be FUSE, a platform-native mount, a Sandbox-specific mechanism, or another virtual filesystem adapter. Workspace should not be defined as FUSE, and it should not attempt full distributed POSIX behavior. Unsupported filesystem features should fail clearly.

The photo demo validates this projection at the product boundary: commands operate on `/workspace`, and successful changes flush back into the draft working copy. The remaining long-term gap is the production mount implementation behind that semantic boundary.

### Dynamic Worker module projection

Dynamic Workers can be loaded from Workspace files.

A Workspace tree, working copy, or revision can provide runtime modules:

```ts
const worker = env.LOADER.load({
  mainModule: "src/index.js",
  modules: await modulesFromWorkspace(workingCopy, "/src"),
  env: {
    WORKSPACE: scopedWorkspaceBinding,
  },
});
```

This projection lets Workspace serve as the durable source tree for generated applications, code-mode runs, previews, and user-uploaded platforms.

### Dynamic Worker asset projection

A Workspace tree or revision can also provide static assets to a Dynamic Worker.

For app previews and generated applications, the Dynamic Worker may receive an asset binding backed by Workspace state:

```ts
const assets = createWorkspaceAssetsBinding({
  tree: revision,
  root: "/dist",
});

const worker = env.LOADER.load({
  mainModule: "src/index.js",
  modules,
  env: { ASSETS: assets },
});
```

This is distinct from raw file access. It projects Workspace files into the runtime's asset-serving semantics.

## Authority model

The important distinction is authority, not runtime type.

### Trusted code

Trusted product Workers and Durable Objects may receive Workspace identity and control capabilities. They can create working copies, decide commit/discard, inspect revisions, and translate low-level Workspace errors into product behavior.

### Delegated code

Dynamic Workers, agent-written code, plugins, and user-generated applications should usually receive scoped Workspace capabilities. They can operate within delegated file boundaries, but the parent product should retain commit/discard authority unless explicitly delegated.

### Filesystem tools

Sandbox or container commands receive a filesystem view over a working copy. They can mutate files naturally, but those mutations remain working-copy state until a trusted parent commits.

For product-facing APIs, this should feel like attaching a file copy to an execution environment and then capturing useful execution-local changes back into the copy. Capture is an attachment boundary; commit remains the Workspace publication boundary.

This keeps the core safety rule consistent:

```text
Execution can propose file-state changes.
Trusted product code decides whether to publish them.
```

## Current progress

### Established

- Workspace is durable file state, not execution.
- Workers can operate on durable files through a direct API.
- Working copies provide isolated mutable trees.
- Commit and discard are explicit publication boundaries.
- Revisions provide immutable recovery points.
- Stale working-copy commits must not silently overwrite newer head changes.
- Filesystem projection semantics work in the photo demo through `/workspace`.
- Scoped file capability semantics work in the photo demo through Dynamic Worker `env.WORKSPACE` bindings.

### Validated by the photo demo

- Workspace works as a durable state boundary for AI-assisted work.
- Product-specific agent tools should sit above Workspace primitives.
- Sandbox is the execution boundary for broad native command freedom.
- Users understand draft/current language better than session/commit language.
- A `/workspace` filesystem projection removes product glue from agent command workflows.
- Scoped Dynamic Worker file bindings let delegated Worker code operate on draft files without Workspace identity or commit authority.

### Informed by Gadgets and Dynamic Workers

- Dynamic Workers should receive scoped Workspace capabilities, not Workspace identity, by default.
- Workspace-backed modules and assets are first-class projections distinct from filesystem mounts.
- Durable proposed changes and published head state should be treated as different concepts.
- Parent/orchestrator code should normally decide commit/discard after delegated execution.

### Missing next

- Working-copy descriptors, listing, recovery, and cleanup.
- Diff or changed-path inspection for working copies and revisions.
- Generic file metadata such as content type.
- Public version/change-token observability.
- Revision metadata for product-visible history.
- Production filesystem projection for Sandboxes and containers.
- Dynamic Worker module and asset projections.

### Deferred

- Full distributed POSIX behavior.
- Git branches, remotes, rebases, and repository semantics.
- Agent orchestration as part of Workspace core.
- Dynamic Worker loading as part of Workspace core.
- Sandbox or container lifecycle ownership.
- Policy, grants, audit systems, and artifact lifecycle semantics.
- Merge behavior before concrete product pressure exists.

## Decision test

For any proposed Workspace feature, ask:

1. Is this durable file state or execution?
2. Does it define Workspace semantics, or does it adapt those semantics to one execution environment?
3. What authority does the caller receive?
4. Can delegated code receive a scoped capability instead of Workspace identity?
5. Does it clarify commit, discard, revision, metadata, or working-copy behavior?
6. Is it a core semantic, or a product/controller concern?

If the answer points to command execution, Dynamic Worker loading, orchestration, Git, policy, product-specific domain state, or runtime lifecycle, keep it outside Workspace core. If it projects Workspace state into an execution environment, keep the projection explicit and preserve the dependency direction: adapters consume Workspace semantics; Workspace does not depend on adapters.
