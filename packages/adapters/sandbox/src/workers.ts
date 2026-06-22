import { ContainerProxy as BaseContainerProxy, Sandbox as BaseSandbox } from "@cloudflare/sandbox";

import {
  workspaceArtifactsGitOutboundHandler,
  type WorkspaceArtifactsGitEnv,
  type WorkspaceArtifactsGitOutboundContext,
} from "./index";

type ContainerProxyOutboundOverride = {
  method: string;
  params?: unknown;
};

type ContainerProxyProps = {
  containerId?: string;
  className?: string;
  outboundByHostOverrides?: Record<string, ContainerProxyOutboundOverride>;
};

const workspaceSandboxOutboundHandlers = {
  workspaceArtifactsGit: (request: Request, env: unknown, ctx: unknown) =>
    workspaceArtifactsGitOutboundHandler(
      request,
      env as WorkspaceArtifactsGitEnv,
      ctx as WorkspaceArtifactsGitOutboundContext,
    ),
};

export class WorkspaceContainerProxy extends BaseContainerProxy {
  async fetch(request: Request): Promise<Response> {
    const hostname = new URL(request.url).hostname;
    const props = this.ctx.props as ContainerProxyProps;
    const override = props.outboundByHostOverrides?.[hostname];
    if (override?.method === "workspaceArtifactsGit") {
      return workspaceArtifactsGitOutboundHandler(
        request,
        this.env as unknown as WorkspaceArtifactsGitEnv,
        {
          containerId: props.containerId ?? "",
          className: props.className ?? "",
          params: override.params as WorkspaceArtifactsGitOutboundContext["params"],
        },
      );
    }

    return super.fetch(request);
  }
}

export class WorkspaceSandbox<Env = unknown> extends BaseSandbox<Env> {
  interceptHttps = true;

  constructor(...args: ConstructorParameters<typeof BaseSandbox<Env>>) {
    super(...args);
    (this.constructor as typeof WorkspaceSandbox).outboundHandlers = workspaceSandboxOutboundHandlers;
  }
}

WorkspaceSandbox.outboundHandlers = workspaceSandboxOutboundHandlers;
