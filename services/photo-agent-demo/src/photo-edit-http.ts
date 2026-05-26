import { runDemoScenario } from "./demo-scenario";
import type { DemoImageEditor } from "./image/sandbox-image-editor";

type RunDemoScenarioOptions = Parameters<typeof runDemoScenario>[0];
type WorkspaceNamespace = RunDemoScenarioOptions["workspaces"];

type PhotoEditDependencies = {
  workspaces: WorkspaceNamespace;
  createImageEditor(workspaceName: string): DemoImageEditor;
};

const grayscaleRoutePattern = /^\/api\/workspaces\/([^/]+)\/demo\/grayscale$/;

export async function handlePhotoEditRequest(
  request: Request,
  dependencies: PhotoEditDependencies,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const match = grayscaleRoutePattern.exec(url.pathname);
  if (!match) {
    return undefined;
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const workspaceName = decodeURIComponent(match[1]);

  try {
    const report = await runDemoScenario({
      workspaces: dependencies.workspaces,
      imageEditor: dependencies.createImageEditor(workspaceName),
      workspaceName,
    });

    return Response.json(report, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "No uploaded original photo found") {
      return Response.json({ error: error.message }, { status: 404 });
    }

    throw error;
  }
}
