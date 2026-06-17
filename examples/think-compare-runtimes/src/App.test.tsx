import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { App } from "./App";

describe("App", () => {
  test("renders the fixed task and both runtime wings", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("Think Runtime Comparison");
    expect(html).toContain("Document Smart Request Policies");
    expect(html).toContain("Workspace-backed");
    expect(html).toContain("@cloudflare/workspace + Dynamic Workers + Sandbox SDK");
    expect(html).toContain("Raw Sandbox");
    expect(html).toContain("@cloudflare/sandbox");
  });
});
