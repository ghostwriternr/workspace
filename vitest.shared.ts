export const nodeProjectTestConfig = {
  name: "node",
  environment: "node" as const,
  include: ["test/*.test.ts"],
};

export const workersProjectTestConfig = {
  name: "workers",
  include: ["test/workers/*.test.ts"],
};
