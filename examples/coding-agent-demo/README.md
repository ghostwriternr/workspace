# Coding agent demo

A Worker app that imports a public GitHub repository into Workspace and lets a
chat-driven coding agent edit it. It is an example app, not part of Workspace
core.

The demo proves that Workspace can host real repository-scale work: GitHub →
Artifacts capture → Workspace working copy → Pi-style editing tools → user-driven
apply/discard.

## What it proves

- A public GitHub repo can be imported into a Workspace through the GitHub
  source adapter (`@cloudflare/workspace-source-github`).
- Imported files become the Workspace's current files; the browser lists
  directories on demand instead of eagerly loading the whole repository tree.
- A coding agent works against one durable working copy that survives chat
  turns, browser reconnects, and runtime failures.
- The agent has both Worker-native execution (Dynamic Worker) and a real shell
  (Sandbox) sharing the same working copy.
- The user holds the publication boundary: `applyWorkingCopy` or
  `discardWorkingCopy`.

## Agent tool surface

The `CodingAgent` (built on `@cloudflare/think`) exposes a deliberately small,
Pi-inspired toolbelt:

- `read({ path, offset?, limit? })` — Pi-style read with 2000-line / 50 KB
  truncation and continuation hints.
- `write({ path, contents })` — write a whole file into the working copy.
- `edit({ path, oldText, newText })` — exact-match edit; ambiguous matches
  fail.
- `run({ code })` — Dynamic Worker JavaScript over a scoped `env.WORKSPACE`
  binding; cheap, no container start.
- `shell({ command })` — Sandbox shell command with the working copy mounted
  at `/workspace`; for package managers, builds, native tools.
- `capture()` — capture files written under the Sandbox `/workspace` mount
  back into the durable working copy.

`applyWorkingCopy` and `discardWorkingCopy` are user-facing controls, not
default model tools. The agent must be explicitly asked to apply.

## Running it

```bash
cd examples/coding-agent-demo
npm install
npm run dev          # vite dev with the Cloudflare plugin
npm run build        # vite build
npm run deploy       # build + wrangler deploy
```

GitHub imports work against the public REST API. For higher rate limits,
provide a token via `.dev.vars`:

```
GITHUB_TOKEN=ghp_…
```

Local `wrangler dev` cannot currently exercise `env.ARTIFACTS.create/import`
because Miniflare's remote-binding WebSocket proxy fails for the Artifacts
binding shape. For end-to-end testing today, deploy and run against the
deployed Worker.

The Sandbox container needs Docker (Colima works) running locally for dev and
deploy. Build the shared Workspace Sandbox base image before running the demo:

```bash
just build-sandbox-base
```

Local FUSE-backed Sandbox mounts require a patched `workerd`. From the repo
root, use the opt-in recipe:

```bash
just dev-coding-fuse
```

Normal `npm run dev` remains unchanged.

For local dev that exercises the ArtifactFS/FUSE mount path, run from the
repository root:

```bash
just dev-coding-fuse
```

This downloads the pinned patched `workerd` binary into `.cache/`, builds the
Sandbox base image, and starts Vite with `MINIFLARE_WORKERD_PATH` plus
`WORKERD_LOCAL_DOCKER_ENABLE_FUSE=1`.

## Boundary

Workspace owns durable file state and working-copy semantics. Think owns the
chat loop and tool selection. The Sandbox SDK owns command execution and
container lifecycle. The Workspace Sandbox adapter owns attach/capture. The
Dynamic Worker adapter owns Worker Loader mechanics. The GitHub source adapter
owns import lifecycle.

The demo does not export back to GitHub (no PRs, no branches, no push). That
would be additional source-adapter work.

## Related docs

- [Workspace product model](../../docs/product-model.md)
- [Runtime adapters](../../docs/runtime-adapters.md)
- [Sources](../../docs/sources.md)
- [Known limitations](../../docs/known-limitations.md)
