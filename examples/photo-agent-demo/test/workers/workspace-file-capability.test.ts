import { env, exports } from "cloudflare:workers";
import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import { Workspace } from "@cloudflare/workspace";

const photoBytes = new TextEncoder().encode("photo");

describe("WorkspaceFileCapability", () => {
  it("adapts a photo draft into a scoped WorkerEntrypoint binding", async () => {
    const workspaceName = `photo-workspace-file-capability-${crypto.randomUUID()}`;
    const workspace = Workspace.get(env.WORKSPACES, workspaceName);
    const copy = await workspace.files.copy("photo-draft");
    if (Result.isError(copy)) throw new Error("copy failed");
    await copy.value.files.mkdir("/photos");
    await copy.value.files.write("/photos/current", photoBytes);

    const capability = exports.WorkspaceFileCapability({
      props: { workspaceName, draftEditId: copy.value.id },
    });

    await expect(capability.readFile("/photos/current")).resolves.toEqual({ status: "ok", value: photoBytes });
    await expect(capability.stat("/photos/current")).resolves.toMatchObject({
      status: "ok",
      value: {
        path: "/photos/current",
        type: "file",
        size: photoBytes.byteLength,
      },
    });
    await expect(capability.readFile("/outside.txt")).resolves.toMatchObject({
      status: "error",
      error: { tag: "ScopedWorkspaceAccessError" },
    });
  });
});
