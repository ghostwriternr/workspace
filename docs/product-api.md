# Product API

This doc describes the Workspace API surface that callers use today. Anything
that is not built yet is marked. [`known-limitations.md`](./known-limitations.md)
lists current prototype gaps.

For concepts, see [`product-model.md`](./product-model.md). For implementation,
see [`architecture.md`](./architecture.md). For runtime-specific APIs, see
[`runtime-adapters.md`](./runtime-adapters.md).

## Bind once, get named workspaces

A product binds Workspace to the Cloudflare authorities it uses, then gets named
Workspace handles.

```ts
const workspaces = Workspace.bind({
  artifacts: env.ARTIFACTS,
  objects: env.WORKSPACE_OBJECTS,
});

const workspace = workspaces.get("my-project");
```

`get` returns a handle to a durable named work surface. It should not force
product code to choose between `open`, `create`, or `openOrCreate`. Underlying
state can be created when an operation needs it.

Artifacts and Durable Object bindings are visible at the infrastructure edge.
They should not leak through normal product logic as repository remotes,
default branches, tokens, or manual metadata registration.

## Current files

`workspace.files` is the accepted current file tree.

```ts
const read = await workspace.files.read("/README.md");
const write = await workspace.files.write("/notes/todo.md", bytes);
const entries = await workspace.files.list("/");
const stat = await workspace.files.stat("/README.md");
const deleted = await workspace.files.delete("/notes/todo.md");
```

Expected failures are `Result` values, not thrown exceptions. Callers should be
able to handle invalid paths, missing files, directory/file mismatches, and
stale-copy conflicts without parsing exception strings.

## Working copies

Working copies are siblings of current files, not just file helper methods.
They are durable, isolated, mutable file authorities.

```ts
const copyResult = await workspace.copies.create({
  label: "agent-edit",
});
if (Result.isError(copyResult)) return copyResult;

const copy = copyResult.value;
await copy.files.write("/README.md", updatedReadme);
```

Recovering a copy should be explicit:

```ts
const copyResult = await workspace.copies.get(copyId);
```

Labels should be durable if exposed. A label that disappears after creation is
worse than no label.

## Apply and discard

`apply` publishes a working copy as current. `discard` abandons it.

```ts
const applied = await copy.apply();
if (Result.isError(applied)) return applied;

const discarded = await copy.discard();
if (Result.isError(discarded)) return discarded;
```

Apply is safe by default. If current files moved since the copy was created,
`apply` returns `WorkspaceCopyStaleError` rather than silently overwriting
newer current state. Explicit replacement can be added later if a real caller
needs it.

Capture from a runtime is not publication. A Sandbox command can write files,
and a runtime adapter can capture those files into the working copy, but current
files still do not change until `apply` succeeds.

## Source adapters target a Workspace

Workspace core does not expose `importGitHub`, `importS3`, or
`initializeFromArtifacts` methods. Source-specific lifecycle belongs in source
adapters.

The product-level shape is:

```ts
import { createGitHubSource } from "@cloudflare/workspace-source-github";

const github = createGitHubSource({ artifacts: env.ARTIFACTS });
const workspace = workspaces.get(workspaceName);

await github.importRepository({
  workspace,
  owner: "cloudflare",
  repo: "sandbox-sdk",
  ref: "main",
});
```

The GitHub adapter uses Artifacts internally to capture the repository and
then connects that captured authority to the Workspace. Product code does not
handle Artifacts repository metadata such as remotes, default branches, or
tokens.

Other sources would follow the same dependency direction (none are built yet):

```ts
await upload.importArchive({ workspace, file });
await huggingFace.importSnapshot({ workspace, model, revision });
await s3.importPrefix({ workspace, bucket, prefix });
```

Source adapters can replace or seed current files only through explicit adapter
semantics. Workspace does not pretend all sources are in-memory file maps.
Large source imports should remain authority-backed or streaming.

## Runtime adapters receive working copies

Runtime adapters are the normal way to execute against a working copy.

Dynamic Worker:

```ts
import { createWorkspaceDynamicWorkerRunner } from "@cloudflare/workspace-adapter-dynamic-worker";

const runner = createWorkspaceDynamicWorkerRunner(env.DYNAMIC_WORKERS);

await runner.run({
  code,
  workspace: copy.files.scoped({ read: "/**", write: "/**" }),
});
```

The runner takes a `ScopedWorkspaceFileCapability`. In practice the parent
exposes a `WorkerEntrypoint` that constructs the scoped capability per call so
the delegated Worker receives a live stub; see
[`runtime-adapters.md`](./runtime-adapters.md) and the dynamic-worker adapter
README for the loopback pattern.

Sandbox:

```ts
import { attachWorkspaceCopyToSandbox } from "@cloudflare/workspace-adapter-sandbox";
import { getSandbox } from "@cloudflare/sandbox";

const sandbox = getSandbox(env.Sandbox, `${workspaceName}-${copy.id}`, {
  sleepAfter: "60s",
});
const mount = await attachWorkspaceCopyToSandbox({
  copy,
  sandbox,
  path: "/workspace",
});
if (Result.isError(mount)) return mount;

const result = await sandbox.exec("npm test", { cwd: mount.value.path });
const capture = await mount.value.capture();
```

The Sandbox SDK owns execution mechanics. The Workspace adapter owns attaching
and capturing the working copy. Workspace owns the file authority and the
apply/discard boundary.

Low-level scoped-file APIs are exported for adapter authors
(`copy.files.scoped`), but product examples should lead with runtime adapters
rather than their internal plumbing.

## Scoped files

Delegated code should receive scoped file access, not Workspace identity.

```ts
const files = copy.files.scoped({
  read: "/src/**",
  write: ["/src/**", "/test/**"],
});
```

Inside delegated code:

```ts
await env.WORKSPACE.readFile("/src/index.ts");
await env.WORKSPACE.writeFile("/test/index.test.ts", bytes);
await env.WORKSPACE.list("/src");
await env.WORKSPACE.stat("/src/index.ts");
```

A scoped capability has no `apply`, no `discard`, no arbitrary Workspace lookup,
and no source/export authority.

## Writing trees

Bulk tree writes are still useful for generated files, uploads, and source
adapters that stream entries rather than hand Workspace an authority-backed
source.

The target shape is on working-copy files:

```ts
await copy.files.writeTree("/generated", entries);
```

Entries may be arrays, sync iterables, or async iterables. Implementations must
chunk by entry count and byte size rather than buffering a full tree.

This is materialization into a working copy, not a general source-overlay
engine. If a source can be captured as an Artifacts-backed authority, prefer
that over streaming every byte through a Worker.

## Source adapter adoption seam

Source adapters that create or import Artifacts repositories connect that
repository to a Workspace through a narrow internal seam exported under
`@cloudflare/workspace/source-adapter`:

```ts
import { connectArtifactsRepository } from "@cloudflare/workspace/source-adapter";

await connectArtifactsRepository(workspace, { repository, defaultBranch });
```

Normal product logic stays on `workspaces.get(name)` and the Workspace
file/copy APIs above. It does not handle remotes, default branches, or
repository tokens. The `/source-adapter` export exists so adapter packages can
bridge Artifacts repositories into a Workspace without leaking that plumbing
into the root API.
