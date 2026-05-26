# Workspace product API

Workspace should feel like durable files that can be used from different execution environments.

The implementation may use Durable Objects, R2, working sessions, RPC DTOs, loopback entrypoints, filesystem materialization, or native mounts. Product developers and agents should not need those concepts in the happy path. They should see current files, isolated file copies, environment attachments, scoped file access, and an explicit apply or discard decision.

This document describes the intended product-facing API shape. It is a design target, not a statement that every API exists today.

## Mental model

A Workspace stores current durable files.

A product can make an isolated durable copy of those files, mutate the copy, attach the copy to execution environments, and then either apply the copy to current files or discard it.

```text
current files
  -> file copy
  -> execution environment attachment
  -> captured changes in the copy
  -> apply or discard
```

The important boundaries are:

- Workspace owns durable file state.
- Execution environments own execution.
- Attachments make files available to execution environments.
- Capture brings execution-local file changes back into the copy.
- Apply makes the copy current.
- Discard abandons the copy.

## Vocabulary

| Term | Meaning |
| --- | --- |
| Workspace | Durable file-state resource. |
| Current files | The Workspace's current durable file tree. |
| File copy | An isolated durable mutable copy of current files. |
| Attachment | A way for an execution environment to access a file copy. |
| Capture | Bring file changes from an attachment back into the file copy. |
| Apply | Make a file copy become the current files. |
| Discard | Abandon a file copy without changing current files. |
| Scoped files | Limited file access granted to delegated code. |

The product-facing API should avoid leading with implementation terms such as session, RPC result, Durable Object stub, loopback, projection, mount host, or disposal.

## Happy path sketch

```ts
const workspace = Workspace.get(env.WORKSPACES, "family-photo");

await workspace.files.write("/photos/original.jpg", imageBytes);

const copy = await workspace.files.copy("crop-square");
const attachment = await copy.files.attach(sandbox, "/workspace");

const result = await sandbox.exec(
  "convert photos/original.jpg -gravity center -crop 1024x1024+0+0 +repage photos/current",
  { cwd: attachment.path },
);

if (result.success) {
  await attachment.capture();
}

await copy.apply();
// or:
await copy.discard();
```

The same file copy can also be exposed to delegated Worker code through scoped file access:

```ts
await dynamicWorker.run({
  code,
  env: {
    WORKSPACE: copy.files.scoped({
      read: "/photos/**",
      write: ["/photos/**", "/notes/**"],
    }),
  },
});
```

This shape is intentionally boring. Product code says what it wants:

- write current files,
- copy files for isolated work,
- attach files to an execution environment,
- capture useful execution results,
- apply or discard the copy.

## Current files and file copies

`workspace.files` represents the current file tree.

```ts
await workspace.files.read(path);
await workspace.files.write(path, bytes);
await workspace.files.list(path);
await workspace.files.stat(path);
await workspace.files.delete(path);
```

`workspace.files.copy(name)` creates an isolated durable mutable file tree initialized from current files.

```ts
const copy = await workspace.files.copy("agent-edit");
await copy.files.write("/notes/summary.md", bytes);
```

A copy is durable, but it is not current. It may survive across requests, agent turns, reconnects, or process failures. Applying a copy is a separate decision.

## Attachments and capture

Attachments are how file copies become usable from execution environments.

For Sandboxes and containers, an attachment makes copy files available at a path such as `/workspace`.

```ts
const attachment = await copy.files.attach(sandbox, "/workspace");
await sandbox.exec("npm test", { cwd: attachment.path });
await attachment.capture();
```

`capture()` belongs to the attachment, not to the copy. It records useful execution-environment file changes into the file copy.

This distinction exists because some execution environments are not live Workspace mounts. Current Sandbox integration materializes files into a container filesystem and later reads changes back. A future native mount may make capture cheaper, automatic, or unnecessary for that attachment type, but the product model remains the same: execution changes become proposed file-copy state before they become current Workspace state.

Do not treat capture as publication. Captured files are still isolated in the copy.

## Apply and discard

`apply()` is the publication boundary from a file copy to current files.

```ts
await copy.apply();
```

After apply, current Workspace files reflect the copy and a recovery point can be created.

`discard()` abandons a file copy without changing current files.

```ts
await copy.discard();
```

`capture()` and `apply()` answer different questions:

```text
capture: Do we want to keep this execution result in the copy?
apply:   Do we want this copy to become current?
```

A successful command may be captured automatically by product logic or an agent tool. Applying should usually require product or user intent.

## Scoped files for delegated code

Delegated code should usually receive scoped file access, not Workspace identity.

```ts
const files = copy.files.scoped({
  read: "/input/**",
  write: "/output/**",
});
```

The scoped file object can be passed to execution environments that accept bindings, such as Dynamic Workers. It should expose familiar file operations and nothing more:

```ts
await env.WORKSPACE.readFile("/input/data.json");
await env.WORKSPACE.writeFile("/output/result.json", bytes);
await env.WORKSPACE.list("/input");
await env.WORKSPACE.stat("/input/data.json");
```

Scoped files should not expose Workspace identity, arbitrary lookup, apply, discard, revision management, or broad authority by default.

## Agents and platform developers

Platform developers should be able to use the primitives directly:

```ts
const copy = await workspace.files.copy("edit");
const attachment = await copy.files.attach(sandbox, "/workspace");
const result = await sandbox.exec(command, { cwd: attachment.path });
if (result.success) await attachment.capture();
await copy.apply();
```

Agents should receive tool-shaped versions of the same model:

```text
open file copy
attach copy to sandbox
run sandbox command
capture sandbox changes
inspect copy files
apply copy
discard copy
```

The agent tool descriptions should stay concrete. For example:

```text
Capture files changed under /workspace in the Sandbox into the active file copy.
This keeps the result for preview or further edits, but does not change current Workspace files.
```

The same architecture serves both audiences. Platform developers see a small set of boring primitives. Agents see concrete tools built from those primitives.

## What product code should not need

The happy path should not require product code to manage:

- Durable Object session plumbing,
- `beginSession()` and `getSession()` calls,
- `session.info()` calls,
- raw RPC result branching for common flows,
- RPC stub disposal,
- loopback entrypoint transport details,
- manual scoped capability construction,
- Sandbox mount-host implementation details,
- parent directory creation before file writes.

Those details can exist in lower layers. They should not be the first API a product developer or agent author sees.

## Boundary rules

- Workspace does not run commands.
- Workspace does not own Sandbox, container, or Dynamic Worker lifecycle.
- Execution environments do not decide when a copy becomes current by default.
- Attachment capture does not imply apply.
- Applying a copy should be explicit and product-visible.
- Products choose their own user-facing language. A photo app may call a file copy a draft. A generated app product may call it a preview. Workspace should keep the generic model boring.

## Current implementation gap

The current prototype proves the underlying semantics with sessions, filesystem materialization, scoped Dynamic Worker file capabilities, and explicit commit/discard. The product-facing API described here is the target for making those semantics approachable.

Future implementation should be judged by whether product code like `services/photo-agent-demo` can express Workspace usage in these terms without exposing raw Workspace machinery.
