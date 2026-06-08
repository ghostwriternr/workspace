# Photo agent demo

The photo agent demo is a Worker app that uses Workspace as durable file state
for an AI agent editing images. It is an example app, not part of Workspace
core.

The demo proves that one Workspace working copy can be projected into multiple
runtimes and still publish through one explicit boundary.

## What it proves

- Uploaded images can live in a Workspace work surface.
- A draft image edit maps to a Workspace working copy.
- A Sandbox can edit the draft through a filesystem path.
- A Dynamic Worker can edit the same draft through scoped file methods.
- The browser can preview original, draft, and current images without receiving
  Workspace control authority.
- The draft becomes current only when product code commits/applies it.

The UI uses product language: original, draft, current. The underlying
Workspace language is current files, working copy, apply, and discard.

## Runtime split

The agent can use:

- **Sandbox shell commands** for ImageMagick and other process/filesystem tools;
- **Dynamic Worker code** for Worker-native file operations, metadata, notes, or
  manifests.

Both runtimes receive limited authority over the draft. Neither runtime owns the
publication decision.

## Product boundary

Workspace owns durable file state and working-copy semantics. Think owns
conversation and tool selection. The Sandbox adapter owns command execution and
filesystem reconciliation. The Dynamic Worker adapter owns Worker Loader
mechanics.

The demo should not push photo-specific concepts into Workspace core. "Draft",
"original", and "current image" are product concepts built on Workspace files.

## Related docs

- [`product-model.md`](./product-model.md)
- [`runtime-adapters.md`](./runtime-adapters.md)
- [`architecture.md`](./architecture.md)
- [`known-limitations.md`](./known-limitations.md)
