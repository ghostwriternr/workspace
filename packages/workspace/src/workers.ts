export { WorkspaceObject } from "./workspace-object";

export default {
  fetch(): Response {
    return new Response("Not found", { status: 404 });
  },
};
