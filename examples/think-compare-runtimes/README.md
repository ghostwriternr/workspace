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
- a fake `/api/runs` path that emits terminal events for both runtime wings.

Real Think turns, warm Sandbox pools, Workspace-backed tools, and raw Sandbox
tools are the next slices.

## Commands

```bash
npm install
npm run check
npm test
npm run build
npm run dev
```
