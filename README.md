# Workspace

Workspace is a durable file tree for Cloudflare execution environments. You can branch it into an isolated working copy, edit that copy from a Worker, a Sandbox, or a Dynamic Worker, and then either publish the changes or throw them away.

It's the missing primitive between "object storage" and "filesystem inside a runtime", aimed at agents, generated apps, and any product that wants a draft → preview → publish loop over files.

## What you get

- A durable file tree (`WorkspaceObject`, a Durable Object backed by SQLite + R2).
- Isolated working copies you can hand to a runtime: a Sandbox sees it at `/workspace`, a Dynamic Worker sees it as `env.WORKSPACE`, a trusted Worker uses it directly.
- Explicit publish (`apply`) and explicit throwaway (`discard`). Nothing is published implicitly when a command exits or a Worker returns.
- Immutable revisions of head as recovery points.

Workspace is source-agnostic: product flows might import files from a user upload, a GitHub checkout, a Hugging Face snapshot, an S3 bucket, or mount stable source snapshots beside Workspace-owned working copies. Bridging those systems in is product/source-adapter work (see [`docs/sources.md`](./docs/sources.md)). Runtime adapters, such as the Dynamic Worker adapter, project Workspace file capabilities into a specific execution environment without moving execution into Workspace core.

## Where to look

- [`docs/architecture.md`](./docs/architecture.md) — how the system is actually built and how a demo flow runs end-to-end. **Start here.**
- [`docs/product-model.md`](./docs/product-model.md) — the conceptual model: working copies, projections, authority.
- [`docs/product-api.md`](./docs/product-api.md) — the user-facing API we're aiming for.
- [`docs/runtime-projections.md`](./docs/runtime-projections.md) — the emerging vocabulary for file authorities, mounted views, and runtime adapters.
- [`docs/product-boundaries.md`](./docs/product-boundaries.md) — what Workspace is and isn't.
- [`docs/sources.md`](./docs/sources.md) — how external systems (GitHub, Hugging Face, S3, …) relate to a Workspace.
- [`docs/known-limitations.md`](./docs/known-limitations.md) — honest list of prototype gaps.
- [`docs/photo-agent-demo.md`](./docs/photo-agent-demo.md) — what the example app proves.
- [`AGENTS.md`](./AGENTS.md) — guardrails and conventions for anyone (or any agent) modifying the repo.

## Layout

```
packages/workspace/                 Reusable Workspace package (DO + R2, sessions, projections)
packages/source/github/             GitHub REST source adapter for streaming repo files
packages/adapters/dynamic-worker/   Dynamic Worker adapter for scoped Workspace files
examples/photo-agent-demo/           Worker app: Think agent edits photos via Sandbox + Dynamic Worker
                             over one Workspace working copy (called a draft in the UI)
examples/coding-agent-demo/  Worker app: imports public GitHub repos into Workspace for
                             agent-oriented coding flows
```

## Status

Prototype. The core durable semantics work (head tree, working copies, revisions, scoped file capabilities, filesystem projection). The first product-facing API layer exists for current files, file copies, streaming bulk tree writes into copies, filesystem attachments, capture, scoped file capabilities, apply, and discard. A first GitHub source adapter streams repository files into that import path. See `docs/known-limitations.md` for the full list.

The photo agent example is deployed at <https://workspace-photo-agent-demo.ghostwriternr.workers.dev>. The coding agent example is starting as a GitHub import loop with basic Workspace-backed repo state. `packages/source/*` packages bridge external file sources into Workspace flows. `packages/adapters/*` packages project Workspace capabilities into runtimes.

## Commands

```bash
just check    # typecheck + knip
just test     # vitest across packages/examples
just typegen  # regenerate worker-configuration.d.ts files
```
