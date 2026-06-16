# Workspace Sandbox adapter

`@cloudflare/workspace-adapter-sandbox` attaches a Workspace working copy to a Cloudflare Sandbox filesystem path and lets callers explicitly capture changes back into that working copy.

It is not a command runner. The Cloudflare Sandbox SDK already owns `getSandbox`, `sandbox.exec`, streaming, timeouts, environment variables, ports, sessions, sleep/destroy, and other runtime behavior. This adapter only fills the Workspace gap: make the durable working copy available at a runtime path and capture Workspace-owned changes when requested.

## What it owns

- Attaching a Workspace working copy to a Sandbox path such as `/workspace`.
- Hiding the working-copy mount descriptor used by the runtime.
- Capturing mounted filesystem changes back into the durable working copy.
- Returning attach/capture failures as `Result` values.

## What it does not own

- Sandbox lookup or lifecycle policy.
- Shell command execution.
- Streaming, ports, PTYs, sessions, or `runCode`.
- `apply()` or `discard()`.
- Agent tools, prompts, UI state, approvals, or source export.

## Container base image

The TypeScript adapter expects the Sandbox image to provide two commands:

- `workspace-mount` — mounts the Artifacts-backed working-copy ref at the
  requested path.
- `workspace-capture` — commits dirty files in that mount and pushes them back
  to the hidden working-copy ref.

This package includes a local base-image source at `container/Dockerfile`.
Build it from the repository root before running examples locally:

```bash
just build-sandbox-base
```

Example Dockerfiles can then extend it:

```dockerfile
FROM workspace-sandbox-base:local
```

The base image includes `artifact-fs`, `git`, `fuse3`, and the Workspace wrapper
commands. App images can layer extra tools on top, such as ImageMagick.

Local Sandbox FUSE support also requires patched `workerd`. The repo provides
an opt-in installer and dev recipes:

```bash
just install-fuse-workerd
just dev-coding-fuse
just dev-photo-fuse
```

Those recipes set `MINIFLARE_WORKERD_PATH` and
`WORKERD_LOCAL_DOCKER_ENABLE_FUSE=1`. Normal dev and production behavior are
unchanged.

## Local FUSE development

Local Sandbox development needs a patched `workerd` binary so Docker containers
receive `/dev/fuse` and the Linux capabilities required by `artifact-fs`. This is
opt-in and only affects local dev runs that set both environment variables below;
production deploys continue to use the normal Cloudflare runtime.

From the repository root:

```bash
just install-fuse-workerd
just build-sandbox-base
MINIFLARE_WORKERD_PATH="$PWD/.cache/workerd-fuse/workerd" \
  WORKERD_LOCAL_DOCKER_ENABLE_FUSE=1 \
  npm --prefix examples/photo-agent-demo run dev
```

The installer downloads a pinned release from `ghostwriternr/workerd` into
`.cache/workerd-fuse/workerd` and verifies its SHA-256 checksum. Override the
release when needed with `FUSE_WORKERD_VERSION`, or override the fork with
`FUSE_WORKERD_OWNER` / `FUSE_WORKERD_REPO`.

Convenience recipes run the demos with the same local-only environment:

```bash
just dev-photo-fuse
just dev-coding-fuse
```

## Usage

The adapter provides a Worker-runtime base class that enables HTTPS
interception and registers the Workspace Artifacts Git outbound handler as a
named handler. `attachWorkspaceCopyToSandbox` then installs a per-mounted-copy
host override before running `workspace-mount`.

```ts
import { getSandbox } from "@cloudflare/sandbox";
import { Workspace } from "@cloudflare/workspace";
import { attachWorkspaceCopyToSandbox } from "@cloudflare/workspace-adapter-sandbox";
import {
  WorkspaceSandbox,
  WorkspaceContainerProxy,
} from "@cloudflare/workspace-adapter-sandbox/workers";

export { WorkspaceContainerProxy as ContainerProxy };

export class Sandbox extends WorkspaceSandbox<Env> {}

const workspaces = Workspace.bind({
  artifacts: env.ARTIFACTS,
  objects: env.WORKSPACE_OBJECTS,
});
const workspace = workspaces.get(workspaceName);
const copy = await workspace.copies.create({ label: "agent-working-copy" });
if (copy.status === "error") return copy;

const sandbox = getSandbox(env.Sandbox, `${workspaceName}-${copy.value.id}`, {
  sleepAfter: "10m",
});
const mount = await attachWorkspaceCopyToSandbox({
  copy: copy.value,
  sandbox,
  path: "/workspace",
});
if (mount.status === "error") return mount;

const command = await sandbox.exec("npm test", {
  cwd: mount.value.path,
  timeout: 120_000,
});

const capture = await mount.value.capture();
```

A nonzero command exit code is a Sandbox result, not a Workspace error. Capture is explicit and separate from command execution. Publication remains a separate product decision through `copy.apply()` or `copy.discard()`.

The outbound handler is scoped by the mount descriptor. It mints short-lived
Artifacts Git credentials only for the mounted repository instead of acting as a
namespace-wide Artifacts credential gateway.

## Runtime foundation

The adapter uses `artifact-fs` as its filesystem foundation: mount the
Artifacts-backed hidden working-copy ref at `/workspace`, let Sandbox-native
APIs operate on that tree, and capture dirty state back into the same
working-copy ref.
