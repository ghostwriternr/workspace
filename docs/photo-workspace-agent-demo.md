# Photo Workspace Agent demo

This demo shows Workspace as durable image project state for an AI agent.

The browser handles upload because the user owns the local image bytes. After upload, the user edits through chat. The agent uses Think for conversation, Workspace for durable file state, and Sandbox for native image work.

## Experience

The app has three visible zones:

```text
[Upload + workspace name]

[Original] [Draft edit] [Current]

[Chat / Agent activity timeline]
```

Upload is a concrete browser action. Image previews are passive and update from agent state. The chat timeline shows assistant text, compact tool activity, tool results, and collapsed reasoning.

## Agent editing model

The agent has broad freedom inside an isolated Sandbox working directory. The tool layer hydrates the current Workspace image into that directory, runs the agent's shell command there, and imports the selected output file into the Workspace draft.

The agent can use ImageMagick commands such as `identify` and `convert`, shell utilities, or short scripts. This keeps image operations natural for the model while Workspace remains focused on durable file state.

## Durable state model

Workspace stores:

- uploaded original image,
- draft edit image,
- current image,
- immutable revisions from committed sessions.

Draft edits stay isolated until the user asks to make one current. The user can throw away a draft without changing the current image.

## Product boundary

Workspace does not run commands, own the container, or decide how to edit an image. Sandbox owns execution. Think owns agent conversation and tool choice. Workspace owns durable files and revision boundaries.
