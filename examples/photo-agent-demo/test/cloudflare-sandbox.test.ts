import { describe, expect, it, vi } from "vitest";

const getSandbox = vi.fn((_sandboxes: unknown, id: string, options: unknown) => ({ id, options }));

vi.mock("@cloudflare/sandbox", () => ({ getSandbox }));

const { createSandboxForDraft } = await import("../src/workspace/cloudflare-sandbox");

describe("createSandboxForDraft", () => {
  it("uses a short-lived sandbox scoped to the draft edit", () => {
    const sandboxForDraft = createSandboxForDraft({} as never, "manual-demo");

    const sandbox = sandboxForDraft("draft-123");

    expect(sandbox).toEqual({ id: "manual-demo-draft-123", options: { sleepAfter: "10m" } });
    expect(getSandbox).toHaveBeenCalledWith({}, "manual-demo-draft-123", { sleepAfter: "10m" });
  });
});
