import { Sandbox as BaseSandbox } from "@cloudflare/sandbox";

import { handleRequest } from "./http";

export class Sandbox extends BaseSandbox<Env> {}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
