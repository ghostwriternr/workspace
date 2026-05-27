# Agent instructions for this repo

Keep this file short. Detail belongs in `docs/`.

## Guardrails

Workspace is durable file state, not execution. Do not add `run`/`exec`, container or Sandbox lifecycle, Dynamic Worker loading, agent orchestration, Git semantics (branches, remotes, rebase), policy/approval systems, or full distributed POSIX behavior to the Workspace core.

Do not add broad scaffolding, placeholder files, or speculative config. If a feature isn't paying for itself today, it shouldn't be in the tree.

## Repo map

- `packages/workspace/` — the Workspace package. Keep durable file-state primitives here.
- `examples/photo-agent-demo/` — example Worker. Agent/Sandbox/Dynamic Worker concerns live here, not in the package.
- `docs/architecture.md` — how things actually work in code.
- `docs/product-boundaries.md` — the in/out-of-scope rules.

## Commands

```bash
just check
just test
just typegen
just check && just test
```

## Conventions

- Expected domain failures are `Result` values, not thrown exceptions.
- Use `better-result` tagged errors internally; operation-specific error unions, not a catch-all.
- Durable Object RPC returns serializable Result-shaped DTOs, not error classes (error classes don't survive structured clone).
- No `unwrap()` in production code.
- TDD where it pays off (storage, projections, semantic edges). Don't add tests purely to inflate coverage.
