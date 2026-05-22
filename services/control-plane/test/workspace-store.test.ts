import { describe, expect, it } from "vitest";
import { MemoryWorkspace } from "../src/core/memory-workspace";
import type { WorkspaceStore } from "../src/core/workspace-store";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function text(value: Uint8Array): string {
  return textDecoder.decode(value);
}

async function writeAndRead(store: WorkspaceStore): Promise<string> {
  await store.writeFile("/message.txt", bytes("hello"));
  return text(await store.readFile("/message.txt"));
}

describe("WorkspaceStore", () => {
  it("allows callers to depend on the storage contract instead of MemoryWorkspace", async () => {
    await expect(writeAndRead(new MemoryWorkspace())).resolves.toBe("hello");
  });
});
