import type { Sandbox } from "./index";

import { createComparisonRunOptions } from "./run-dependencies";
import { startComparisonRun, type StartComparisonRunOptions } from "./runs";

interface CompareRuntimeEnv {
  Sandbox?: DurableObjectNamespace<Sandbox>;
}

export async function handleRequest(request: Request, env: CompareRuntimeEnv = {}): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json({ ok: true });
  }

  if (request.method === "POST" && url.pathname === "/api/runs") {
    return Response.json(await startComparisonRun(await runOptionsForEnv(env)));
  }

  return new Response("Not found", { status: 404 });
}

async function runOptionsForEnv(env: CompareRuntimeEnv): Promise<StartComparisonRunOptions> {
  if (!env.Sandbox) return {};

  const { createRawSandboxFactory } = await import("./runtimes/cloudflare-sandbox");
  return createComparisonRunOptions({ rawSandboxFactory: createRawSandboxFactory(env.Sandbox) });
}
