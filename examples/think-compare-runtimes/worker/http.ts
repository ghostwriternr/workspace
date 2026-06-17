import { startComparisonRun } from "./runs";

export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json({ ok: true });
  }

  if (request.method === "POST" && url.pathname === "/api/runs") {
    return Response.json(await startComparisonRun());
  }

  return new Response("Not found", { status: 404 });
}
