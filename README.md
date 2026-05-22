# Workspace

Workspace is durable file state for Cloudflare execution environments.

Workers should be able to manipulate a Workspace through a direct file-tree API. Containers should be able to use the same Workspace through a normal local working copy, such as `/workspace`. Local container changes become durable only when explicitly committed.

See [`docs/product-boundaries.md`](./docs/product-boundaries.md) for the current product boundary.

## Status

This repository is a structural skeleton. It intentionally has no implementation code, protocol definitions, generated code, language packages, Dockerfiles, CI, or service configuration yet.

## Layout

```text
docs/                    project documentation
services/control-plane/  future Worker/Durable Object control plane
workspacefs/             future container-facing filesystem component
sdks/typescript/         future TypeScript SDK
proto/                   future shared schema definitions
tests/                   future contract, e2e, and workload tests
images/                  future container image definitions
scripts/                 future development and validation scripts
```
