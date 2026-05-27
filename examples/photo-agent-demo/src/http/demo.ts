const demoCapabilities = {
  agent: "Think",
  execution: "Sandbox/ImageMagick and Dynamic Workers",
  state: "Workspace durable files",
  durability: "make draft current or discard",
} as const;

function json(value: unknown): Response {
  return Response.json(value, {
    headers: { "cache-control": "no-store" },
  });
}

export function handleDemoRequest(request: Request): Response | undefined {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return json({ ok: true });
  }

  if (url.pathname === "/api/demo-capabilities") {
    return json(demoCapabilities);
  }

  if (url.pathname.startsWith("/api/")) {
    return new Response("Not found", { status: 404 });
  }

  return undefined;
}
