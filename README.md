# Workspace

Workspace is durable file state for Cloudflare execution environments.

Workers should be able to manipulate a Workspace through a direct file-tree API. Containers should be able to use the same Workspace through a normal local working copy, such as `/workspace`. Local container changes become durable only when explicitly committed.

See [`docs/product-boundaries.md`](./docs/product-boundaries.md) for the current product boundary and [`docs/known-limitations.md`](./docs/known-limitations.md) for accepted prototype limitations.

## Status

This repository has a minimal TypeScript control-plane package with a first durable Workspace slice: a SQLite-backed Durable Object owns file-tree metadata, R2 stores file bytes as content-addressed blobs, and live RPC session handles provide isolated working trees that can be committed or discarded.

It also has a photo agent demo Worker that validates Workspace as durable state for AI-assisted image editing, with Think for chat and Sandbox for native image transformations.

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
