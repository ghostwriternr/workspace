import type { WorkspaceEntry, WorkspaceStore } from "./workspace-store";

type DirectoryNode = {
  type: "directory";
  children: Map<string, TreeNode>;
};

type FileNode = {
  type: "file";
  contents: Uint8Array;
};

type TreeNode = DirectoryNode | FileNode;

export class MemoryWorkspace implements WorkspaceStore {
  readonly #root: DirectoryNode = { type: "directory", children: new Map() };

  async writeFile(path: string, contents: Uint8Array): Promise<void> {
    const segments = parseWorkspacePath(path, { allowRoot: false });
    const fileName = segments.at(-1)!;
    const parent = this.#ensureDirectory(segments.slice(0, -1));

    parent.children.set(fileName, {
      type: "file",
      contents: new Uint8Array(contents),
    });
  }

  async readFile(path: string): Promise<Uint8Array> {
    const node = this.#getNode(path);
    if (node.type === "directory") {
      throw new Error("Path is a directory");
    }

    return new Uint8Array(node.contents);
  }

  async list(path: string): Promise<WorkspaceEntry[]> {
    const node = this.#getNode(path);
    if (node.type === "file") {
      throw new Error("Path is a file");
    }

    return Array.from(node.children.entries())
      .map(([name, child]) => ({
        name,
        path: joinWorkspacePath(path, name),
        type: child.type,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async delete(path: string): Promise<void> {
    const segments = parseWorkspacePath(path, { allowRoot: false });
    const fileName = segments.at(-1)!;
    const parentSegments = segments.slice(0, -1);
    const parent = this.#getDirectory(parentSegments);
    const node = parent.children.get(fileName);

    if (!node) {
      throw new Error("Path not found");
    }
    if (node.type === "directory") {
      throw new Error("Path is a directory");
    }

    parent.children.delete(fileName);
    this.#pruneEmptyDirectories(parentSegments);
  }

  #ensureDirectory(segments: string[]): DirectoryNode {
    let current = this.#root;

    for (const segment of segments) {
      const child = current.children.get(segment);
      if (!child) {
        const directory: DirectoryNode = { type: "directory", children: new Map() };
        current.children.set(segment, directory);
        current = directory;
        continue;
      }
      if (child.type === "file") {
        throw new Error("Path is a file");
      }
      current = child;
    }

    return current;
  }

  #getNode(path: string): TreeNode {
    return this.#getNodeFromSegments(parseWorkspacePath(path, { allowRoot: true }));
  }

  #getNodeFromSegments(segments: string[]): TreeNode {
    let current: TreeNode = this.#root;

    for (const segment of segments) {
      if (current.type === "file") {
        throw new Error("Path is a file");
      }

      const child = current.children.get(segment);
      if (!child) {
        throw new Error("Path not found");
      }
      current = child;
    }

    return current;
  }

  #getDirectory(segments: string[]): DirectoryNode {
    const node = this.#getNodeFromSegments(segments);
    if (node.type === "file") {
      throw new Error("Path is a file");
    }
    return node;
  }

  #pruneEmptyDirectories(segments: string[]): void {
    for (let length = segments.length; length > 0; length--) {
      const directorySegments = segments.slice(0, length);
      const directory = this.#getDirectory(directorySegments);
      if (directory.children.size > 0) {
        return;
      }

      const parent = this.#getDirectory(directorySegments.slice(0, -1));
      parent.children.delete(directorySegments.at(-1)!);
    }
  }
}

function parseWorkspacePath(path: string, options: { allowRoot: boolean }): string[] {
  if (!path.startsWith("/")) {
    throw new Error("Workspace paths must be absolute");
  }
  if (path.includes("\0")) {
    throw new Error("Workspace paths must not contain NUL bytes");
  }
  if (path === "/") {
    if (options.allowRoot) {
      return [];
    }
    throw new Error("Workspace path must not be root");
  }

  const segments = path.slice(1).split("/");
  if (segments.some((segment) => segment.length === 0)) {
    throw new Error("Workspace paths must not contain empty segments");
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Workspace paths must not contain traversal segments");
  }

  return segments;
}

function joinWorkspacePath(parent: string, name: string): string {
  if (parent === "/") {
    return `/${name}`;
  }
  return `${parent}/${name}`;
}
