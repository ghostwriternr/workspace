# Workspace

Workspace is an agent-friendly work surface over Artifacts-backed durable file
state on Cloudflare.

It gives products a named place to keep files, create durable working copies,
hand those copies to Dynamic Workers or Sandboxes, and decide when proposed work
becomes current. Artifacts owns the versioned file authority underneath;
Workspace owns the product semantics above it.

## What you get

- Current files and durable working copies backed by Artifacts.
- Explicit publish (`apply`) and throwaway (`discard`) boundaries.
- Scoped file capabilities for delegated Worker code.
- Sandbox filesystem access through runtime adapters.
- A small per-Workspace Durable Object for coordination metadata, not file
  storage.

Workspace is not an execution engine, Git porcelain, source lifecycle manager,
or custom blob store. Source adapters seed or export Workspace state. Runtime
adapters project working copies into execution environments.

## Shape

```ts
const workspaces = Workspace.bind({
  artifacts: env.ARTIFACTS,
  objects: env.WORKSPACE_OBJECTS,
});

const workspace = workspaces.get("my-project");

const copyResult = await workspace.copies.create({ label: "agent-edit" });
if (Result.isError(copyResult)) return copyResult;

const copy = copyResult.value;
await copy.files.write("/README.md", bytes);

const mount = await attachWorkspaceCopyToSandbox({
  copy,
  sandbox,
  path: "/workspace",
});
if (Result.isError(mount)) return mount;

await sandbox.exec("npm test", { cwd: mount.value.path });
await mount.value.capture();

await copy.apply(); // or discard()
```

See [`docs/product-api.md`](./docs/product-api.md) for the full surface and
[`docs/known-limitations.md`](./docs/known-limitations.md) for current gaps.

## Where to look

Cross-cutting docs (concepts, boundaries, current state):

- [`docs/product-model.md`](./docs/product-model.md) — core concepts and
  product semantics.
- [`docs/product-api.md`](./docs/product-api.md) — the API surface callers
  use.
- [`docs/architecture.md`](./docs/architecture.md) — current Artifacts-backed
  implementation.
- [`docs/runtime-adapters.md`](./docs/runtime-adapters.md) — Dynamic Worker
  and Sandbox projection model.
- [`docs/sources.md`](./docs/sources.md) — how external systems seed/export
  Workspace state.
- [`docs/product-boundaries.md`](./docs/product-boundaries.md) — what stays
  out of Workspace core.
- [`docs/known-limitations.md`](./docs/known-limitations.md) — current
  prototype gaps.
- [`AGENTS.md`](./AGENTS.md) — guardrails and commands for agents modifying
  the repo.

Per-package and per-example READMEs:

- [`packages/workspace`](./packages/workspace/README.md) — the Workspace
  package.
- [`packages/adapters/dynamic-worker`](./packages/adapters/dynamic-worker/README.md)
  — Dynamic Worker runtime adapter.
- [`packages/adapters/sandbox`](./packages/adapters/sandbox/README.md) —
  Sandbox runtime adapter.
- [`packages/sources/github`](./packages/sources/github/README.md) — GitHub
  source adapter.
- [`examples/photo-agent-demo`](./examples/photo-agent-demo/README.md) —
  Think photo agent over one Workspace draft.
- [`examples/coding-agent-demo`](./examples/coding-agent-demo/README.md) —
  Think coding agent over imported GitHub repos.

## Status

Prototype. Workspace uses Artifacts as the durable/versioned file authority, a
`WorkspaceObject` Durable Object for coordination metadata, and a temporary
internal `isomorphic-git` bridge until Artifacts exposes direct file mutation
APIs.

The photo agent example is deployed at
<https://workspace-photo-agent-demo.ghostwriternr.workers.dev>. The coding
agent example imports public GitHub repositories through Artifacts and edits
them through Dynamic Worker (`run`) and Sandbox (`shell`) tools backed by a
shared working copy.

## Commands

```bash
just check                 # typecheck + knip
just test                  # vitest across packages/examples
just typegen               # regenerate worker-configuration.d.ts files
just build-sandbox-base    # build local base image for Sandbox examples
just install-fuse-workerd  # install patched local workerd for FUSE dev
just dev-coding-fuse       # coding demo with local Sandbox FUSE enabled
just dev-photo-fuse        # photo demo with local Sandbox FUSE enabled
```
