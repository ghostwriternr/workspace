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

  it("snapshots immutable revisions that list point-in-time trees", async () => {
    const workspace = env.WORKSPACES.getByName("snapshot-list-revisions");

    await workspace.writeFile("/a.txt", bytes("a"));
    const firstSnapshot = await workspace.snapshot();
    expect(firstSnapshot.status).toBe("ok");
    if (firstSnapshot.status !== "ok") {
      throw new Error("snapshot failed");
    }

    await workspace.writeFile("/b.txt", bytes("b"));
    const secondSnapshot = await workspace.snapshot();
    expect(secondSnapshot.status).toBe("ok");
    if (secondSnapshot.status !== "ok") {
      throw new Error("snapshot failed");
    }

    await expect(workspace.list("/", { revisionId: firstSnapshot.value.revisionId })).resolves.toEqual({
      status: "ok",
      value: [{ name: "a.txt", path: "/a.txt", type: "file" }],
    });
    await expect(workspace.list("/", { revisionId: secondSnapshot.value.revisionId })).resolves.toEqual({
      status: "ok",
      value: [
        { name: "a.txt", path: "/a.txt", type: "file" },
        { name: "b.txt", path: "/b.txt", type: "file" },
      ],
    });
  });

  it("reads and stats revision entries independently from the mutable head", async () => {
    const workspace = env.WORKSPACES.getByName("snapshot-read-stat-revisions");

    await workspace.writeFile("/README.md", bytes("one"));
    const firstSnapshot = await workspace.snapshot();
    expect(firstSnapshot.status).toBe("ok");
    if (firstSnapshot.status !== "ok") {
      throw new Error("snapshot failed");
    }

    await workspace.writeFile("/README.md", bytes("longer"));

    const revisionRead = await workspace.readFile("/README.md", {
      revisionId: firstSnapshot.value.revisionId,
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

    await expect(workspace.stat("/README.md", { revisionId: firstSnapshot.value.revisionId })).resolves.toMatchObject({
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

    const sessionId = await beginSession(workspace);
    await expect(workspace.sessionMkdir(sessionId, "/src")).resolves.toEqual({ status: "ok" });
    await expect(workspace.sessionWriteFile(sessionId, "/src/index.ts", bytes("export {};"))).resolves.toEqual({
      status: "ok",
    });

    await expect(workspace.stat("/src")).resolves.toMatchObject({
      status: "error",
      error: { tag: "PathNotFoundError", path: "/src" },
    });

    const sessionRead = await workspace.sessionReadFile(sessionId, "/src/index.ts");
    expect(sessionRead.status).toBe("ok");
    if (sessionRead.status === "ok") {
      expect(text(sessionRead.value)).toBe("export {};");
    }
  });

  it("commits session edits to head and creates a readable revision", async () => {
    const workspace = env.WORKSPACES.getByName("session-commit");

    await workspace.writeFile("/README.md", bytes("head"));
    const sessionId = await beginSession(workspace);
    await workspace.sessionWriteFile(sessionId, "/README.md", bytes("session"));

    const commit = await workspace.sessionCommit(sessionId);
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

    await expect(workspace.sessionStat(sessionId, "/README.md")).resolves.toMatchObject({
      status: "error",
      error: { tag: "SessionNotFoundError" },
    });
  });

  it("discards session edits without changing head", async () => {
    const workspace = env.WORKSPACES.getByName("session-discard");

    await workspace.writeFile("/README.md", bytes("head"));
    const sessionId = await beginSession(workspace);
    await workspace.sessionWriteFile(sessionId, "/README.md", bytes("session"));

    await expect(workspace.sessionDiscard(sessionId)).resolves.toEqual({ status: "ok" });

    const headRead = await workspace.readFile("/README.md");
    expect(headRead.status).toBe("ok");
    if (headRead.status === "ok") {
      expect(text(headRead.value)).toBe("head");
    }
    await expect(workspace.sessionReadFile(sessionId, "/README.md")).resolves.toMatchObject({
      status: "error",
      error: { tag: "SessionNotFoundError" },
    });
  });

  it("uses explicit directory semantics inside sessions", async () => {
    const workspace = env.WORKSPACES.getByName("session-explicit-directories");
    const sessionId = await beginSession(workspace);

    await expect(workspace.sessionWriteFile(sessionId, "/src/index.ts", bytes("export {};"))).resolves.toMatchObject({
      status: "error",
      error: { tag: "PathNotFoundError", path: "/src" },
    });

    await expect(workspace.sessionMkdir(sessionId, "/src")).resolves.toEqual({ status: "ok" });
    await expect(workspace.sessionWriteFile(sessionId, "/src/index.ts", bytes("export {};"))).resolves.toEqual({
      status: "ok",
    });
    await expect(workspace.sessionDelete(sessionId, "/src")).resolves.toMatchObject({
      status: "error",
      error: { tag: "DirectoryNotEmptyError", path: "/src" },
    });
  });

  it("can look up open sessions by durable session id", async () => {
    const workspace = env.WORKSPACES.getByName("session-lookup");

    const sessionId = await beginSession(workspace);
    await workspace.sessionWriteFile(sessionId, "/README.md", bytes("session"));

    const lookup = await workspace.getSession(sessionId);
    expect(lookup.status).toBe("ok");
    if (lookup.status !== "ok") {
      throw new Error("session lookup failed");
    }
    expect(lookup.value.sessionId).toBe(sessionId);

    const lookedUpRead = await workspace.sessionReadFile(lookup.value.sessionId, "/README.md");
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
    const first = await beginSession(workspace);
    const second = await beginSession(workspace);

    await workspace.sessionWriteFile(first, "/README.md", bytes("first"));
    await workspace.sessionWriteFile(second, "/README.md", bytes("second"));

    const firstRead = await workspace.sessionReadFile(first, "/README.md");
    const secondRead = await workspace.sessionReadFile(second, "/README.md");
    expect(firstRead.status).toBe("ok");
    expect(secondRead.status).toBe("ok");
    if (firstRead.status === "ok") {
      expect(text(firstRead.value)).toBe("first");
    }
    if (secondRead.status === "ok") {
      expect(text(secondRead.value)).toBe("second");
    }

    await workspace.sessionCommit(first);

    const secondAfterCommit = await workspace.sessionReadFile(second, "/README.md");
    expect(secondAfterCommit.status).toBe("ok");
    if (secondAfterCommit.status === "ok") {
      expect(text(secondAfterCommit.value)).toBe("second");
    }
    await expect(workspace.sessionDiscard(second)).resolves.toEqual({ status: "ok" });
  });

  it("allows sessions to commit after head snapshots", async () => {
    const workspace = env.WORKSPACES.getByName("session-after-head-snapshot");

    await workspace.writeFile("/README.md", bytes("base"));
    const sessionId = await beginSession(workspace);
    await workspace.sessionWriteFile(sessionId, "/README.md", bytes("session"));
    await workspace.snapshot();

    await expect(workspace.sessionCommit(sessionId)).resolves.toMatchObject({ status: "ok" });

    const headRead = await workspace.readFile("/README.md");
    expect(headRead.status).toBe("ok");
    if (headRead.status === "ok") {
      expect(text(headRead.value)).toBe("session");
    }
  });

  it("rejects session commits when head changed after the session began", async () => {
    const workspace = env.WORKSPACES.getByName("session-head-conflict");

    await workspace.writeFile("/README.md", bytes("base"));
    const sessionId = await beginSession(workspace);
    await workspace.sessionWriteFile(sessionId, "/README.md", bytes("session"));

    await workspace.writeFile("/README.md", bytes("head"));

    await expect(workspace.sessionCommit(sessionId)).resolves.toMatchObject({
      status: "error",
      error: { tag: "SessionConflictError" },
    });
    await expect(workspace.sessionCommit(sessionId)).resolves.toMatchObject({
      status: "error",
      error: { tag: "SessionConflictError" },
    });

    const headRead = await workspace.readFile("/README.md");
    expect(headRead.status).toBe("ok");
    if (headRead.status === "ok") {
      expect(text(headRead.value)).toBe("head");
    }

    const sessionRead = await workspace.sessionReadFile(sessionId, "/README.md");
    expect(sessionRead.status).toBe("ok");
    if (sessionRead.status === "ok") {
      expect(text(sessionRead.value)).toBe("session");
    }

    await expect(workspace.sessionDiscard(sessionId)).resolves.toEqual({ status: "ok" });
  });

  it("rejects later concurrent session commits without closing the conflicted session", async () => {
    const workspace = env.WORKSPACES.getByName("session-session-conflict");

    await workspace.writeFile("/README.md", bytes("base"));
    const first = await beginSession(workspace);
    const second = await beginSession(workspace);

    await workspace.sessionWriteFile(first, "/README.md", bytes("first"));
    await workspace.sessionWriteFile(second, "/README.md", bytes("second"));

    await expect(workspace.sessionCommit(first)).resolves.toMatchObject({ status: "ok" });
    await expect(workspace.sessionCommit(second)).resolves.toMatchObject({
      status: "error",
      error: { tag: "SessionConflictError" },
    });

    const secondRead = await workspace.sessionReadFile(second, "/README.md");
    expect(secondRead.status).toBe("ok");
    if (secondRead.status === "ok") {
      expect(text(secondRead.value)).toBe("second");
    }
    await expect(workspace.sessionDiscard(second)).resolves.toEqual({ status: "ok" });
  });

  it("rejects operations on terminal sessions", async () => {
    const workspace = env.WORKSPACES.getByName("terminal-sessions");

    const committed = await beginSession(workspace);
    await workspace.sessionCommit(committed);
    await expect(workspace.sessionCommit(committed)).resolves.toMatchObject({
      status: "error",
      error: { tag: "SessionNotFoundError" },
    });
    await expect(workspace.sessionDiscard(committed)).resolves.toMatchObject({
      status: "error",
      error: { tag: "SessionNotFoundError" },
    });

    const discarded = await beginSession(workspace);
    await workspace.sessionDiscard(discarded);
    await expect(workspace.sessionDiscard(discarded)).resolves.toMatchObject({
      status: "error",
      error: { tag: "SessionNotFoundError" },
    });
  });
});

async function beginSession(workspace: ReturnType<typeof env.WORKSPACES.getByName>): Promise<string> {
  const session = await workspace.beginSession();
  expect(session.status).toBe("ok");
  if (session.status !== "ok") {
    throw new Error("session begin failed");
  }
  return session.value.sessionId;
}
