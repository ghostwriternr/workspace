import { Result, type Result as BetterResult } from "better-result";
import { workspaceCopyRuntimeMount, type WorkspaceRuntimeMountDescriptor } from "@cloudflare/workspace/runtime-adapter";

export type WorkspaceSandboxClient = {
  exec(command: string, options?: { cwd?: string; env?: Record<string, string> }): Promise<{ success: boolean; exitCode: number; stdout: string; stderr: string }>;
};

export type WorkspaceSandboxAttachOptions = {
  copy: object & { id: string };
  sandbox: WorkspaceSandboxClient;
  path?: string;
};

export type WorkspaceSandboxMount = {
  copyId: string;
  path: string;
  capture(): Promise<BetterResult<WorkspaceSandboxCaptureSummary, WorkspaceSandboxCaptureError>>;
};

export type WorkspaceSandboxCaptureSummary = {
  path: string;
  stdout: string;
  stderr: string;
};

export type WorkspaceSandboxAttachError = {
  tag: "WorkspaceSandboxAttachError";
  message: string;
};

export type WorkspaceSandboxCaptureError = {
  tag: "WorkspaceSandboxCaptureError";
  message: string;
};

const DEFAULT_PATH = "/workspace";

export async function attachWorkspaceCopyToSandbox(
  options: WorkspaceSandboxAttachOptions,
): Promise<BetterResult<WorkspaceSandboxMount, WorkspaceSandboxAttachError>> {
  const path = options.path ?? DEFAULT_PATH;
  const descriptor = await workspaceCopyRuntimeMount(options.copy);
  if (Result.isError(descriptor)) {
    return Result.err({
      tag: "WorkspaceSandboxAttachError",
      message: descriptor.error.message,
    });
  }

  const mounted = await options.sandbox.exec("workspace-mount", {
    cwd: "/",
    env: mountEnvironment(descriptor.value, path),
  });
  if (!mounted.success) {
    return Result.err({
      tag: "WorkspaceSandboxAttachError",
      message: mounted.stderr || `workspace-mount exited with ${mounted.exitCode}`,
    });
  }

  return Result.ok({
    copyId: options.copy.id,
    path,
    capture: async () => {
      const captured = await options.sandbox.exec("workspace-capture", {
        cwd: "/",
        env: captureEnvironment(descriptor.value, path),
      });
      if (!captured.success) {
        return Result.err({
          tag: "WorkspaceSandboxCaptureError",
          message: captured.stderr || `workspace-capture exited with ${captured.exitCode}`,
        });
      }

      return Result.ok({
        path,
        stdout: captured.stdout,
        stderr: captured.stderr,
      });
    },
  });
}

function mountEnvironment(
  descriptor: WorkspaceRuntimeMountDescriptor,
  path: string,
): Record<string, string> {
  return {
    WORKSPACE_REMOTE: descriptor.remote,
    WORKSPACE_BASE_REF: descriptor.baseRef,
    WORKSPACE_COPY_REF: descriptor.ref,
    WORKSPACE_PATH: path,
  };
}

function captureEnvironment(
  descriptor: WorkspaceRuntimeMountDescriptor,
  path: string,
): Record<string, string> {
  return {
    WORKSPACE_COPY_REF: descriptor.ref,
    WORKSPACE_PATH: path,
  };
}
