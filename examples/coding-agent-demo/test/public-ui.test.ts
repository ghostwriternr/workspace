import { describe, expect, it } from "vitest";

import { UI_COPY } from "../src/client/ui-copy";

describe("coding demo browser UI copy", () => {
  it("describes import, chat, and passive Workspace state", () => {
    expect(UI_COPY.title).toBe("Workspace Coding Agent Demo");
    expect(UI_COPY.importLabel).toBe("GitHub repository");
    expect(UI_COPY.importPlaceholder).toBe("owner/repo");
    expect(UI_COPY.importAction).toBe("Import repo");
    expect(UI_COPY.filesTitle).toBe("Workspace files");
    expect(UI_COPY.activeWorkingCopyLabel).toBe("Active working copy");
    expect(UI_COPY.applyWorkingCopyAction).toBe("Apply working copy");
    expect(UI_COPY.discardWorkingCopyAction).toBe("Discard working copy");
    expect(UI_COPY.chatTitle).toBe("Coding agent");
    expect(UI_COPY.chatPlaceholder).toBe("Ask the agent to inspect or edit this repo…");
  });
});
