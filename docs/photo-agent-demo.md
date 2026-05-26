# Photo agent demo

This demo validates Workspace as durable image project state for an AI agent.

The browser handles upload because the user owns the local image bytes. After upload, the user edits through chat. The agent uses Think for conversation, Workspace for durable file state, and Sandbox for native image work.

## What it validates

The demo validates that:

- product-specific agent tools should sit above Workspace primitives,
- Sandbox is the execution boundary,
- Workspace is the durable file-state boundary,
- draft/current language maps naturally to Workspace working-copy semantics,
- passive previews can reflect durable Workspace state without exposing low-level file APIs to the user.

## Experience

The app has three visible zones:

```text
[Upload + workspace name]

[Original] [Draft edit] [Current]

[Chat / Agent activity timeline]
```

Upload is a concrete browser action. Image previews are passive and update from agent state. The chat timeline shows assistant text, compact tool activity, tool results, and collapsed reasoning.

## Agent editing model

The agent has broad freedom inside an isolated Sandbox working directory. It can use ImageMagick commands such as `identify` and `convert`, shell utilities, or short scripts.

The agent does not receive raw Workspace mutation tools. It receives product-level tools for inspecting photo state, running Sandbox commands, saving a generated file as the draft preview, making the draft current, and throwing the draft away.

## Durable state model

Workspace stores:

- uploaded original image,
- draft edit image,
- current image,
- immutable revisions from committed working copies.

Draft edits stay isolated until the user asks to make one current. The user can throw away a draft without changing the current image.

## Product boundary

Workspace does not run commands, own the container, or decide how to edit an image. Sandbox owns execution. Think owns agent conversation and tool choice. Workspace owns durable files and revision boundaries.

The current demo manually moves image bytes between Workspace and Sandbox. That is a product gap, not the desired long-term shape. The long-term Workspace model should provide a mount-like working-copy bridge so tools can operate directly on `/workspace`.
