import { describe, expect, test } from "vitest";

import { runtimeSystemPrompt, runtimeTaskPrompt } from "./prompts";

describe("runtime prompts", () => {
  test("tells Kimi to act with tools instead of drafting long plans", () => {
    const prompt = runtimeSystemPrompt("sandbox");

    expect(prompt).toContain("Use tools immediately");
    expect(prompt).toContain("Keep reasoning brief");
  });

  test("orders the fixed task so validation happens after required edits", () => {
    const prompt = runtimeTaskPrompt();

    expect(prompt).toContain("Do not run npm run check until after");
    expect(prompt).toContain("docs/smart-request-policies.md");
    expect(prompt).toContain("site/navigation.json");
    expect(prompt).toContain("README.md");
  });
});
