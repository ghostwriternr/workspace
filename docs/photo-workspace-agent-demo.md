# Photo Workspace Agent demo

This note describes a production-like demo for Workspace. It is a product guide, not an implementation plan.

## Product thesis

Workspace should make durable file state feel natural for AI agents and Cloudflare execution environments.

The demo should prove that an agent can treat files as durable product state while choosing the right execution capability for each request:

- the model can inspect and reason about an uploaded image directly,
- Workspace stores the original image, draft edits, committed outputs, and revisions,
- a container is used only when real image manipulation needs native tools such as ImageMagick,
- session commit and discard form the explicit durability boundary.

The point is not to build an image editor. The point is to show that Workspace is the right shared state layer between an AI agent, durable storage, and specialized execution.

## Demo concept

The user uploads a photo and chats with an AI agent.

The agent can describe the image without starting a container. If the user asks for modifications, the agent starts a Workspace editing session, uses a Sandbox container with ImageMagick to produce an edited variant, stores the result as a draft in Workspace, and asks the user whether to commit or discard the change.

A committed edit becomes durable Workspace head state and creates a revision. A discarded edit disappears. A stale edit conflicts instead of silently overwriting newer work.

The demo should feel like this:

> I uploaded a photo. The agent understood it, made draft edits with real tools when needed, showed me previews, and managed durable versions for me.

## User experience

The primary interface is chat-first.

The user should interact with the system conversationally:

- “What is in this photo?”
- “Make it black and white.”
- “Crop it square for a profile picture.”
- “Try a warmer version.”
- “Commit that one.”
- “Discard the last draft.”
- “Show me the original and current version.”

The UI can include a side panel, but the side panel supports the conversation rather than replacing it.

Useful side-panel affordances:

- uploaded image preview,
- current draft preview,
- committed image preview,
- Workspace file list,
- open session state,
- revision/version list,
- conflict indicator.

The side panel should help observers understand what is happening inside Workspace. The user should not need to operate the system through buttons for the main flow.

## Core scenario

A compelling demo flow:

1. User uploads a photo.
2. Agent stores it in Workspace as the durable original.
3. User asks what is in the photo.
4. Agent describes the image using model vision, without a container.
5. User asks for an edit, such as “make it black and white and crop it square.”
6. Agent starts or reuses a draft Workspace session.
7. Agent hydrates the source image into a Sandbox container.
8. Agent runs ImageMagick to produce an edited output.
9. Agent writes the output back into the Workspace session.
10. Agent shows the draft preview and explains that it is not committed yet.
11. User says “commit it.”
12. Agent commits the session, creating durable head state and a revision.
13. User can compare original, draft, current, and revision outputs.

This flow validates the separation of responsibilities:

- model reasoning for understanding,
- Workspace for durable file state,
- Sandbox container for native image editing,
- session commit/discard for durability boundaries.

## What makes it an AI agent demo

The agent should decide which capability to use.

If the user asks for image understanding, the agent should inspect the image directly with the model.

If the user asks for image transformation, the agent should use tools backed by Workspace and Sandbox.

If the user asks for a speculative edit, the agent should keep it in a draft session.

If the user approves the result, the agent should commit.

If the user rejects it, the agent should discard.

The product should not feel like a workflow app with AI labels. It should feel like an agent managing durable work on the user's behalf.

## Workspace role

Workspace is the durable source of truth for the image project.

It stores:

- original uploads,
- draft edited variants,
- committed edited variants,
- simple metadata manifests if needed,
- immutable revisions created by snapshots or session commits.

Example file layout:

```text
/photos/original.jpg
/photos/current.jpg
/photos/drafts/profile-square.jpg
/photos/drafts/warm-tone.jpg
/photos/manifest.json
```

The exact paths can change, but the model should be simple enough for the agent and the user to understand.

Workspace does not run ImageMagick. Workspace does not own the container. Workspace does not decide what edit to make. It owns durable file state before and after execution.

## Session model in the demo

Image edits are naturally draft work.

A Workspace session should represent an uncommitted draft edit. The agent can write one or more edited outputs into the session, inspect them, and decide whether to commit or discard.

The user-facing language should avoid unnecessary implementation terms. Prefer:

- “draft edit” instead of “session,”
- “make this the current version” instead of “commit session,”
- “throw away the draft” instead of “discard session.”

The technical UI may still show session IDs and revision IDs for debugging and evaluation.

Session conflict behavior should be visible in the demo. If two edits start from the same base and one is committed first, the second should not silently overwrite it. The agent should explain that the draft is based on an older version and remains available for inspection or discard.

## Container role

The container is an execution tool, not the product state layer.

It should be used for operations that need native image tooling:

- grayscale conversion,
- resize,
- crop,
- rotate,
- border,
- format conversion,
- simple composition if needed.

The first version can use constrained tools rather than arbitrary shell. For example:

- `make_grayscale`
- `resize_image`
- `crop_image`
- `rotate_image`
- `add_border`

Each tool can internally run ImageMagick commands in the Sandbox container.

This keeps the demo safe and legible. The model asks for an image operation; the tool implementation decides the exact command.

## Tool posture

The agent should have tools that map to user intent, not raw infrastructure.

Useful tool categories:

### Workspace inspection

- read image metadata,
- list project files,
- read text metadata or manifest files,
- fetch image bytes for model-visible content.

### Draft editing

- start draft edit,
- write edited image output,
- list draft outputs,
- preview draft output,
- discard draft.

### Image operations

- grayscale,
- resize,
- crop,
- rotate,
- add border,
- convert format.

### Durability operations

- commit current draft,
- create snapshot,
- list revisions,
- compare current and original at a high level.

The model should not need to pass around `sessionId` manually. The tool layer can own the active draft session for the current task or conversation.

## Think role

Think is a good fit for the agent shell.

It provides:

- durable chat state,
- agentic loop,
- streaming,
- tool orchestration,
- programmatic submissions,
- client integration,
- Workers-native Agent behavior.

The demo should use Think to avoid building custom agent infrastructure. That lets the demo focus on the Workspace product thesis.

The agent can be implemented as a Think subclass with:

- a Workers AI model,
- a system prompt describing durable image workspace behavior,
- custom tools backed by Workspace and Sandbox,
- optional callable methods for deterministic demo scenarios and UI state inspection.

## Deterministic scenario support

The main demo should be chat-first, but a deterministic scenario is useful for development and evaluation.

A callable method such as `runDemoScenario()` can exercise the system without relying on model nondeterminism:

- create or load an example image,
- write it to Workspace,
- start a session,
- run a known ImageMagick edit,
- write the output to the session,
- commit it,
- create a conflicting session and prove conflict behavior,
- return a structured report.

This is not the main user experience. It is a confidence check that the system is wired correctly.

## What the MVP should prove

The MVP should prove these claims:

1. An uploaded image becomes durable Workspace state.
2. The agent can describe the image without a container.
3. The agent can use a container for real image edits.
4. Container output is written back to Workspace, not left as ephemeral execution state.
5. Draft edits are isolated from current committed state.
6. Draft edits can be committed or discarded explicitly.
7. Commit creates a durable version/revision.
8. Stale drafts conflict rather than overwriting newer work.
9. The user can understand what is current, what is draft, and what is historical.

If these claims hold, the foundational Workspace design makes sense even though many product gaps remain.

## What the MVP should not try to prove

The MVP should not try to become a complete image editor.

Avoid initially:

- arbitrary ImageMagick command generation,
- arbitrary shell access,
- complex layer editing,
- masks and selections,
- multi-user permissions,
- auth and sharing,
- billing,
- advanced metadata management,
- full container filesystem mounting,
- blob garbage collection,
- merge or rebase UX,
- complete revision browser,
- SDK polish.

These may matter later, but they are not required to validate the system's existence.

## Design risks to watch

### Agent tool ergonomics

If the model has to reason about too many low-level details, the demo will feel brittle. The tool layer should hide session IDs, container paths, and ImageMagick command syntax where possible.

### Workspace-to-container transfer

The first version can manually hydrate files from Workspace into Sandbox and write outputs back. That is acceptable for the MVP, but it does not validate a true mounted `/workspace` container view.

A future `workspacefs` integration can replace manual transfer once the product direction is proven.

### Binary/media handling

The control plane currently treats file contents as bytes and stores them in R2. The demo may need thin media helpers for MIME type, file extension, dimensions, and preview URLs.

Those should live at the demo/tool layer unless they become core Workspace metadata requirements.

### Conflict communication

Conflict detection is useful only if the agent can explain it. The agent should say something like:

> I could not make this draft the current version because the photo changed after I started editing. Your draft is still available. I can discard it, save it as an alternate version, or start a new edit from the current image.

This is clearer than exposing raw version numbers to the user.

## Product boundaries reinforced by the demo

The demo should reinforce the core Workspace boundary:

- Workspace is durable file state.
- Think is agent orchestration and conversation state.
- Sandbox is execution.
- ImageMagick is a tool inside execution.
- R2 and SQLite are storage implementation details.

If the demo starts putting execution policy, agent memory, or container lifecycle into Workspace itself, it is drifting.

## Success criteria

The demo succeeds if a viewer can understand the product in one sentence:

> Workspace gives an AI agent durable files, draft edits, and versioned commits while containers do the heavy execution only when needed.

It also succeeds if the engineering team learns whether this architecture feels natural when used from a real agent, not just from tests.

## Open product questions

These do not need to be answered before the MVP, but the demo should help expose them:

- Should Workspace have first-class media metadata?
- Should Workspace provide preview URLs or should demos/apps do that?
- Should sessions have user-facing names such as “drafts”?
- Should conflicts offer “save as alternate” as a first-class operation?
- When does manual Workspace-to-Sandbox file transfer become too awkward?
- What is the smallest useful `workspacefs` mount semantics for containers?
- Which file operations do agents actually need beyond read/write/list/delete?

## Summary

The Photo Workspace Agent demo should be a chat-first AI agent that uses Workspace as durable image project state and Sandbox/ImageMagick as an execution tool for edits.

It is a better validation target than a coding agent because it is visual, distinct, and naturally demonstrates the separation between model reasoning, durable file state, and specialized execution.
