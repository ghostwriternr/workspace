export { WorkspaceObject } from "@cloudflare/workspace";

export default {
  fetch() {
    return new Response("Not found", { status: 404 });
  },
};
