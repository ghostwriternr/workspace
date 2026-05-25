export { WorkspaceObject } from "./workspace/workspace-object";
export { WorkspaceSession } from "./workspace/workspace-session";

export default {
  fetch(): Response {
    return new Response("Not found", { status: 404 });
  },
};
