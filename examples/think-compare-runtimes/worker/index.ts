import { handleRequest } from "./http";

export default {
  fetch(request: Request): Promise<Response> {
    return handleRequest(request);
  },
};
