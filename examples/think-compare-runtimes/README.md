# Think runtime comparison

Fixed-task demo comparing two agents doing the same docs/coding task with the
same model-facing project path and similar tools.

- **Workspace-backed** uses `@cloudflare/workspace` as the durable file surface
  and composes with Dynamic Workers plus Sandbox SDK for execution.
- **Raw Sandbox** uses plain `@cloudflare/sandbox` file and command APIs as a
  runtime-local working environment.

The v1 task is built in: document Smart Request Policies in a small Workers docs
fixture. The agent should not see Workspace internals such as working copies,
Artifacts, hidden refs, capture, or apply/discard. Those details are app/runtime
telemetry for the human viewer.

## Current slice

This example currently has:

- the fixed task fixture;
- a run event shape;
- dashboard model derivation;
- a two-column React shell;
- a `/api/runs` path that starts a run session and streams events over a run WebSocket;
- a raw Sandbox runtime wired through the Sandbox SDK;
- a Workspace-backed runtime wired through `@cloudflare/workspace`, Dynamic
  Workers, and Workspace Sandbox attachment/capture;
- Durable Object-backed warm pools for both Sandbox runtimes, refreshed by DO
  alarms and a cron trigger;
- Think-backed runtime agents for both wings, using Workers AI and the same
  model-facing coding task.

Runtime-specific wiring lives under `worker/runtime-harness/`. That local
harness is intentionally not a package API yet: it gives this example one
coherent coding-runtime seam while the reusable Workspace, Dynamic Worker, and
Sandbox packages keep their narrower product boundaries.

## Commands

```bash
npm install
npm run check
npm test
npm run build
npm run dev
```

The Workspace Sandbox image extends `workspace-sandbox-base:local`, so local
Docker builds need the shared base image first. The raw Sandbox wing uses the
plain Sandbox SDK base image.

```bash
just build-sandbox-base
```
