# Photo agent demo

The demo is a Worker app that uses Workspace as the durable state for an AI agent editing photos. It's deliberately not a photo editor — it's a proof that two different runtimes (a Sandbox shell and a Dynamic Worker) can edit the same Workspace draft and publish through one boundary.

For the wiring diagram and how the pieces fit, see [`architecture.md`](./architecture.md). For boundaries, see [`product-boundaries.md`](./product-boundaries.md).

## What the demo proves

- Workspace works as durable file state for AI-assisted work.
- The same draft (working copy) is usable from a Sandbox at `/workspace` and from a Dynamic Worker via `env.WORKSPACE` simultaneously.
- Delegated Worker code can receive scoped file authority without Workspace identity or publish authority.
- The publish boundary stays explicit: only `commitDraft` makes a draft current, and only `discardDraft` throws it away.
- Product-specific agent tools belong above Workspace primitives, not inside them.
- "Draft" / "current" maps cleanly to working-copy / head — users don't need to think in session/apply terms.
- Previews can be passive: agent state pushes change keys, the browser fetches only when things change.

## Experience

```
[Upload + workspace name]

[Original] [Draft edit] [Current]

[Chat / Agent activity timeline]
```

Upload is a concrete browser action because the user owns the local bytes. Image previews are passive and update from agent state. Chat shows assistant text, compact tool activity, tool results, and collapsed reasoning.

## How the agent edits

The agent has broad freedom inside an isolated Sandbox working directory. It can use ImageMagick (`identify`, `convert`), shell utilities, or short scripts. It also has Worker-native code execution through a Dynamic Worker with a scoped Workspace binding — useful for metadata, notes, manifests, anything file-oriented in JS.

It doesn't see raw Workspace control. It sees product-level tools:

- `listPhotoState` — passive state (original, current, draft, files in draft).
- `runWorkspaceCommand` — shell command in the Sandbox with the draft mounted at `/workspace`.
- `runDynamicWorker` — Worker-native JS over a scoped `env.WORKSPACE` for the draft.
- `commitDraft` — make the draft current.
- `discardDraft` — throw it away.

## What's stored in Workspace

- The uploaded original image.
- The durable draft edit image (and any other draft files).
- The current image.
- Immutable revisions from committed drafts.

A draft can survive across requests, reconnects, and agent turns. It's only published when the user (or the agent acting on user intent) asks for it.

## Product boundary

Workspace doesn't run commands, own the container, or decide how to edit an image. Sandbox owns execution. Think owns conversation and tool choice. Workspace owns durable files and the publication boundary.

The demo uses two of Workspace's projections over one draft:

- The **filesystem projection** for Sandbox commands: tools operate on `/workspace`, and mounted Workspace changes become part of the draft after reconcile.
- The **scoped file capability projection** for Dynamic Worker code: delegated JS sees `readFile` / `writeFile` / `list` / `stat` only, never Workspace identity or publish authority.

The remaining Workspace gaps relevant to this demo are the production mount and the Dynamic Worker module/asset projections — see [`known-limitations.md`](./known-limitations.md).
