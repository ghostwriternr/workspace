import { Result, type Result as BetterResult } from "better-result";
import { workspaceCopyRuntimeMount, type WorkspaceRuntimeMountDescriptor } from "@cloudflare/workspace/runtime-adapter";

export type WorkspaceSandboxClient = {
  setOutboundByHost(hostname: string, methodName: string, params: WorkspaceArtifactsGitOutboundParams): Promise<void>;
  exec(command: string, options?: { cwd?: string; env?: Record<string, string>; timeout?: number }): Promise<{ success: boolean; exitCode: number; stdout: string; stderr: string }>;
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

export type WorkspaceArtifactsGitEnv = {
  ARTIFACTS: {
    get(name: string): Promise<{
      createToken?: (scope: "read" | "write", ttl: number) => Promise<{ plaintext: string }>;
    }>;
  };
};

export type WorkspaceArtifactsGitOutboundParams = {
  remote: string;
  repository: string;
  baseRef: string;
  copyRef: string;
};

export type WorkspaceArtifactsGitOutboundContext = {
  containerId: string;
  className: string;
  params?: WorkspaceArtifactsGitOutboundParams;
};

const DEFAULT_PATH = "/workspace";
const TOKEN_TTL_SECONDS = 60 * 60;
const MOUNT_TIMEOUT_MS = 125_000;
const CAPTURE_TIMEOUT_MS = 125_000;
const MOUNT_COMMAND_TIMEOUT_SECONDS = 115;
const CAPTURE_COMMAND_TIMEOUT_SECONDS = 115;
const ARTIFACTS_HOST_SUFFIX = ".artifacts.cloudflare.net";
const WORKSPACE_ARTIFACTS_GIT_HANDLER = "workspaceArtifactsGit";

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

  const outbound = outboundMountParams(descriptor.value);
  if (!outbound) {
    return Result.err({
      tag: "WorkspaceSandboxAttachError",
      message: "Workspace mount descriptor does not include a valid Artifacts Git remote.",
    });
  }

  try {
    await options.sandbox.setOutboundByHost(outbound.hostname, WORKSPACE_ARTIFACTS_GIT_HANDLER, outbound.params);
  } catch (error) {
    return Result.err({
      tag: "WorkspaceSandboxAttachError",
      message: error instanceof Error ? error.message : "Workspace Sandbox outbound setup failed.",
    });
  }

  const mounted = await options.sandbox.exec(`timeout ${MOUNT_COMMAND_TIMEOUT_SECONDS}s workspace-mount`, {
    cwd: "/",
    env: mountEnvironment(descriptor.value, path),
    timeout: MOUNT_TIMEOUT_MS,
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
      const captured = await options.sandbox.exec(`timeout ${CAPTURE_COMMAND_TIMEOUT_SECONDS}s workspace-capture`, {
        cwd: "/",
        env: captureEnvironment(descriptor.value, path),
        timeout: CAPTURE_TIMEOUT_MS,
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

export async function workspaceArtifactsGitOutboundHandler(
  request: Request,
  env: WorkspaceArtifactsGitEnv,
  ctx: WorkspaceArtifactsGitOutboundContext,
  fetcher: (request: Request) => Promise<Response> = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  if (!isArtifactsHost(url.hostname)) {
    return fetcher(request);
  }

  const params = ctx.params;
  if (!params) {
    return new Response("Workspace Artifacts Git outbound request is not scoped to a mounted copy.", { status: 403 });
  }

  if (!isGitSmartHttpRequest(url, request.method)) {
    return new Response("Workspace Artifacts Git outbound request is not allowed.", { status: 403 });
  }

  const repository = repositoryNameFromArtifactsGitUrl(url);
  if (!repository) {
    return new Response("Workspace Artifacts Git repository could not be determined.", { status: 403 });
  }

  if (repository !== params.repository) {
    return new Response("Workspace Artifacts Git repository is outside the mounted copy scope.", { status: 403 });
  }

  const repo = await env.ARTIFACTS.get(repository);
  if (typeof repo.createToken !== "function") {
    return new Response("Workspace Artifacts repository cannot mint Git credentials.", { status: 502 });
  }

  const token = await repo.createToken(gitScope(url, request.method), TOKEN_TTL_SECONDS);
  const headers = new Headers(request.headers);
  headers.set("authorization", basicAuth("x-access-token", token.plaintext));

  return fetcher(new Request(request, { headers }));
}

function outboundMountParams(
  descriptor: WorkspaceRuntimeMountDescriptor,
): { hostname: string; params: WorkspaceArtifactsGitOutboundParams } | undefined {
  let url: URL;
  try {
    url = new URL(descriptor.remote);
  } catch {
    return undefined;
  }

  const repository = repositoryNameFromArtifactsGitUrl(url);
  if (!repository) return undefined;

  return {
    hostname: url.hostname,
    params: {
      remote: descriptor.remote,
      repository,
      baseRef: descriptor.baseRef,
      copyRef: descriptor.ref,
    },
  };
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

function isArtifactsHost(hostname: string): boolean {
  return hostname === "artifacts.cloudflare.net" || hostname.endsWith(ARTIFACTS_HOST_SUFFIX);
}

function repositoryNameFromArtifactsGitUrl(url: URL): string | undefined {
  const segments = url.pathname.split("/").filter(Boolean);
  const serviceIndex = segments.findIndex((segment) => segment === "info" || segment === "git-upload-pack" || segment === "git-receive-pack");
  const repoSegment = segments.slice(0, serviceIndex === -1 ? undefined : serviceIndex).at(-1);
  if (!repoSegment) return undefined;
  return repoSegment.endsWith(".git") ? repoSegment.slice(0, -4) : repoSegment;
}

function isGitSmartHttpRequest(url: URL, method: string): boolean {
  if (method === "GET" && url.pathname.endsWith("/info/refs")) {
    const service = url.searchParams.get("service");
    return service === "git-upload-pack" || service === "git-receive-pack";
  }
  if (method === "POST") {
    return url.pathname.endsWith("/git-upload-pack") || url.pathname.endsWith("/git-receive-pack");
  }
  return false;
}

function gitScope(url: URL, method: string): "read" | "write" {
  if (method === "POST" && url.pathname.endsWith("/git-receive-pack")) {
    return "write";
  }
  if (url.searchParams.get("service") === "git-receive-pack") {
    return "write";
  }
  return "read";
}

function basicAuth(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`;
}
