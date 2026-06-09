# @cloudflare/workspace

Agent-friendly work surface over Artifacts-backed durable file state on
Cloudflare.

Workspace gives products a named place to keep files, create durable working
copies, hand those copies to Dynamic Workers or Sandboxes, and decide when
proposed work becomes current. Artifacts owns the versioned file authority
underneath; Workspace owns the product semantics above it.

## Install

```bash
npm install @cloudflare/workspace
```

The package needs an Artifacts binding and a `WorkspaceObject` Durable Object
binding in your Worker:

```jsonc
{
  "artifacts": [{ "binding": "ARTIFACTS", "namespace": "my-app" }],
  "durable_objects": {
    "bindings": [
      { "name": "WORKSPACE_OBJECTS", "class_name": "WorkspaceObject" }
    ]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["WorkspaceObject"] }]
}
```

Export the Durable Object class from your Worker entrypoint:

```ts
export { WorkspaceObject } from "@cloudflare/workspace/workers";
```

## Use

```ts
import { Workspace } from "@cloudflare/workspace";
import { Result } from "better-result";

const workspaces = Workspace.bind({
  artifacts: env.ARTIFACTS,
  objects: env.WORKSPACE_OBJECTS,
});

const workspace = workspaces.get("my-project");

// Current files
await workspace.files.read("/README.md");
await workspace.files.write("/notes/todo.md", bytes);

// Working copies — durable, isolated, not published
const copyResult = await workspace.copies.create({ label: "agent-edit" });
if (Result.isError(copyResult)) return copyResult;
const copy = copyResult.value;

await copy.files.write("/README.md", updatedReadme);

// Publish or throw away
await copy.apply();    // -> WorkspaceCopyStaleError if current moved underneath
await copy.discard();
```

Expected failures are `Result` values, not thrown exceptions. Operation-specific
error unions discriminate by `tag`.

## What it gives you

- `workspace.files.{mkdir, write, read, list, stat, delete}` — current files.
- `workspace.copies.{create, get}` — durable, isolated working copies.
- `copy.files.*` — same file methods plus `writeTree`, `attach`, `scoped`.
- `copy.apply()` / `copy.discard()` — the publication boundary, with
  optimistic stale-base detection.
- `copy.files.scoped({ read, write, root? })` — capability for delegated code.
- `copy.files.attach(host, path)` — mount-host SPI for runtime adapters.
- `@cloudflare/workspace/source-adapter` — narrow SPI for adapter packages to
  connect an Artifacts repository to a Workspace.
- `@cloudflare/workspace/workers` — the `WorkspaceObject` Durable Object class.
- `@cloudflare/workspace/testing` — fake Artifacts harness for example/test code.

## Boundaries

Workspace is **not**:

- a command/script runner;
- a Sandbox or container lifecycle manager;
- a Dynamic Worker loader;
- a Git porcelain (no branches, remotes, merge, rebase, PRs);
- a diff/patch/merge engine;
- a source-specific lifecycle manager (GitHub, S3, Hugging Face — those are
  source adapters);
- a custom replacement for Artifacts file storage.

Runtime adapters (`@cloudflare/workspace-adapter-{dynamic-worker,sandbox}`) and
source adapters (`@cloudflare/workspace-source-github`) wrap Workspace from the
outside.

## Status

Prototype. Workspace currently uses Artifacts as the durable/versioned file
authority and a temporary internal `isomorphic-git` bridge for file mutation
until Artifacts exposes those APIs directly. See
[`docs/known-limitations.md`](../../docs/known-limitations.md).

## Related docs

- [Product model](../../docs/product-model.md)
- [Product API](../../docs/product-api.md)
- [Architecture](../../docs/architecture.md)
- [Product boundaries](../../docs/product-boundaries.md)
- [Runtime adapters](../../docs/runtime-adapters.md)
- [Sources](../../docs/sources.md)
