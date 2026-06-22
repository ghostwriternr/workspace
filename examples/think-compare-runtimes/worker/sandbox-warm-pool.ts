interface SandboxLease {
  id: string;
}

export interface SandboxWarmPool {
  lease(): Promise<SandboxLease>;
  release(lease: SandboxLease): Promise<void>;
  status(): { size: number; available: number; leased: number };
}

export interface SandboxWarmPoolOptions {
  prefix: string;
  size: number;
}

export function createSandboxWarmPool(options: SandboxWarmPoolOptions): SandboxWarmPool {
  if (!Number.isInteger(options.size) || options.size < 1) {
    throw new Error("Warm pool size must be a positive integer");
  }

  const available = Array.from({ length: options.size }, (_, index) => `${options.prefix}-${index}`);
  const leased = new Set<string>();

  return {
    async lease() {
      const id = available.shift();
      if (!id) throw new Error(`No warm sandboxes available for ${options.prefix}`);
      leased.add(id);
      return { id };
    },

    async release(lease) {
      if (!leased.delete(lease.id)) return;
      available.unshift(lease.id);
    },

    status() {
      return { size: options.size, available: available.length, leased: leased.size };
    },
  };
}
