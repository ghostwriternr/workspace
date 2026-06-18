export interface WorkspaceComparisonRuntime {
  seedFixture(): Promise<void>;
  read(input: { path: string }): Promise<string>;
  write(input: { path: string; contents: string }): Promise<{ path: string }>;
  edit(input: { path: string; oldText: string; newText: string }): Promise<{ path: string; replacements: number }>;
  run(input: { code: string }): Promise<unknown>;
  shell(input: { command: string }): Promise<unknown>;
}

export interface SandboxComparisonRuntime {
  seedFixture(): Promise<void>;
  read(input: { path: string }): Promise<string>;
  write(input: { path: string; contents: string }): Promise<{ path: string }>;
  edit(input: { path: string; oldText: string; newText: string }): Promise<{ path: string; replacements: number }>;
  shell(input: { command: string }): Promise<unknown>;
}
