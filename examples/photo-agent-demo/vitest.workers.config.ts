import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineProject } from "vitest/config";

import { workersProjectTestConfig } from "../../vitest.shared";

export default defineProject({
  plugins: [
    cloudflareTest({
      main: "./test/worker.ts",
      wrangler: { configPath: "./wrangler.test.jsonc" },
    }),
  ],
  test: workersProjectTestConfig,
});
