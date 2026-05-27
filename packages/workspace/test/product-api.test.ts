import { env } from "cloudflare:workers";
import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import { Workspace } from "../src";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function text(value: Uint8Array): string {
  return textDecoder.decode(value);
}

describe("Workspace product API", () => {
  it("works with current files through Result values instead of RPC DTOs", async () => {
    const workspace = Workspace.get(env.WORKSPACES, "product-current-files");

    const write = await workspace.files.write("/hello.txt", bytes("hello"));
    const read = await workspace.files.read("/hello.txt");

    expect(Result.isError(write)).toBe(false);
    expect(Result.isError(read)).toBe(false);
    if (Result.isOk(read)) {
      expect(text(read.value)).toBe("hello");
    }
  });

  it("applies isolated file copies to current files", async () => {
    const workspace = Workspace.get(env.WORKSPACES, "product-copy-apply");

    await workspace.files.write("/note.txt", bytes("current"));
    const copyResult = await workspace.files.copy("edit-note");

    expect(Result.isError(copyResult)).toBe(false);
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }

    const copy = copyResult.value;
    await copy.files.write("/note.txt", bytes("draft"));

    const currentBeforeApply = await workspace.files.read("/note.txt");
    expect(Result.isOk(currentBeforeApply)).toBe(true);
    if (Result.isOk(currentBeforeApply)) {
      expect(text(currentBeforeApply.value)).toBe("current");
    }

    const apply = await copy.apply();
    expect(Result.isError(apply)).toBe(false);

    const currentAfterApply = await workspace.files.read("/note.txt");
    expect(Result.isOk(currentAfterApply)).toBe(true);
    if (Result.isOk(currentAfterApply)) {
      expect(text(currentAfterApply.value)).toBe("draft");
    }
  });

  it("discards file copies without changing current files", async () => {
    const workspace = Workspace.get(env.WORKSPACES, "product-copy-discard");

    await workspace.files.write("/note.txt", bytes("current"));
    const copyResult = await workspace.files.copy("discard-note");
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }

    await copyResult.value.files.write("/note.txt", bytes("draft"));
    const discard = await copyResult.value.discard();
    expect(Result.isError(discard)).toBe(false);

    const current = await workspace.files.read("/note.txt");
    expect(Result.isOk(current)).toBe(true);
    if (Result.isOk(current)) {
      expect(text(current.value)).toBe("current");
    }
  });

  it("recovers durable file copies by id", async () => {
    const workspace = Workspace.get(env.WORKSPACES, "product-copy-recover");

    await workspace.files.write("/note.txt", bytes("current"));
    const copyResult = await workspace.files.copy("recover-note");
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }

    const recoveredResult = await workspace.files.getCopy(copyResult.value.id);
    expect(Result.isError(recoveredResult)).toBe(false);
    if (Result.isError(recoveredResult)) {
      throw new Error("recover failed");
    }

    await recoveredResult.value.files.write("/note.txt", bytes("recovered draft"));
    await recoveredResult.value.apply();

    const current = await workspace.files.read("/note.txt");
    expect(Result.isOk(current)).toBe(true);
    if (Result.isOk(current)) {
      expect(text(current.value)).toBe("recovered draft");
    }
  });
});
