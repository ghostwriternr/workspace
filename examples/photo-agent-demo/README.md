# Photo agent demo

A Worker app that uses Workspace as durable file state for an AI agent editing
images. It is an example app, not part of Workspace core.

The demo proves that one Workspace working copy can be projected into multiple
runtimes — a Sandbox container running ImageMagick and a Dynamic Worker writing
metadata — and still publish through one explicit boundary.

Deployed at <https://workspace-photo-agent-demo.ghostwriternr.workers.dev>.

## What it proves

- Uploaded images live in a Workspace work surface.
- A draft image edit maps to a Workspace working copy.
- A Sandbox can edit the draft through a filesystem path at `/workspace`.
- A Dynamic Worker can edit the same draft through scoped file methods.
- The browser previews original, draft, and current images without receiving
  Workspace control authority.
- The draft becomes current only when product code commits/applies it.

The UI uses product language (original, draft, current). The underlying
Workspace vocabulary is current files, working copy, apply, and discard.

## Agent tool surface

The `PhotoAgent` (built on `@cloudflare/think`) exposes:

- `listPhotoState` — what's in the current draft.
- `runWorkspaceCommand` — Sandbox shell for ImageMagick (`identify`, `convert`).
- `runDynamicWorker` — Worker-native JS over a scoped Workspace binding for
  metadata, notes, manifests.
- `commitDraft` / `discardDraft` — the publication boundary.

Both runtimes get limited authority over the same draft. Neither runtime owns
the publication decision.

## Running it

```bash
cd examples/photo-agent-demo
npm install
npm run dev          # vite dev with the Cloudflare plugin
npm run build        # vite build
npm run deploy       # build + wrangler deploy
```

The Sandbox container needs Docker (Colima works) running locally for dev and
deploy.

## Boundary

Workspace owns durable file state and working-copy semantics. Think owns the
chat loop and tool selection. The Sandbox adapter owns command execution and
filesystem reconciliation. The Dynamic Worker adapter owns Worker Loader
mechanics.

Photo-specific concepts ("draft", "original", "current image") stay in this
example; they are not pushed into Workspace core.

## Related docs

- [Workspace product model](../../docs/product-model.md)
- [Runtime adapters](../../docs/runtime-adapters.md)
- [Architecture](../../docs/architecture.md)
- [Known limitations](../../docs/known-limitations.md)
