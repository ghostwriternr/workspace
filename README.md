# Workspace

Workspace is durable file state for Cloudflare execution environments.

Workers should be able to manipulate a Workspace through a direct file-tree API. Delegated code should receive scoped file capabilities. Sandboxes and containers should be able to use the same Workspace through a normal local working copy, such as `/workspace`. Dynamic Workers should be able to receive Workspace-backed modules, assets, and scoped bindings. Working-copy changes are published only when explicitly committed.

See [`docs/workspace-product-model.md`](./docs/workspace-product-model.md) for the long-term product model, [`docs/workspace-product-api.md`](./docs/workspace-product-api.md) for the intended product-facing API shape, [`docs/product-boundaries.md`](./docs/product-boundaries.md) for guardrails, and [`docs/known-limitations.md`](./docs/known-limitations.md) for accepted prototype limitations.

## Status

This repository has a minimal TypeScript control-plane package with a first durable Workspace slice: durable file trees, explicit working copies, immutable revisions, conflict-safe commits, scoped file capabilities, and a prototype filesystem projection.

It also has a photo agent demo Worker that validates Workspace as durable state for AI-assisted image editing, with Think for chat, Sandbox for native image transformations through `/workspace`, and Dynamic Workers for scoped Worker-native code over the same draft. See [`docs/photo-agent-demo.md`](./docs/photo-agent-demo.md).

## Layout

```text
docs/                    project documentation
services/control-plane/  Worker/Durable Object Workspace control plane
services/photo-agent-demo/ Think/Sandbox photo editing demo Worker
workspacefs/             future container-facing filesystem component
sdks/typescript/         future TypeScript SDK
proto/                   future shared schema definitions
tests/                   future contract, e2e, and workload tests
images/                  future container image definitions
scripts/                 future development and validation scripts
```
