import { describe, expect, test } from "vitest";

import { compareFixture, fixtureFileEntries, fixtureManifest } from "./fixture";

describe("compareFixture", () => {
  test("defines one fixed docs task with files for validation", () => {
    expect(compareFixture.projectRoot).toBe("/workspace");
    expect(compareFixture.task.title).toBe("Document Smart Request Policies");
    expect(compareFixture.task.acceptanceCriteria).toContain("Create docs/smart-request-policies.md");

    const paths = fixtureFileEntries().map((entry) => entry.path).sort();

    expect(paths).toEqual([
      "/README.md",
      "/docs/examples/basic-worker.ts",
      "/docs/feature-brief.md",
      "/docs/style-guide.md",
      "/package.json",
      "/site/navigation.json",
    ]);
    expect(fixtureManifest()).toContain("docs/feature-brief.md");
    expect(fixtureManifest()).toContain("npm run check");
  });
});
