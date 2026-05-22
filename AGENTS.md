# Workspace agent instructions

Keep this file short. Put product detail in docs.

## Guardrails

Workspace is durable file state, not execution. Do not add `run`/`exec`, container lifecycle, agent orchestration, Git/Artifacts semantics, policy systems, or full distributed POSIX behavior to the core model.

Do not add broad scaffolding, placeholder files, or speculative config.

## Map

- `services/control-plane/` — TypeScript control-plane package and core.
- `workspacefs/` — future container-facing filesystem component.
- `proto/` — future shared schemas; do not add until deliberately designed.
- `docs/product-boundaries.md` — product boundary reference.

## Commands

```bash
just check
just test
just check && just test
```

## Core conventions

- Expected Workspace failures are `Result` values, not thrown exceptions.
- Use `better-result` tagged errors for domain failures.
- Use operation-specific error unions.
- Do not use `unwrap()` in production code.
