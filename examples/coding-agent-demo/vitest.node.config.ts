import { defineProject } from "vitest/config";

import { nodeProjectTestConfig } from "../../vitest.shared";

export default defineProject({
  test: nodeProjectTestConfig,
});
