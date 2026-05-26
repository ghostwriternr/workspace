import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import { InvalidPathError } from "../src/workspace/model/errors";
import { parseWorkspacePath } from "../src/workspace/model/path";
import { toRpcResult } from "../src/workspace/model/rpc";

describe("Workspace internal domain errors", () => {
  it("uses better-result tagged errors internally", () => {
    const result = parseWorkspacePath("relative.txt", { allowRoot: false });

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(InvalidPathError.is(result.error)).toBe(true);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.reason).toBe("must_be_absolute");
    }
  });

  it("serializes internal Results at the Durable Object RPC boundary", () => {
    const result = Result.err(
      new InvalidPathError({ path: "relative.txt", reason: "must_be_absolute" }),
    );

    expect(toRpcResult(result)).toMatchObject({
      status: "error",
      error: {
        tag: "InvalidPathError",
        path: "relative.txt",
        reason: "must_be_absolute",
      },
    });
  });
});
