import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function text(value: Uint8Array): string {
  return textDecoder.decode(value);
}

describe("WorkspaceObject", () => {
  it("persists file bytes through Durable Object metadata and R2 blobs", async () => {
    const workspace = env.WORKSPACES.getByName("write-read");

    const write = await workspace.writeFile("/hello.txt", bytes("hello"));
    const read = await workspace.readFile("/hello.txt");

    expect(write).toEqual({ status: "ok" });
    expect(read.status).toBe("ok");
    if (read.status === "ok") {
      expect(text(read.value)).toBe("hello");
    }
  });

  it("creates explicit directories that can be listed and statted", async () => {
    const workspace = env.WORKSPACES.getByName("explicit-directories");

    await expect(workspace.mkdir("/src")).resolves.toEqual({ status: "ok" });
    await expect(workspace.list("/")).resolves.toEqual({
      status: "ok",
      value: [{ name: "src", path: "/src", type: "directory" }],
    });
    await expect(workspace.stat("/src")).resolves.toMatchObject({
      status: "ok",
      value: {
        path: "/src",
        type: "directory",
        size: null,
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
      },
    });
  });

  it("requires parent directories to exist before writing nested files", async () => {
    const workspace = env.WORKSPACES.getByName("parent-required");

    await expect(workspace.writeFile("/src/index.ts", bytes("export {};"))).resolves.toMatchObject({
      status: "error",
      error: { tag: "PathNotFoundError", path: "/src" },
    });

    await workspace.mkdir("/src");
    await expect(workspace.writeFile("/src/index.ts", bytes("export {};"))).resolves.toEqual({
      status: "ok",
    });
  });

  it("lists immediate children from Durable Object metadata", async () => {
    const workspace = env.WORKSPACES.getByName("list-children");

    await workspace.mkdir("/src");
    await workspace.writeFile("/src/index.ts", bytes("export {};"));
    await workspace.writeFile("/README.md", bytes("# Workspace"));

    await expect(workspace.list("/")).resolves.toEqual({
      status: "ok",
      value: [
        { name: "README.md", path: "/README.md", type: "file" },
        { name: "src", path: "/src", type: "directory" },
      ],
    });
    await expect(workspace.list("/src")).resolves.toEqual({
      status: "ok",
      value: [{ name: "index.ts", path: "/src/index.ts", type: "file" }],
    });
  });

  it("stats files with durable metadata", async () => {
    const workspace = env.WORKSPACES.getByName("stat-file");

    await workspace.writeFile("/README.md", bytes("# Workspace"));

    await expect(workspace.stat("/README.md")).resolves.toMatchObject({
      status: "ok",
      value: {
        path: "/README.md",
        type: "file",
        size: 11,
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
      },
    });
  });

  it("deletes files without pruning explicit parent directories", async () => {
    const workspace = env.WORKSPACES.getByName("delete-file");

    await workspace.mkdir("/src");
    await workspace.writeFile("/src/index.ts", bytes("export {};"));

    await expect(workspace.delete("/src/index.ts")).resolves.toEqual({ status: "ok" });
    await expect(workspace.readFile("/src/index.ts")).resolves.toMatchObject({
      status: "error",
      error: { tag: "PathNotFoundError", path: "/src/index.ts" },
    });
    await expect(workspace.list("/")).resolves.toEqual({
      status: "ok",
      value: [{ name: "src", path: "/src", type: "directory" }],
    });
  });

  it("deletes empty directories and rejects non-empty directory deletes", async () => {
    const workspace = env.WORKSPACES.getByName("delete-directories");

    await workspace.mkdir("/src");
    await workspace.writeFile("/src/index.ts", bytes("export {};"));

    await expect(workspace.delete("/src")).resolves.toMatchObject({
      status: "error",
      error: { tag: "DirectoryNotEmptyError", path: "/src" },
    });

    await workspace.delete("/src/index.ts");
    await expect(workspace.delete("/src")).resolves.toEqual({ status: "ok" });
    await expect(workspace.stat("/src")).resolves.toMatchObject({
      status: "error",
      error: { tag: "PathNotFoundError", path: "/src" },
    });
  });

  it("returns serializable errors for invalid workspace paths", async () => {
    const workspace = env.WORKSPACES.getByName("invalid-paths");

    await expect(workspace.writeFile("relative.txt", bytes("no"))).resolves.toMatchObject({
      status: "error",
      error: { tag: "InvalidPathError", path: "relative.txt", reason: "must_be_absolute" },
    });
    await expect(workspace.mkdir("/src//nested")).resolves.toMatchObject({
      status: "error",
      error: { tag: "InvalidPathError", path: "/src//nested", reason: "empty_segment" },
    });
    await expect(workspace.stat("/../secret.txt")).resolves.toMatchObject({
      status: "error",
      error: { tag: "InvalidPathError", path: "/../secret.txt", reason: "traversal_segment" },
    });
  });

  it("does not allow file paths to act as directories", async () => {
    const workspace = env.WORKSPACES.getByName("file-directory-mismatch");

    await workspace.writeFile("/src", bytes("not a directory"));

    await expect(workspace.mkdir("/src/nested")).resolves.toMatchObject({
      status: "error",
      error: { tag: "NotDirectoryError", path: "/src" },
    });
    await expect(workspace.writeFile("/src/index.ts", bytes("export {};"))).resolves.toMatchObject({
      status: "error",
      error: { tag: "NotDirectoryError", path: "/src" },
    });
    await expect(workspace.list("/src")).resolves.toMatchObject({
      status: "error",
      error: { tag: "NotDirectoryError", path: "/src" },
    });
  });

  it("does not let mkdir replace existing entries", async () => {
    const workspace = env.WORKSPACES.getByName("mkdir-existing-entry");

    await workspace.mkdir("/src");
    await workspace.writeFile("/README.md", bytes("# Workspace"));

    await expect(workspace.mkdir("/src")).resolves.toMatchObject({
      status: "error",
      error: { tag: "PathAlreadyExistsError", path: "/src" },
    });
    await expect(workspace.mkdir("/README.md")).resolves.toMatchObject({
      status: "error",
      error: { tag: "PathAlreadyExistsError", path: "/README.md" },
    });
  });

  it("commits immutable revisions that list point-in-time trees", async () => {
    const workspace = env.WORKSPACES.getByName("commit-list-revisions");

    await workspace.writeFile("/a.txt", bytes("a"));
    const firstCommit = await workspace.commit();
    expect(firstCommit.status).toBe("ok");
    if (firstCommit.status !== "ok") {
      throw new Error("commit failed");
    }

    await workspace.writeFile("/b.txt", bytes("b"));
    const secondCommit = await workspace.commit();
    expect(secondCommit.status).toBe("ok");
    if (secondCommit.status !== "ok") {
      throw new Error("commit failed");
    }

    await expect(workspace.list("/", { revisionId: firstCommit.value.revisionId })).resolves.toEqual({
      status: "ok",
      value: [{ name: "a.txt", path: "/a.txt", type: "file" }],
    });
    await expect(workspace.list("/", { revisionId: secondCommit.value.revisionId })).resolves.toEqual({
      status: "ok",
      value: [
        { name: "a.txt", path: "/a.txt", type: "file" },
        { name: "b.txt", path: "/b.txt", type: "file" },
      ],
    });
  });

  it("reads and stats revision entries independently from the mutable head", async () => {
    const workspace = env.WORKSPACES.getByName("commit-read-stat-revisions");

    await workspace.writeFile("/README.md", bytes("one"));
    const firstCommit = await workspace.commit();
    expect(firstCommit.status).toBe("ok");
    if (firstCommit.status !== "ok") {
      throw new Error("commit failed");
    }

    await workspace.writeFile("/README.md", bytes("longer"));

    const revisionRead = await workspace.readFile("/README.md", {
      revisionId: firstCommit.value.revisionId,
    });
    expect(revisionRead.status).toBe("ok");
    if (revisionRead.status === "ok") {
      expect(text(revisionRead.value)).toBe("one");
    }

    const headRead = await workspace.readFile("/README.md");
    expect(headRead.status).toBe("ok");
    if (headRead.status === "ok") {
      expect(text(headRead.value)).toBe("longer");
    }

    await expect(workspace.stat("/README.md", { revisionId: firstCommit.value.revisionId })).resolves.toMatchObject({
      status: "ok",
      value: {
        path: "/README.md",
        type: "file",
        size: 3,
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
      },
    });
    await expect(workspace.stat("/README.md")).resolves.toMatchObject({
      status: "ok",
      value: {
        path: "/README.md",
        type: "file",
        size: 6,
      },
    });
  });

  it("returns a serializable error for unknown revisions", async () => {
    const workspace = env.WORKSPACES.getByName("missing-revision");

    await expect(workspace.list("/", { revisionId: "missing" })).resolves.toMatchObject({
      status: "error",
      error: { tag: "RevisionNotFoundError", revisionId: "missing" },
    });
    await expect(workspace.stat("/README.md", { revisionId: "missing" })).resolves.toMatchObject({
      status: "error",
      error: { tag: "RevisionNotFoundError", revisionId: "missing" },
    });
    await expect(workspace.readFile("/README.md", { revisionId: "missing" })).resolves.toMatchObject({
      status: "error",
      error: { tag: "RevisionNotFoundError", revisionId: "missing" },
    });
  });

  it("keeps session edits isolated from the mutable head", async () => {
    const workspace = env.WORKSPACES.getByName("session-isolation");

    const session = await workspace.beginSession();
    await expect(session.mkdir("/src")).resolves.toEqual({ status: "ok" });
    await expect(session.writeFile("/src/index.ts", bytes("export {};"))).resolves.toEqual({
      status: "ok",
    });

    await expect(workspace.stat("/src")).resolves.toMatchObject({
      status: "error",
      error: { tag: "PathNotFoundError", path: "/src" },
    });

    const sessionRead = await session.readFile("/src/index.ts");
    expect(sessionRead.status).toBe("ok");
    if (sessionRead.status === "ok") {
      expect(text(sessionRead.value)).toBe("export {};");
    }
  });

  it("commits session edits to head and creates a readable revision", async () => {
    const workspace = env.WORKSPACES.getByName("session-commit");

    await workspace.writeFile("/README.md", bytes("head"));
    const session = await workspace.beginSession();
    await session.writeFile("/README.md", bytes("session"));

    const commit = await session.commit();
    expect(commit.status).toBe("ok");
    if (commit.status !== "ok") {
      throw new Error("commit failed");
    }

    const headRead = await workspace.readFile("/README.md");
    expect(headRead.status).toBe("ok");
    if (headRead.status === "ok") {
      expect(text(headRead.value)).toBe("session");
    }

    const revisionRead = await workspace.readFile("/README.md", {
      revisionId: commit.value.revisionId,
    });
    expect(revisionRead.status).toBe("ok");
    if (revisionRead.status === "ok") {
      expect(text(revisionRead.value)).toBe("session");
    }

    await expect(session.stat("/README.md")).resolves.toMatchObject({
      status: "error",
      error: { tag: "SessionNotFoundError" },
    });
  });

  it("discards session edits without changing head", async () => {
    const workspace = env.WORKSPACES.getByName("session-discard");

    await workspace.writeFile("/README.md", bytes("head"));
    const session = await workspace.beginSession();
    await session.writeFile("/README.md", bytes("session"));

    await expect(session.discard()).resolves.toEqual({ status: "ok" });

    const headRead = await workspace.readFile("/README.md");
    expect(headRead.status).toBe("ok");
    if (headRead.status === "ok") {
      expect(text(headRead.value)).toBe("head");
    }
    await expect(session.readFile("/README.md")).resolves.toMatchObject({
      status: "error",
      error: { tag: "SessionNotFoundError" },
    });
  });

  it("uses explicit directory semantics inside sessions", async () => {
    const workspace = env.WORKSPACES.getByName("session-explicit-directories");
    const session = await workspace.beginSession();

    await expect(session.writeFile("/src/index.ts", bytes("export {};"))).resolves.toMatchObject({
      status: "error",
      error: { tag: "PathNotFoundError", path: "/src" },
    });

    await expect(session.mkdir("/src")).resolves.toEqual({ status: "ok" });
    await expect(session.writeFile("/src/index.ts", bytes("export {};"))).resolves.toEqual({
      status: "ok",
    });
    await expect(session.delete("/src")).resolves.toMatchObject({
      status: "error",
      error: { tag: "DirectoryNotEmptyError", path: "/src" },
    });
  });

  it("can look up open sessions by durable session id", async () => {
    const workspace = env.WORKSPACES.getByName("session-lookup");

    const session = await workspace.beginSession();
    const info = await session.info();
    expect(info.status).toBe("ok");
    if (info.status !== "ok") {
      throw new Error("session info failed");
    }

    await session.writeFile("/README.md", bytes("session"));

    const lookup = await workspace.getSession(info.value.sessionId);
    expect(lookup.status).toBe("ok");
    if (lookup.status !== "ok") {
      throw new Error("session lookup failed");
    }

    const lookedUpRead = await lookup.value.readFile("/README.md");
    expect(lookedUpRead.status).toBe("ok");
    if (lookedUpRead.status === "ok") {
      expect(text(lookedUpRead.value)).toBe("session");
    }

    await expect(workspace.getSession("missing-session")).resolves.toMatchObject({
      status: "error",
      error: { tag: "SessionNotFoundError", sessionId: "missing-session" },
    });
  });

  it("keeps concurrently open sessions isolated from each other", async () => {
    const workspace = env.WORKSPACES.getByName("concurrent-sessions");

    await workspace.writeFile("/README.md", bytes("head"));
    const first = await workspace.beginSession();
    const second = await workspace.beginSession();

    await first.writeFile("/README.md", bytes("first"));
    await second.writeFile("/README.md", bytes("second"));

    const firstRead = await first.readFile("/README.md");
    const secondRead = await second.readFile("/README.md");
    expect(firstRead.status).toBe("ok");
    expect(secondRead.status).toBe("ok");
    if (firstRead.status === "ok") {
      expect(text(firstRead.value)).toBe("first");
    }
    if (secondRead.status === "ok") {
      expect(text(secondRead.value)).toBe("second");
    }

    await first.commit();

    const secondAfterCommit = await second.readFile("/README.md");
    expect(secondAfterCommit.status).toBe("ok");
    if (secondAfterCommit.status === "ok") {
      expect(text(secondAfterCommit.value)).toBe("second");
    }
  });

  it("rejects operations on terminal sessions", async () => {
    const workspace = env.WORKSPACES.getByName("terminal-sessions");

    const committed = await workspace.beginSession();
    await committed.commit();
    await expect(committed.commit()).resolves.toMatchObject({
      status: "error",
      error: { tag: "SessionNotFoundError" },
    });
    await expect(committed.discard()).resolves.toMatchObject({
      status: "error",
      error: { tag: "SessionNotFoundError" },
    });

    const discarded = await workspace.beginSession();
    await discarded.discard();
    await expect(discarded.discard()).resolves.toMatchObject({
      status: "error",
      error: { tag: "SessionNotFoundError" },
    });
  });
});
