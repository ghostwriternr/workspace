import { describe, expect, it } from "vitest";
import { sandboxNameForWorkingCopy } from "../src/workspace/sandbox-id";

describe("sandboxNameForWorkingCopy", () => {
  it("keeps sandbox identifiers within the Sandbox ID limit", () => {
    const name = sandboxNameForWorkingCopy(
      "smoke-1780926054",
      "smoke-1780926054-copy-201d4d95-ad7e-4ce6-bf3c-758ad640ffab",
    );

    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toMatch(/^ws-[a-z0-9]+-[a-z0-9]+$/);
  });
});
