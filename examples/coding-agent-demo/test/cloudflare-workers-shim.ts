export class DurableObject<Env = unknown> {
  protected readonly ctx: DurableObjectState;
  protected readonly env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class RpcTarget {}

export class WorkerEntrypoint<Env = unknown, Props = unknown> {
  protected readonly ctx: { props: Props; exports: Record<string, unknown> };
  protected readonly env: Env;

  constructor(ctx: { props: Props; exports: Record<string, unknown> }, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
