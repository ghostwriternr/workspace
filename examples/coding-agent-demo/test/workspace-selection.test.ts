import { describe, expect, it } from "vitest";

import { activateDraftWorkspaceName, updateDraftWorkspaceName } from "../src/client/workspace-selection";

describe("workspace selection", () => {
  it("keeps typing separate from the active workspace", () => {
    const selection = updateDraftWorkspaceName({
      activeWorkspaceName: "coding-demo",
      draftWorkspaceName: "coding-demo",
    }, "coding-demoo");

    expect(selection).toEqual({
      activeWorkspaceName: "coding-demo",
      draftWorkspaceName: "coding-demoo",
    });
  });

  it("activates the trimmed draft workspace name explicitly", () => {
    const result = activateDraftWorkspaceName({
      activeWorkspaceName: "coding-demo",
      draftWorkspaceName: "  coding-demoo  ",
    });

    expect(result).toEqual({
      status: "ok",
      value: {
        activeWorkspaceName: "coding-demoo",
        draftWorkspaceName: "coding-demoo",
      },
    });
  });

  it("rejects an empty draft workspace name", () => {
    const result = activateDraftWorkspaceName({
      activeWorkspaceName: "coding-demo",
      draftWorkspaceName: "   ",
    });

    expect(result).toEqual({
      status: "error",
      message: "Workspace name is required.",
    });
  });
});
