import { createRunSession, type RunSession } from "./run-session";

export interface CompareRunStarter {
  startRun(runId: string): Promise<RunSession>;
}

export async function handleRequest(
  request: Request,
  starter?: CompareRunStarter,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json({ ok: true });
  }

  if (request.method === "POST" && url.pathname === "/api/runs") {
    const session = createRunSession();
    const started = starter ? await starter.startRun(session.runId) : session;
    return Response.json(started, { status: 201 });
  }

  return new Response("Not found", { status: 404 });
}
