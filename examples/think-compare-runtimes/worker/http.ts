import type { WorkspaceDynamicWorkerLoader } from "@cloudflare/workspace-adapter-dynamic-worker";
import type { WorkspaceBindingOptions } from "@cloudflare/workspace";
import type { WorkspaceSandboxClient } from "@cloudflare/workspace-adapter-sandbox";
import type { Sandbox } from "./index";

import { createComparisonRunOptions } from "./run-dependencies";
import { startComparisonRun, type StartComparisonRunOptions } from "./runs";
import { createWorkspaceRunOptionsFromBindings } from "./workspace-run-dependencies";

interface CompareRuntimeEnv {
  Sandbox?: DurableObjectNamespace<Sandbox>;
  ARTIFACTS?: WorkspaceBindingOptions["artifacts"] & {
    create(name: string, options?: { description?: string; setDefaultBranch?: string }): Promise<unknown>;
  };
  WORKSPACE_OBJECTS?: WorkspaceBindingOptions["objects"];
  DYNAMIC_WORKERS?: WorkspaceDynamicWorkerLoader;
}

export async function handleRequest(request: Request, env: CompareRuntimeEnv = {}, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json({ ok: true });
  }

  if (request.method === "POST" && url.pathname === "/api/runs") {
    return Response.json(await startComparisonRun(await runOptionsForEnv(env, ctx)));
  }

  return new Response("Not found", { status: 404 });
}

async function runOptionsForEnv(env: CompareRuntimeEnv, ctx?: ExecutionContext): Promise<StartComparisonRunOptions> {
  if (!env.Sandbox) return {};

  const { createRawSandboxFactory } = await import("./runtimes/cloudflare-sandbox");
  const options: StartComparisonRunOptions = {
    ...createComparisonRunOptions({ rawSandboxFactory: createRawSandboxFactory(env.Sandbox) }),
  };

  if (env.ARTIFACTS && env.WORKSPACE_OBJECTS && env.DYNAMIC_WORKERS && ctx) {
    const { getSandbox } = await import("@cloudflare/sandbox");
    Object.assign(options, await createWorkspaceRunOptionsFromBindings({
      artifacts: env.ARTIFACTS,
      dynamicWorkers: env.DYNAMIC_WORKERS,
      objects: env.WORKSPACE_OBJECTS,
      sandboxForLease: (lease) => getSandbox(env.Sandbox!, lease.id, { sleepAfter: "10m" }) as WorkspaceSandboxClient,
      workspaceForWorkingCopy: (workingCopyId) => ctx.exports.WorkspaceFileCapability({
        props: { workspaceName: "think-runtime-comparison", workingCopyId },
      }),
    }));
  }

  return options;
}
