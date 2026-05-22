import { matchError } from "better-result";
import { describe, expect, it } from "vitest";
import { MemoryWorkspace } from "../src/core/memory-workspace";
import {
  InvalidPathError,
  IsDirectoryError,
  NotDirectoryError,
  PathNotFoundError,
} from "../src/core/workspace-error";

const textEncoder = new TextEncoder();

function bytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

describe("Workspace errors", () => {
  it("are tagged structured errors", async () => {
    const workspace = new MemoryWorkspace();
    const result = await workspace.readFile("relative.txt");

    expect(result).toMatchObject({
      status: "error",
      error: {
        _tag: "InvalidPathError",
        path: "relative.txt",
        reason: "must_be_absolute",
      },
    });
    if (result.status === "error") {
      expect(InvalidPathError.is(result.error)).toBe(true);
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  it("can be exhaustively matched", async () => {
    const workspace = new MemoryWorkspace();
    await workspace.writeFile("/src/index.ts", bytes("export {};"));

    const errors = [
      await workspace.readFile("relative.txt"),
      await workspace.readFile("/missing.txt"),
      await workspace.readFile("/src"),
      await workspace.list("/src/index.ts"),
    ].flatMap((result) => (result.status === "error" ? [result.error] : []));

    expect(
      errors.map((error) =>
        matchError(error, {
          InvalidPathError: (e) => `invalid:${e.reason}`,
          PathNotFoundError: (e) => `missing:${e.path}`,
          IsDirectoryError: (e) => `directory:${e.path}`,
          NotDirectoryError: (e) => `not-directory:${e.path}`,
        }),
      ),
    ).toEqual([
      "invalid:must_be_absolute",
      "missing:/missing.txt",
      "directory:/src",
      "not-directory:/src/index.ts",
    ]);
  });

  it("provides class guards for each error variant", () => {
    expect(
      InvalidPathError.is(
        new InvalidPathError({ path: "relative", reason: "must_be_absolute" }),
      ),
    ).toBe(true);
    expect(PathNotFoundError.is(new PathNotFoundError({ path: "/missing" }))).toBe(true);
    expect(IsDirectoryError.is(new IsDirectoryError({ path: "/src" }))).toBe(true);
    expect(NotDirectoryError.is(new NotDirectoryError({ path: "/src/index.ts" }))).toBe(true);
  });
});
