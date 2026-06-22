import { describe, expect, test } from "vitest";

import { ContainerWarmPoolManager, type WarmPoolRuntime } from "./container-warm-pool-manager";

class MemoryStorage {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
}

describe("ContainerWarmPoolManager", () => {
  test("keeps warm containers and leases them by logical id", async () => {
    const calls: unknown[] = [];
    const running = new Set<string>();
    const runtime: WarmPoolRuntime = {
      async startContainer(id) {
        calls.push(["start", id]);
        running.add(id);
      },
      async destroyContainer(id) {
        calls.push(["destroy", id]);
        running.delete(id);
      },
      async isContainerRunning(id) {
        calls.push(["isRunning", id]);
        return running.has(id);
      },
      async keepContainerAlive(id) {
        calls.push(["keepAlive", id]);
      },
    };
    const ids = ["container-a", "container-b", "container-c"];
    const manager = new ContainerWarmPoolManager({
      storage: new MemoryStorage(),
      runtime,
      target: 2,
      createContainerId: () => ids.shift() ?? "unexpected",
    });

    await manager.refresh();
    expect(await manager.snapshot()).toEqual({
      warm: ["container-a", "container-b"],
      assignments: {},
      releasing: [],
    });

    await expect(manager.getContainer("workspace-run-1")).resolves.toBe("container-a");
    await expect(manager.getContainer("workspace-run-1")).resolves.toBe("container-a");

    await manager.releaseContainer("workspace-run-1");
    expect(await manager.snapshot()).toEqual({
      warm: ["container-b"],
      assignments: {},
      releasing: [],
    });
    expect(calls).toContainEqual(["destroy", "container-a"]);

    await manager.refresh();
    expect(await manager.snapshot()).toMatchObject({
      warm: ["container-b", "container-c"],
      assignments: {},
      releasing: [],
    });
  });

  test("replaces assignments whose containers stopped", async () => {
    const running = new Set(["old", "new"]);
    const manager = new ContainerWarmPoolManager({
      storage: new MemoryStorage(),
      target: 0,
      createContainerId: () => "new",
      runtime: {
        async startContainer(id) {
          running.add(id);
        },
        async destroyContainer(id) {
          running.delete(id);
        },
        async isContainerRunning(id) {
          return running.has(id);
        },
        async keepContainerAlive() {},
      },
    });

    await manager.getContainer("run");
    running.delete("new");

    await expect(manager.getContainer("run")).resolves.toBe("new");
    expect(await manager.snapshot()).toMatchObject({ assignments: { run: "new" } });
  });
});
