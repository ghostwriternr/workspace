import { ContainerProxy, Sandbox as BaseSandbox } from "@cloudflare/sandbox";

import {
  workspaceArtifactsGitOutboundHandler,
  type WorkspaceArtifactsGitEnv,
  type WorkspaceArtifactsGitOutboundContext,
} from "./index";

export { ContainerProxy as WorkspaceContainerProxy };

export class WorkspaceSandbox<Env = unknown> extends BaseSandbox<Env> {
  interceptHttps = true;
}

WorkspaceSandbox.outboundHandlers = {
  workspaceArtifactsGit: (request, env, ctx) =>
    workspaceArtifactsGitOutboundHandler(
      request,
      env as unknown as WorkspaceArtifactsGitEnv,
      ctx as WorkspaceArtifactsGitOutboundContext,
    ),
};
