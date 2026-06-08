import { Result } from "better-result";
import { afterEach, describe, expect, it } from "vitest";
import { Workspace } from "../src";
import {
  resetArtifactsWorkspaceDriverFactoryForTests,
  setArtifactsWorkspaceDriverFactoryForTests,
} from "../src/workspace/artifacts/workspace-backend-client";
import { FakeArtifactsBinding, FakeArtifactsWorkspaceDriver } from "./fake-artifacts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function text(value: Uint8Array): string {
  return decoder.decode(value);
}

describe("Artifacts-backed Workspace product API", () => {
  afterEach(() => resetArtifactsWorkspaceDriverFactoryForTests());

  it("constructs with the default internal Git driver", () => {
    const workspace = Workspace.fromArtifacts(new FakeArtifactsBinding(new FakeArtifactsWorkspaceDriver({})), "repo");

    expect(workspace.files).toBeDefined();
  });

  it("uses Artifacts forks as isolated working copies", async () => {
    const driver = new FakeArtifactsWorkspaceDriver({ repo: { "/README.md": bytes("# Current") } });
    const artifacts = new FakeArtifactsBinding(driver);
    setArtifactsWorkspaceDriverFactoryForTests(() => driver);

    const workspace = Workspace.fromArtifacts(artifacts, "repo");
    const copy = await workspace.files.copy("agent-work");
    expect(Result.isOk(copy)).toBe(true);
    if (Result.isError(copy)) throw new Error("copy failed");

    const write = await copy.value.files.writeTree("/", [
      { path: "README.md", contents: bytes("# Edited") },
      { path: "src/index.ts", contents: bytes("export const ok = true;\n") },
    ]);
    const currentBeforeApply = await workspace.files.read("/README.md");
    const apply = await copy.value.apply();
    const currentAfterApply = await workspace.files.read("/README.md");
    const newFileAfterApply = await workspace.files.read("/src/index.ts");

    expect(Result.isOk(write)).toBe(true);
    expect(Result.isOk(currentBeforeApply)).toBe(true);
    if (Result.isOk(currentBeforeApply)) expect(text(currentBeforeApply.value)).toBe("# Current");
    expect(Result.isOk(apply)).toBe(true);
    expect(Result.isOk(currentAfterApply)).toBe(true);
    expect(Result.isOk(newFileAfterApply)).toBe(true);
    if (Result.isOk(currentAfterApply)) expect(text(currentAfterApply.value)).toBe("# Edited");
    if (Result.isOk(newFileAfterApply)) expect(text(newFileAfterApply.value)).toBe("export const ok = true;\n");
    expect(artifacts.deletedRepositories).toEqual([copy.value.id]);
  });
});
