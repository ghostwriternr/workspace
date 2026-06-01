import { defineConfig } from "vitest/config";

import { nodeProjectTestConfig } from "../../../vitest.shared";

export default defineConfig({
  test: nodeProjectTestConfig,
});
