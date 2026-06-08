import { Result, TaggedError } from "better-result";

export type WorkspaceMountEntry = {
  name: string;
  path: string;
  type: "directory" | "file";
};

export type WorkspaceMountStat = {
  path: string;
  type: "directory" | "file";
  size: number | null;
  createdAt: number;
  updatedAt: number;
};

type WorkspaceFileResult<T = void> = Promise<Result<T, { tag: string; message?: string }>>;

export type WorkspaceMountFiles = {
  delete(path: string): WorkspaceFileResult;
  list(path: string): WorkspaceFileResult<WorkspaceMountEntry[]>;
  mkdir(path: string): WorkspaceFileResult;
  read(path: string): WorkspaceFileResult<Uint8Array>;
  stat(path: string): WorkspaceFileResult<WorkspaceMountStat>;
  write(path: string, contents: Uint8Array): WorkspaceFileResult;
};

export type HostMountEntry = {
  path: string;
  type: "directory" | "file" | "symlink" | "other";
};

export type WorkspaceMountHost = {
  resetDirectory?(path: string): Promise<unknown>;
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
  writeFile(path: string, contents: Uint8Array): Promise<unknown>;
  readFile(path: string): Promise<Uint8Array>;
  listFiles(path: string): Promise<HostMountEntry[]>;
};

export type WorkspaceMountReconcileSummary = {
  created: string[];
  modified: string[];
  deleted: string[];
  unchanged: number;
};

export class MountOperationError extends TaggedError("MountOperationError")<{
  operation: string;
  errorTag: string;
  message: string;
}>() {
  constructor(args: { operation: string; errorTag: string; message?: string }) {
    super({
      operation: args.operation,
      errorTag: args.errorTag,
      message: args.message ?? `Workspace mount operation failed: ${args.operation} returned ${args.errorTag}`,
    });
  }
}

export class UnsupportedMountEntryError extends TaggedError("UnsupportedMountEntryError")<{
  path: string;
  entryType: string;
  message: string;
}>() {
  constructor(args: { path: string; entryType: string }) {
    super({
      ...args,
      message: `Workspace mount does not support ${args.entryType} entries: ${args.path}`,
    });
  }
}

class MountPathEscapeError extends TaggedError("MountPathEscapeError")<{
  root: string;
  path: string;
  message: string;
}>() {
  constructor(args: { root: string; path: string }) {
    super({
      ...args,
      message: `Workspace mount path is outside ${args.root}: ${args.path}`,
    });
  }
}

export type WorkspaceMountError = MountOperationError | UnsupportedMountEntryError | MountPathEscapeError;
export type WorkspaceMountAttachResult = Result<WorkspaceMount, WorkspaceMountError>;
export type WorkspaceMountReconcileResult = Result<WorkspaceMountReconcileSummary, WorkspaceMountError>;

export type WorkspaceMount = {
  root: string;
  reconcile(): Promise<WorkspaceMountReconcileResult>;
};

export async function attachWorkspaceMount(options: {
  files: WorkspaceMountFiles;
  host: WorkspaceMountHost;
  root: string;
}): Promise<WorkspaceMountAttachResult> {
  const root = normalizeHostRoot(options.root);
  const baseline = new Map<string, MountedEntry>();

  await options.host.resetDirectory?.(root);
  await options.host.mkdir(root, { recursive: true });
  const materialized = await materializeDirectory({
    files: options.files,
    host: options.host,
    root,
    workspacePath: "/",
    baseline,
  });
  if (Result.isError(materialized)) {
    return Result.err(materialized.error);
  }

  return Result.ok({
    root,
    reconcile: () => reconcileMount({ files: options.files, host: options.host, root, baseline }),
  });
}

type MountedEntry =
  | { type: "directory" }
  | { type: "file"; digest: string };

async function materializeDirectory(options: {
  files: WorkspaceMountFiles;
  host: WorkspaceMountHost;
  root: string;
  workspacePath: string;
  baseline: Map<string, MountedEntry>;
}): Promise<Result<void, WorkspaceMountError>> {
  const entries = await resultValue(options.files.list(options.workspacePath), `list ${options.workspacePath}`);
  if (Result.isError(entries)) {
    return Result.err(entries.error);
  }

  for (const entry of sortWorkspaceEntries(entries.value)) {
    const hostPath = hostPathForWorkspacePath(options.root, entry.path);
    if (entry.type === "directory") {
      await options.host.mkdir(hostPath, { recursive: true });
      options.baseline.set(entry.path, { type: "directory" });
      const child = await materializeDirectory({ ...options, workspacePath: entry.path });
      if (Result.isError(child)) {
        return Result.err(child.error);
      }
    } else {
      const contents = await resultValue(options.files.read(entry.path), `read ${entry.path}`);
      if (Result.isError(contents)) {
        return Result.err(contents.error);
      }
      await options.host.writeFile(hostPath, contents.value);
      options.baseline.set(entry.path, { type: "file", digest: await digestBytes(contents.value) });
    }
  }

  return Result.ok();
}

async function reconcileMount(options: {
  files: WorkspaceMountFiles;
  host: WorkspaceMountHost;
  root: string;
  baseline: Map<string, MountedEntry>;
}): Promise<WorkspaceMountReconcileResult> {
  const hostEntries = await options.host.listFiles(options.root);
  const snapshot = new Map<string, MountedEntry>();

  for (const entry of hostEntries) {
    if (entry.type !== "directory" && entry.type !== "file") {
      return Result.err(new UnsupportedMountEntryError({ path: entry.path, entryType: entry.type }));
    }

    const workspacePath = workspacePathForHostPath(options.root, entry.path);
    if (Result.isError(workspacePath)) {
      return Result.err(workspacePath.error);
    }

    if (workspacePath.value === "/") {
      continue;
    }

    if (entry.type === "directory") {
      snapshot.set(workspacePath.value, { type: "directory" });
    } else {
      const contents = await options.host.readFile(entry.path);
      snapshot.set(workspacePath.value, { type: "file", digest: await digestBytes(contents) });
    }
  }

  const created: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  let unchanged = 0;

  const removedFiles = [...options.baseline.entries()]
    .filter(([path, entry]) => entry.type === "file" && snapshot.get(path)?.type !== "file")
    .map(([path]) => path)
    .sort();
  for (const path of removedFiles) {
    const deletedFile = await resultValue(options.files.delete(path), `delete ${path}`);
    if (Result.isError(deletedFile)) {
      return Result.err(deletedFile.error);
    }
    deleted.push(path);
  }

  const removedDirectories = sortedByDepth(
    [...options.baseline.entries()]
      .filter(([path, entry]) => entry.type === "directory" && snapshot.get(path)?.type !== "directory")
      .map(([path]) => path),
  ).reverse();
  for (const path of removedDirectories) {
    const deletedDirectory = await resultValue(options.files.delete(path), `delete ${path}`);
    if (Result.isError(deletedDirectory)) {
      return Result.err(deletedDirectory.error);
    }
    deleted.push(path);
  }

  const createdDirectories = sortedByDepth(
    [...snapshot.entries()]
      .filter(([path, entry]) => entry.type === "directory" && options.baseline.get(path)?.type !== "directory")
      .map(([path]) => path),
  );
  for (const path of createdDirectories) {
    const madeDirectory = await resultValue(options.files.mkdir(path), `mkdir ${path}`);
    if (Result.isError(madeDirectory)) {
      return Result.err(madeDirectory.error);
    }
    created.push(path);
  }

  const filePaths = [...snapshot.entries()]
    .filter((entry): entry is [string, { type: "file"; digest: string }] => entry[1].type === "file")
    .map(([path]) => path)
    .sort();
  for (const path of filePaths) {
    const next = snapshot.get(path);
    if (!next || next.type !== "file") {
      continue;
    }

    const previous = options.baseline.get(path);
    if (!previous) {
      const contents = await options.host.readFile(hostPathForWorkspacePath(options.root, path));
      const wroteFile = await resultValue(options.files.write(path, contents), `write ${path}`);
      if (Result.isError(wroteFile)) {
        return Result.err(wroteFile.error);
      }
      created.push(path);
      continue;
    }

    if (previous.type !== "file" || previous.digest !== next.digest) {
      const contents = await options.host.readFile(hostPathForWorkspacePath(options.root, path));
      const wroteFile = await resultValue(options.files.write(path, contents), `write ${path}`);
      if (Result.isError(wroteFile)) {
        return Result.err(wroteFile.error);
      }
      modified.push(path);
    } else {
      unchanged += 1;
    }
  }

  for (const [path, entry] of snapshot.entries()) {
    const previous = options.baseline.get(path);
    if (entry.type === "directory" && previous?.type === "directory") {
      unchanged += 1;
    }
  }

  options.baseline.clear();
  for (const [path, entry] of snapshot.entries()) {
    options.baseline.set(path, entry);
  }

  return Result.ok({ created, modified, deleted, unchanged });
}

async function resultValue<T>(
  result: Promise<Result<T, { tag: string; message?: string }>>,
  operation: string,
): Promise<Result<T, MountOperationError>> {
  const value = await result;
  if (Result.isError(value)) {
    return Result.err(new MountOperationError({
      operation,
      errorTag: value.error.tag,
      message: value.error.message,
    }));
  }

  return Result.ok(value.value);
}

function sortWorkspaceEntries(entries: WorkspaceMountEntry[]): WorkspaceMountEntry[] {
  return [...entries].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "directory" ? -1 : 1;
    }
    return left.path.localeCompare(right.path);
  });
}

function sortedByDepth(paths: string[]): string[] {
  return [...paths].sort((left, right) => pathDepth(left) - pathDepth(right) || left.localeCompare(right));
}

function pathDepth(path: string): number {
  return path.split("/").filter(Boolean).length;
}

function hostPathForWorkspacePath(root: string, workspacePath: string): string {
  if (workspacePath === "/") {
    return root;
  }
  if (root === "/") {
    return workspacePath;
  }

  return `${root}${workspacePath}`;
}

function workspacePathForHostPath(root: string, hostPath: string): Result<string, MountPathEscapeError> {
  if (root === "/") {
    return hostPath.startsWith("/")
      ? Result.ok(hostPath)
      : Result.err(new MountPathEscapeError({ root, path: hostPath }));
  }

  if (hostPath === root) {
    return Result.ok("/");
  }

  const prefix = `${root}/`;
  if (!hostPath.startsWith(prefix)) {
    return Result.err(new MountPathEscapeError({ root, path: hostPath }));
  }

  return Result.ok(`/${hostPath.slice(prefix.length)}`);
}

function normalizeHostRoot(root: string): string {
  return root.length > 1 && root.endsWith("/") ? root.slice(0, -1) : root;
}

async function digestBytes(bytes: Uint8Array): Promise<string> {
  const input = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(input).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
