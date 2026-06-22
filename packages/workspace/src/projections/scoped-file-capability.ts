import { Result } from "better-result";

import type { WorkspaceEntry, WorkspaceStat } from "../model/entries";

export type ScopedWorkspaceAccessErrorDto = {
  tag: "ScopedWorkspaceAccessError";
  operation: string;
  path: string;
  message: string;
};

export type ScopedWorkspacePathErrorDto = {
  tag: "ScopedWorkspacePathError";
  path: string;
  message: string;
};

export type ScopedWorkspaceOperationErrorDto = {
  tag: "ScopedWorkspaceOperationError";
  operation: string;
  path: string;
  errorTag: string;
  message: string;
};

export type ScopedWorkspaceErrorDto =
  | ScopedWorkspaceAccessErrorDto
  | ScopedWorkspacePathErrorDto
  | ScopedWorkspaceOperationErrorDto
  | { tag: string; message?: string };

export type ScopedWorkspaceOk<T = void> = T extends void ? { status: "ok" } : { status: "ok"; value: T };

export type ScopedWorkspaceCapabilityResult<T = void> =
  | ScopedWorkspaceOk<T>
  | { status: "error"; error: ScopedWorkspaceErrorDto };

export type ScopedWorkspaceFileCapability = {
  readFile(path: string): Promise<ScopedWorkspaceCapabilityResult<Uint8Array>>;
  writeFile(path: string, contents: Uint8Array): Promise<ScopedWorkspaceCapabilityResult>;
  list(path: string): Promise<ScopedWorkspaceCapabilityResult<WorkspaceEntry[]>>;
  stat(path: string): Promise<ScopedWorkspaceCapabilityResult<WorkspaceStat>>;
};

type WorkspaceFileResult<T = void> = Promise<Result<T, { tag: string; message?: string }>>;

type ScopedWorkspaceFiles = {
  mkdir(path: string): WorkspaceFileResult;
  read(path: string): WorkspaceFileResult<Uint8Array>;
  write(path: string, contents: Uint8Array): WorkspaceFileResult;
  list(path: string): WorkspaceFileResult<WorkspaceEntry[]>;
  stat(path: string): WorkspaceFileResult<WorkspaceStat>;
};

export type ScopedWorkspaceFileCapabilityOptions = {
  files: ScopedWorkspaceFiles;
  root: string;
  read: string[];
  write: string[];
};

export function createWorkspaceFileCapability(
  options: ScopedWorkspaceFileCapabilityOptions,
): ScopedWorkspaceFileCapability {
  return new ScopedWorkspaceFileCapabilityTarget(options);
}

class ScopedWorkspaceFileCapabilityTarget implements ScopedWorkspaceFileCapability {
  private readonly ensuredDirectories = new Set<string>();
  private readonly root: string;
  private readonly readScopes: WorkspaceScopeSet;
  private readonly writeScopes: WorkspaceScopeSet;

  constructor(private readonly options: ScopedWorkspaceFileCapabilityOptions) {
    this.root = normalizeTrustedWorkspacePath(options.root);
    this.readScopes = new WorkspaceScopeSet(options.read);
    this.writeScopes = new WorkspaceScopeSet(options.write);
  }

  async readFile(path: string): Promise<ScopedWorkspaceCapabilityResult<Uint8Array>> {
    const target = this.resolveAllowedPath("readFile", path, this.readScopes);
    if (target.status === "error") return target;

    return resultToRpc(this.options.files.read(target.value));
  }

  async writeFile(path: string, contents: Uint8Array): Promise<ScopedWorkspaceCapabilityResult> {
    const target = this.resolveAllowedPath("writeFile", path, this.writeScopes);
    if (target.status === "error") return target;

    const parents = await ensureParentDirectories(this.options.files, target.value, this.ensuredDirectories);
    if (parents.status === "error") return parents;

    return resultToRpc(this.options.files.write(target.value, contents));
  }

  async list(path: string): Promise<ScopedWorkspaceCapabilityResult<WorkspaceEntry[]>> {
    const target = this.resolveAllowedPath("list", path, this.readScopes);
    if (target.status === "error") return target;

    return resultToRpc(this.options.files.list(target.value));
  }

  async stat(path: string): Promise<ScopedWorkspaceCapabilityResult<WorkspaceStat>> {
    const target = this.resolveAllowedPath("stat", path, this.readScopes);
    if (target.status === "error") return target;

    return resultToRpc(this.options.files.stat(target.value));
  }

  private resolveAllowedPath(
    operation: string,
    requestedPath: string,
    scopes: WorkspaceScopeSet,
  ): ScopedWorkspaceCapabilityResult<string> {
    const path = scopedPath(this.root, requestedPath);
    if (path.status === "error") return path;

    if (!scopes.allows(path.value)) {
      return { status: "error", error: scopedAccessError(operation, path.value) };
    }

    return path;
  }
}

class WorkspaceScopeSet {
  private readonly scopes: ScopePattern[];

  constructor(patterns: string[]) {
    this.scopes = patterns.map(normalizeScopePattern);
  }

  allows(path: string): boolean {
    return this.scopes.some((scope) => pathMatchesScope(path, scope));
  }
}

async function ensureParentDirectories(
  files: ScopedWorkspaceFiles,
  filePath: string,
  ensuredDirectories: Set<string>,
): Promise<ScopedWorkspaceCapabilityResult> {
  for (const directory of parentDirectories(filePath)) {
    if (ensuredDirectories.has(directory)) {
      continue;
    }

    const result = await files.mkdir(directory);
    if (Result.isError(result) && result.error.tag !== "PathAlreadyExistsError") {
      return { status: "error", error: scopedOperationError("mkdir", directory, result.error.tag) };
    }
    ensuredDirectories.add(directory);
  }

  return { status: "ok" };
}

async function resultToRpc<T>(
  resultPromise: Promise<Result<T, { tag: string; message?: string }>>,
): Promise<ScopedWorkspaceCapabilityResult<T>> {
  const result = await resultPromise;
  if (Result.isError(result)) {
    return { status: "error", error: result.error };
  }

  if (result.value === undefined) {
    return { status: "ok" } as ScopedWorkspaceCapabilityResult<T>;
  }

  return { status: "ok", value: result.value } as ScopedWorkspaceCapabilityResult<T>;
}

type ScopePattern = {
  root: string;
  recursive: boolean;
};

function normalizeScopePattern(pattern: string): ScopePattern {
  const recursive = pattern.endsWith("/**");
  const path = recursive ? pattern.slice(0, -3) : pattern;
  return { root: normalizeTrustedWorkspacePath(path), recursive };
}

function pathMatchesScope(path: string, scope: ScopePattern): boolean {
  if (!scope.recursive) {
    return path === scope.root;
  }

  if (scope.root === "/") {
    return path.startsWith("/");
  }

  return path === scope.root || path.startsWith(`${scope.root}/`);
}

function scopedPath(root: string, requestedPath: string): ScopedWorkspaceCapabilityResult<string> {
  const normalizedRequest = normalizeWorkspacePath(requestedPath);
  if (normalizedRequest.status === "error") return normalizedRequest;

  const path = requestedPath.startsWith("/")
    ? normalizedRequest.value
    : joinWorkspacePath(root, normalizedRequest.value);

  if (root === "/") {
    return { status: "ok", value: path };
  }

  if (path === root || path.startsWith(`${root}/`)) {
    return { status: "ok", value: path };
  }

  return { status: "error", error: scopedPathError(requestedPath) };
}

function normalizeTrustedWorkspacePath(path: string): string {
  const result = normalizeWorkspacePath(path);
  if (result.status === "error") {
    throw new Error(result.error.message);
  }
  return result.value;
}

function normalizeWorkspacePath(path: string): ScopedWorkspaceCapabilityResult<string> {
  if (path.includes("\0")) {
    return { status: "error", error: scopedPathError(path) };
  }

  const segments = path.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.some((segment) => segment === "..")) {
    return { status: "error", error: scopedPathError(path) };
  }

  return { status: "ok", value: segments.length === 0 ? "/" : `/${segments.join("/")}` };
}

function joinWorkspacePath(root: string, path: string): string {
  if (root === "/") return path;
  if (path === "/") return root;
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

function scopedAccessError(operation: string, path: string): ScopedWorkspaceAccessErrorDto {
  return {
    tag: "ScopedWorkspaceAccessError",
    operation,
    path,
    message: `Workspace capability does not allow ${operation} at ${path}`,
  };
}

function scopedPathError(path: string): ScopedWorkspacePathErrorDto {
  return {
    tag: "ScopedWorkspacePathError",
    path,
    message: `Workspace capability path is not allowed: ${path}`,
  };
}

function scopedOperationError(operation: string, path: string, errorTag: string): ScopedWorkspaceOperationErrorDto {
  return {
    tag: "ScopedWorkspaceOperationError",
    operation,
    path,
    errorTag,
    message: `Workspace capability ${operation} failed at ${path}: ${errorTag}`,
  };
}
