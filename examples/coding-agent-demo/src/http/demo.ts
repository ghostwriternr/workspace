export function handleDemoRequest(request: Request): Response | undefined {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  }

  if (url.pathname.startsWith("/api/")) {
    return new Response("Not found", { status: 404 });
  }

  return undefined;
}
