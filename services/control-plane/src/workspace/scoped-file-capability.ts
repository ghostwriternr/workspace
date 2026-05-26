import { TaggedError } from "better-result";
import { RpcTarget } from "cloudflare:workers";

import type { WorkspaceMountWorkingCopy, RpcResult } from "./working-copy-mount";
import type { WorkspaceEntry, WorkspaceStat } from "./rpc";

export type ScopedWorkspaceFileCapability = {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, contents: Uint8Array): Promise<void>;
  list(path: string): Promise<WorkspaceEntry[]>;
  stat(path: string): Promise<WorkspaceStat>;
  delete?: (path: string) => Promise<void>;
};

export type ScopedWorkspaceFileCapabilityOptions = {
  workingCopy: WorkspaceMountWorkingCopy & {
    stat(path: string): Promise<RpcResult<WorkspaceStat>>;
  };
  root: string;
  read: string[];
  write: string[];
  delete: boolean;
};

export class ScopedWorkspaceAccessError extends TaggedError("ScopedWorkspaceAccessError")<{
  operation: string;
  path: string;
  message: string;
}>() {
  constructor(args: { operation: string; path: string }) {
    super({
      ...args,
      message: `Workspace capability does not allow ${args.operation} at ${args.path}`,
    });
  }
}

export class ScopedWorkspacePathError extends TaggedError("ScopedWorkspacePathError")<{
  path: string;
  message: string;
}>() {
  constructor(args: { path: string }) {
    super({
      ...args,
      message: `Workspace capability path is not allowed: ${args.path}`,
    });
  }
}

export class ScopedWorkspaceOperationError extends TaggedError("ScopedWorkspaceOperationError")<{
  operation: string;
  path: string;
  errorTag: string;
  message: string;
}>() {
  constructor(args: { operation: string; path: string; errorTag: string }) {
    super({
      ...args,
      message: `Workspace capability ${args.operation} failed at ${args.path}: ${args.errorTag}`,
    });
  }
}

export function createWorkspaceFileCapability(
  options: ScopedWorkspaceFileCapabilityOptions,
): ScopedWorkspaceFileCapability {
  if (options.delete) {
    return new DeletingScopedWorkspaceFileCapabilityTarget(options);
  }

  return new ScopedWorkspaceFileCapabilityTarget(options);
}

class ScopedWorkspaceFileCapabilityTarget extends RpcTarget implements ScopedWorkspaceFileCapability {
  private readonly root: string;
  private readonly readScopes: ScopePattern[];
  private readonly writeScopes: ScopePattern[];

  constructor(private readonly options: ScopedWorkspaceFileCapabilityOptions) {
    super();
    this.root = normalizeRoot(options.root);
    this.readScopes = options.read.map(normalizeScopePattern);
    this.writeScopes = options.write.map(normalizeScopePattern);
  }

  async readFile(path: string): Promise<Uint8Array> {
    const workspacePath = scopedPath(this.root, path);
    assertAllowed("readFile", workspacePath, this.readScopes);
    return rpcValue(this.options.workingCopy.readFile(workspacePath), "readFile", workspacePath);
  }

  async writeFile(path: string, contents: Uint8Array): Promise<void> {
    const workspacePath = scopedPath(this.root, path);
    assertAllowed("writeFile", workspacePath, this.writeScopes);
    await ensureParentDirectories(this.options.workingCopy, workspacePath, this.writeScopes);
    await rpcVoid(this.options.workingCopy.writeFile(workspacePath, contents), "writeFile", workspacePath);
  }

  async list(path: string): Promise<WorkspaceEntry[]> {
    const workspacePath = scopedPath(this.root, path);
    assertAllowed("list", workspacePath, this.readScopes);
    return rpcValue(this.options.workingCopy.list(workspacePath), "list", workspacePath);
  }

  async stat(path: string): Promise<WorkspaceStat> {
    const workspacePath = scopedPath(this.root, path);
    assertAllowed("stat", workspacePath, this.readScopes);
    return rpcValue(this.options.workingCopy.stat(workspacePath), "stat", workspacePath);
  }

  protected async deleteAllowed(path: string): Promise<void> {
    const workspacePath = scopedPath(this.root, path);
    assertAllowed("delete", workspacePath, this.writeScopes);
    await rpcVoid(this.options.workingCopy.delete(workspacePath), "delete", workspacePath);
  }
}

class DeletingScopedWorkspaceFileCapabilityTarget extends ScopedWorkspaceFileCapabilityTarget {
  async delete(path: string): Promise<void> {
    await this.deleteAllowed(path);
  }
}

async function ensureParentDirectories(
  workingCopy: WorkspaceMountWorkingCopy,
  filePath: string,
  writeScopes: ScopePattern[],
): Promise<void> {
  const directories = parentDirectories(filePath);
  for (const directory of directories) {
    assertAllowed("writeFile", directory, writeScopes);
    const result = await workingCopy.mkdir(directory);
    if (result.status === "error" && result.error.tag !== "PathAlreadyExistsError") {
      throw new ScopedWorkspaceOperationError({ operation: "mkdir", path: directory, errorTag: result.error.tag });
    }
  }
}

async function rpcValue<T>(resultPromise: Promise<RpcResult<T>>, operation: string, path: string): Promise<T> {
  const result = await resultPromise;
  if (result.status === "error") {
    throw new ScopedWorkspaceOperationError({ operation, path, errorTag: result.error.tag });
  }

  return result.value as T;
}

async function rpcVoid(resultPromise: Promise<RpcResult>, operation: string, path: string): Promise<void> {
  const result = await resultPromise;
  if (result.status === "error") {
    throw new ScopedWorkspaceOperationError({ operation, path, errorTag: result.error.tag });
  }
}

type ScopePattern = {
  root: string;
  recursive: boolean;
};

function normalizeScopePattern(pattern: string): ScopePattern {
  const recursive = pattern.endsWith("/**");
  const path = recursive ? pattern.slice(0, -3) : pattern;
  return { root: normalizeRoot(path), recursive };
}

function assertAllowed(operation: string, path: string, scopes: ScopePattern[]): void {
  if (!scopes.some((scope) => pathMatchesScope(path, scope))) {
    throw new ScopedWorkspaceAccessError({ operation, path });
  }
}

function pathMatchesScope(path: string, scope: ScopePattern): boolean {
  if (scope.recursive) {
    return path === scope.root || path.startsWith(`${scope.root}/`);
  }

  return path === scope.root;
}

function scopedPath(root: string, requestedPath: string): string {
  const normalizedRequest = normalizeWorkspacePath(requestedPath);
  const path = requestedPath.startsWith("/") ? normalizedRequest : joinWorkspacePath(root, normalizedRequest);

  if (root === "/") {
    return path;
  }

  if (path === root || path.startsWith(`${root}/`)) {
    return path;
  }

  throw new ScopedWorkspacePathError({ path: requestedPath });
}

function normalizeRoot(path: string): string {
  return normalizeWorkspacePath(path);
}

function normalizeWorkspacePath(path: string): string {
  if (path.includes("\0")) {
    throw new ScopedWorkspacePathError({ path });
  }

  const segments = path.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.some((segment) => segment === "..")) {
    throw new ScopedWorkspacePathError({ path });
  }

  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function joinWorkspacePath(root: string, path: string): string {
  if (root === "/") {
    return path;
  }

  if (path === "/") {
    return root;
  }

  return `${root}${path}`;
}

function parentDirectories(path: string): string[] {
  const segments = path.split("/").filter(Boolean).slice(0, -1);
  const directories: string[] = [];
  let current = "";

  for (const segment of segments) {
    current = `${current}/${segment}`;
    directories.push(current);
  }

  return directories;
}
