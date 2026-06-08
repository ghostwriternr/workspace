export { WorkspaceFileCapability } from "../src/workspace/workspace-file-capability";

export default {
  fetch() {
    return new Response("Not found", { status: 404 });
  },
};
