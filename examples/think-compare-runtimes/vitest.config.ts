import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "shared/**/*.test.ts",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "worker/**/*.test.ts",
      "test/**/*.test.ts",
    ],
  },
});
