# Agent instructions for this repo

Keep this file short. Detail belongs in `docs/`.

## Guardrails

Workspace is durable file state, not execution. Do not add `run`/`exec`, container or Sandbox lifecycle, Dynamic Worker loading, agent orchestration, Git semantics (branches, remotes, rebase), policy/approval systems, or full distributed POSIX behavior to the Workspace core.

Do not add broad scaffolding, placeholder files, or speculative config. If a feature isn't paying for itself today, it shouldn't be in the tree.

Build only what is needed. Don't add inspection methods, convenience helpers, status fields, or pre-flight checks until a real caller needs them.

## Repo map

- `packages/workspace/` — the Workspace package. Keep durable file-state primitives and Artifacts-backed work-surface APIs here.
- `packages/adapters/dynamic-worker/` — Dynamic Worker adapter. Keep execution integration here, not in Workspace core.
- `packages/adapters/sandbox/` — Sandbox adapter. Keep container execution integration here, not in Workspace core.
- `examples/photo-agent-demo/` — example Worker. Agent/Sandbox/Dynamic Worker concerns live here, not in the package.
- `examples/coding-agent-demo/` — example Worker for importing public GitHub repos into Workspace before agent edits.
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
