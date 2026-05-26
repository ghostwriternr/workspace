# Workspace agent instructions

Keep this file short. Put product detail in docs.

## Guardrails

Workspace is durable file state, not execution. Do not add `run`/`exec`, container lifecycle, agent orchestration, Git/Artifacts semantics, policy systems, or full distributed POSIX behavior to the core model.

Do not add broad scaffolding, placeholder files, or speculative config.

## Map

- `packages/workspace/` — Workspace package; keep durable file-state primitives here.
- `examples/photo-agent-demo/` — Think/Sandbox/Dynamic Worker example app; keep agent/execution concerns here.
- `docs/product-boundaries.md` — product boundary reference.

Future SDKs, protocol schemas, container filesystem components, shared tests, and container images should be added only when deliberately designed.

## Commands

```bash
just check
just test
just typegen
just check && just test
```

## Core conventions

- Expected Workspace failures are `Result` values, not thrown exceptions.
- Use `better-result` tagged errors for internal domain failures.
- Durable Object RPC returns serializable Result-shaped DTOs, not error classes.
- Use operation-specific error unions.
- Do not use `unwrap()` in production code.
