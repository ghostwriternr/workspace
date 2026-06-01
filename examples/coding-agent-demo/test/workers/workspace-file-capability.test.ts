import { env, exports } from "cloudflare:workers";
import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import { Workspace } from "@cloudflare/workspace";

const readmeBytes = new TextEncoder().encode("# Repo");

describe("WorkspaceFileCapability", () => {
  it("adapts an edit copy into a scoped WorkerEntrypoint binding", async () => {
    const workspaceName = `workspace-file-capability-${crypto.randomUUID()}`;
    const workspace = Workspace.get(env.WORKSPACES, workspaceName);
    const copy = await workspace.files.copy("edit");
    if (Result.isError(copy)) throw new Error("copy failed");
    await copy.value.files.write("/README.md", readmeBytes);

    const capability = exports.WorkspaceFileCapability({
      props: { workspaceName, editCopyId: copy.value.id },
    });

    await expect(capability.readFile("/README.md")).resolves.toEqual({ status: "ok", value: readmeBytes });
    await expect(capability.stat("/README.md")).resolves.toMatchObject({
      status: "ok",
      value: {
        path: "/README.md",
        type: "file",
        size: readmeBytes.byteLength,
      },
    });
    await expect(capability.readFile("/missing.md")).resolves.toMatchObject({
      status: "error",
      error: { tag: "PathNotFoundError" },
    });
  });
});
