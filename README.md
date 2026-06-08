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

## Target shape

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

await sandbox.run({
  copy,
  command: "npm test",
  root: "/workspace",
});

await copy.apply(); // or discard()
```

The implementation is still moving toward this API. See
[`docs/product-api.md`](./docs/product-api.md) and
[`docs/known-limitations.md`](./docs/known-limitations.md).

## Where to look

- [`docs/product-model.md`](./docs/product-model.md) — core concepts and
  product semantics.
- [`docs/product-api.md`](./docs/product-api.md) — target API shape.
- [`docs/architecture.md`](./docs/architecture.md) — current Artifacts-backed
  implementation.
- [`docs/runtime-adapters.md`](./docs/runtime-adapters.md) — Dynamic Worker and
  Sandbox projection model.
- [`docs/sources.md`](./docs/sources.md) — how external systems seed/export
  Workspace state.
- [`docs/product-boundaries.md`](./docs/product-boundaries.md) — what stays out
  of Workspace core.
- [`docs/known-limitations.md`](./docs/known-limitations.md) — current prototype
  gaps.
- [`docs/photo-agent-demo.md`](./docs/photo-agent-demo.md) — what the photo
  example proves.
- [`AGENTS.md`](./AGENTS.md) — guardrails and commands for agents modifying the
  repo.

## Layout

```text
packages/workspace/                 Workspace package and work-surface API
packages/adapters/dynamic-worker/   Dynamic Worker adapter for scoped files
packages/adapters/sandbox/          Sandbox adapter for mounted working copies
examples/photo-agent-demo/          Think photo agent over one Workspace draft
examples/coding-agent-demo/         Think coding agent over imported repos
```

## Status

Prototype. Workspace currently uses Artifacts as the durable/versioned file
authority, a WorkspaceObject Durable Object for coordination metadata, and a
temporary internal `isomorphic-git` bridge until Artifacts exposes direct file
mutation APIs.

The photo agent example is deployed at
<https://workspace-photo-agent-demo.ghostwriternr.workers.dev>. The coding
agent example imports public GitHub repositories through Artifacts and exposes
Workspace-backed Dynamic Worker and Sandbox tools.

## Commands

```bash
just check    # typecheck + knip
just test     # vitest across packages/examples
just typegen  # regenerate worker-configuration.d.ts files
```
