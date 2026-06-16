import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { registerWorkspaceCopyRuntimeMount } from "@cloudflare/workspace/runtime-adapter";
import {
  attachWorkspaceCopyToSandbox,
  workspaceArtifactsGitOutboundHandler,
} from "../src/index";

describe("attachWorkspaceCopyToSandbox", () => {
  it("mounts a Workspace copy through the adapter container commands", async () => {
    const copy = { id: "copy-123" };
    registerWorkspaceCopyRuntimeMount(copy, async () => Result.ok({
      copyId: "copy-123",
      remote: "https://artifacts.example/workspaces/demo.git",
      baseRef: "main",
      ref: "refs/workspace/copies/copy-123",
    }));
    const sandbox = new FakeSandbox();

    const attached = await attachWorkspaceCopyToSandbox({
      copy,
      sandbox,
      path: "/workspace",
    });

    expect(Result.isOk(attached)).toBe(true);
    if (Result.isError(attached)) return;

    expect(attached.value).toMatchObject({
      copyId: "copy-123",
      path: "/workspace",
    });
    expect(sandbox.outboundHosts).toEqual([
      {
        hostname: "artifacts.example",
        methodName: "workspaceArtifactsGit",
        params: {
          baseRef: "main",
          copyRef: "refs/workspace/copies/copy-123",
          remote: "https://artifacts.example/workspaces/demo.git",
          repository: "demo",
        },
      },
    ]);
    expect(sandbox.commands).toEqual([
      {
        command: "timeout 115s workspace-mount",
        options: {
          cwd: "/",
          env: {
            WORKSPACE_REMOTE: "https://artifacts.example/workspaces/demo.git",
            WORKSPACE_BASE_REF: "main",
            WORKSPACE_COPY_REF: "refs/workspace/copies/copy-123",
            WORKSPACE_PATH: "/workspace",
          },
          timeout: 125_000,
        },
      },
    ]);

    await sandbox.exec("npm test", { cwd: attached.value.path });
    expect(sandbox.commands.at(-1)).toEqual({ command: "npm test", options: { cwd: "/workspace" } });

    const captured = await attached.value.capture();

    expect(Result.isOk(captured)).toBe(true);
    expect(sandbox.commands.at(-1)).toEqual({
      command: "timeout 115s workspace-capture",
      options: {
        cwd: "/",
        env: {
          WORKSPACE_COPY_REF: "refs/workspace/copies/copy-123",
          WORKSPACE_PATH: "/workspace",
        },
        timeout: 125_000,
      },
    });
  });

  it("injects read Artifacts Git auth for the mounted repository", async () => {
    const fetched: Request[] = [];
    const response = await workspaceArtifactsGitOutboundHandler(
      new Request("https://account.artifacts.cloudflare.net/workspace-coding-agent-demo/demo.git/git-upload-pack", { method: "POST" }),
      fakeArtifactsEnv(),
      outboundContext(),
      async (request) => {
        fetched.push(request);
        return new Response("ok");
      },
    );

    expect(response.status).toBe(200);
    expect(fetched).toHaveLength(1);
    const authorization = fetched[0]?.headers.get("authorization");
    expect(authorization).toMatch(/^Basic /);
    expect(atob(authorization?.slice("Basic ".length) ?? "")).toBe("x-access-token:read-3600-token");
  });

  it("rejects Artifacts Git auth for repositories outside the mount", async () => {
    const response = await workspaceArtifactsGitOutboundHandler(
      new Request("https://account.artifacts.cloudflare.net/workspace-coding-agent-demo/other.git/git-upload-pack", { method: "POST" }),
      fakeArtifactsEnv(),
      outboundContext(),
      async () => new Response("should not fetch"),
    );

    expect(response.status).toBe(403);
  });

  it("uses write Artifacts Git auth for receive-pack to the mounted repository", async () => {
    const fetched: Request[] = [];
    const response = await workspaceArtifactsGitOutboundHandler(
      new Request("https://account.artifacts.cloudflare.net/workspace-coding-agent-demo/demo.git/git-receive-pack", { method: "POST", body: "pack" }),
      fakeArtifactsEnv(),
      outboundContext(),
      async (request) => {
        fetched.push(request);
        return new Response("ok");
      },
    );

    expect(response.status).toBe(200);
    const authorization = fetched[0]?.headers.get("authorization");
    expect(atob(authorization?.slice("Basic ".length) ?? "")).toBe("x-access-token:write-3600-token");
    expect(await fetched[0]?.text()).toBe("pack");
  });

  it("passes non-Artifacts outbound requests through", async () => {
    const fetched: Request[] = [];
    const response = await workspaceArtifactsGitOutboundHandler(
      new Request("https://github.com/cloudflare/workspace", { method: "GET" }),
      { ARTIFACTS: { get: async () => { throw new Error("not used"); } } },
      outboundContext(),
      async (request) => {
        fetched.push(request);
        return new Response("passed");
      },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("passed");
    expect(fetched).toHaveLength(1);
    expect(fetched[0]?.headers.has("authorization")).toBe(false);
  });

  it("rejects non-Git Artifacts outbound requests", async () => {
    const response = await workspaceArtifactsGitOutboundHandler(
      new Request("https://account.artifacts.cloudflare.net/workspace-coding-agent-demo/demo.git/raw/main/README.md", { method: "GET" }),
      { ARTIFACTS: { get: async () => { throw new Error("not used"); } } },
      outboundContext(),
      async () => new Response("should not fetch"),
    );

    expect(response.status).toBe(403);
  });
});

class FakeSandbox {
  readonly commands: Array<{ command: string; options: { cwd?: string; env?: Record<string, string>; timeout?: number } | undefined }> = [];
  readonly outboundHosts: Array<{ hostname: string; methodName: string; params: unknown }> = [];

  async setOutboundByHost(hostname: string, methodName: string, params: unknown) {
    this.outboundHosts.push({ hostname, methodName, params });
  }

  async exec(command: string, options?: { cwd?: string; env?: Record<string, string>; timeout?: number }) {
    this.commands.push({ command, options });
    return { success: true, exitCode: 0, stdout: "", stderr: "" };
  }
}

function fakeArtifactsEnv() {
  return {
    ARTIFACTS: {
      get: async (name: string) => ({
        name,
        createToken: async (scope: "read" | "write", ttl: number) => ({ plaintext: `${scope}-${ttl}-token` }),
      }),
    },
  };
}

function outboundContext() {
  return {
    containerId: "container",
    className: "Sandbox",
    params: {
      baseRef: "main",
      copyRef: "refs/workspace/copies/copy-123",
      remote: "https://account.artifacts.cloudflare.net/workspace-coding-agent-demo/demo.git",
      repository: "demo",
    },
  };
}
