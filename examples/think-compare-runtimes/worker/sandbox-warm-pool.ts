import { getSandbox, type Sandbox as SandboxDO } from "@cloudflare/sandbox";
import { DurableObject } from "cloudflare:workers";

import { containerSleepAfter, type ContainerPoolConfigEnv, warmPoolRefreshIntervalMs, warmPoolTarget } from "./container-config";
import { ContainerWarmPoolManager, type WarmPoolRuntime } from "./container-warm-pool-manager";

const POOL_NAME = "default";

interface SandboxLease {
  id: string;
  logicalId?: string;
}

export interface RunSandboxPool {
  lease(): Promise<SandboxLease>;
  release(lease: SandboxLease): Promise<void>;
}

interface SandboxWarmPoolHandle {
  getContainer(logicalId: string): Promise<string>;
  releaseContainer(logicalId: string): Promise<void>;
  refresh(): Promise<void>;
  reset(): Promise<void>;
}

export interface SandboxWarmPoolNamespace {
  getByName(name: string): unknown;
}

export interface RawSandboxWarmPoolEnv extends ContainerPoolConfigEnv {
  Sandbox: DurableObjectNamespace<SandboxDO>;
}

export interface WorkspaceSandboxWarmPoolEnv extends ContainerPoolConfigEnv {
  WorkspaceSandbox: DurableObjectNamespace<SandboxDO>;
}

export class RawSandboxWarmPool extends DurableObject<RawSandboxWarmPoolEnv> implements SandboxWarmPoolHandle {
  readonly #pool: SandboxWarmPoolBase<RawSandboxWarmPoolEnv>;

  constructor(ctx: DurableObjectState, env: RawSandboxWarmPoolEnv) {
    super(ctx, env);
    this.#pool = new SandboxWarmPoolBase(ctx, env, createSandboxRuntime({
      namespace: env.Sandbox,
      sleepAfter: () => containerSleepAfter(env),
    }));
  }

  getContainer(logicalId: string): Promise<string> {
    return this.#pool.getContainer(logicalId);
  }

  releaseContainer(logicalId: string): Promise<void> {
    return this.#pool.releaseContainer(logicalId);
  }

  refresh(): Promise<void> {
    return this.#pool.refresh();
  }

  reset(): Promise<void> {
    return this.#pool.reset();
  }

  alarm(): Promise<void> {
    return this.#pool.alarm();
  }
}

export class WorkspaceSandboxWarmPool extends DurableObject<WorkspaceSandboxWarmPoolEnv> implements SandboxWarmPoolHandle {
  readonly #pool: SandboxWarmPoolBase<WorkspaceSandboxWarmPoolEnv>;

  constructor(ctx: DurableObjectState, env: WorkspaceSandboxWarmPoolEnv) {
    super(ctx, env);
    this.#pool = new SandboxWarmPoolBase(ctx, env, createSandboxRuntime({
      namespace: env.WorkspaceSandbox,
      sleepAfter: () => containerSleepAfter(env),
    }));
  }

  getContainer(logicalId: string): Promise<string> {
    return this.#pool.getContainer(logicalId);
  }

  releaseContainer(logicalId: string): Promise<void> {
    return this.#pool.releaseContainer(logicalId);
  }

  refresh(): Promise<void> {
    return this.#pool.refresh();
  }

  reset(): Promise<void> {
    return this.#pool.reset();
  }

  alarm(): Promise<void> {
    return this.#pool.alarm();
  }
}

export function createDurableSandboxWarmPool(
  namespace: SandboxWarmPoolNamespace,
  logicalPrefix: string,
): RunSandboxPool {
  const handle = namespace.getByName(POOL_NAME) as unknown as SandboxWarmPoolHandle;
  let nextLease = 0;
  const logicalIds = new Map<string, string>();

  return {
    async lease() {
      const logicalId = `${logicalPrefix}:${nextLease++}`;
      const id = await handle.getContainer(logicalId);
      logicalIds.set(id, logicalId);
      return { id, logicalId };
    },

    async release(lease) {
      const logicalId = lease.logicalId ?? logicalIds.get(lease.id);
      if (!logicalId) return;
      logicalIds.delete(lease.id);
      await handle.releaseContainer(logicalId);
    },
  };
}

export async function refreshSandboxWarmPools(env: {
  WorkspaceSandboxWarmPool: SandboxWarmPoolNamespace;
  RawSandboxWarmPool: SandboxWarmPoolNamespace;
}): Promise<void> {
  await Promise.all([
    warmPoolHandle(env.WorkspaceSandboxWarmPool).refresh(),
    warmPoolHandle(env.RawSandboxWarmPool).refresh(),
  ]);
}

class SandboxWarmPoolBase<Env extends ContainerPoolConfigEnv> {
  readonly #manager: ContainerWarmPoolManager;
  readonly #refreshIntervalMs: number;
  readonly #ctx: DurableObjectState;
  readonly #env: Env;

  constructor(ctx: DurableObjectState, env: Env, runtime: WarmPoolRuntime) {
    this.#ctx = ctx;
    this.#env = env;
    this.#manager = new ContainerWarmPoolManager({
      storage: ctx.storage,
      runtime,
      target: warmPoolTarget(env),
    });
    this.#refreshIntervalMs = warmPoolRefreshIntervalMs(env);
    ctx.blockConcurrencyWhile(async () => {
      await this.#applyConfiguredReset();
      await this.#scheduleRefresh();
    });
  }

  getContainer(logicalId: string): Promise<string> {
    return this.#manager.getContainer(logicalId);
  }

  releaseContainer(logicalId: string): Promise<void> {
    return this.#manager.releaseContainer(logicalId).then(() => {
      this.#ctx.waitUntil(this.#manager.refresh());
    });
  }

  async refresh(): Promise<void> {
    await this.#applyConfiguredReset();
    await this.#manager.refresh();
    await this.#scheduleRefresh();
  }

  reset(): Promise<void> {
    return this.#manager.reset();
  }

  alarm(): Promise<void> {
    return this.refresh();
  }

  async #applyConfiguredReset(): Promise<void> {
    const resetKey = this.#env.WARM_POOL_RESET_KEY;
    if (!resetKey) return;

    const appliedKey = await this.#ctx.storage.get<string>("container-warm-pool-reset-key");
    if (appliedKey === resetKey) return;

    await this.#manager.reset();
    await this.#ctx.storage.put("container-warm-pool-reset-key", resetKey);
  }

  async #scheduleRefresh(): Promise<void> {
    await this.#ctx.storage.setAlarm(Date.now() + this.#refreshIntervalMs);
  }
}

function createSandboxRuntime(input: {
  namespace: DurableObjectNamespace<SandboxDO>;
  sleepAfter: () => string;
}): WarmPoolRuntime {
  return {
    async startContainer(containerId) {
      await getSandbox(input.namespace, containerId, { sleepAfter: input.sleepAfter() }).exec("true");
    },
    async destroyContainer(containerId) {
      await getSandbox(input.namespace, containerId, { sleepAfter: input.sleepAfter() }).destroy();
    },
    async isContainerRunning(containerId) {
      try {
        const state = await sandboxState(input.namespace, containerId).getState();
        return state.status === "running" || state.status === "healthy";
      } catch {
        return false;
      }
    },
    async keepContainerAlive(containerId) {
      await sandboxState(input.namespace, containerId).renewActivityTimeout?.();
    },
  };
}

function warmPoolHandle(namespace: SandboxWarmPoolNamespace): SandboxWarmPoolHandle {
  return namespace.getByName(POOL_NAME) as unknown as SandboxWarmPoolHandle;
}

function sandboxState(namespace: DurableObjectNamespace<SandboxDO>, id: string): {
  getState(): Promise<{ status: "running" | "stopping" | "stopped" | "healthy" | "stopped_with_code" }>;
  renewActivityTimeout?: () => void | Promise<void>;
} {
  return namespace.get(namespace.idFromName(id)) as unknown as {
    getState(): Promise<{ status: "running" | "stopping" | "stopped" | "healthy" | "stopped_with_code" }>;
    renewActivityTimeout?: () => void | Promise<void>;
  };
}
