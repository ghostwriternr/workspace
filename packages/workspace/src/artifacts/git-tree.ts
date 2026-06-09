import type { WorkspaceEntry, WorkspaceStat } from "../model/entries";
import { relativeGitPath } from "./git-path";

export function entriesFromFiles(files: string[], path: string): WorkspaceEntry[] {
  const prefix = path === "/" ? "" : `${relativeGitPath(path)}/`;
  const entries = new Map<string, "directory" | "file">();

  for (const file of files) {
    if (!file.startsWith(prefix)) continue;
    const rest = file.slice(prefix.length);
    if (!rest) continue;
    const [name, ...remaining] = rest.split("/");
    entries.set(name, remaining.length === 0 ? "file" : "directory");
  }

  return [...entries]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, type]) => ({
      name,
      path: path === "/" ? `/${name}` : `${path}/${name}`,
      type,
    }));
}

export async function statFromFiles(
  path: string,
  files: string[],
  read: (path: string) => Promise<Uint8Array | null>,
): Promise<WorkspaceStat | null> {
  const now = Date.now();
  if (path === "/") {
    return { path, type: "directory", size: null, createdAt: now, updatedAt: now };
  }

  const rel = relativeGitPath(path);
  if (files.includes(rel)) {
    const contents = await read(path);
    return {
      path,
      type: "file",
      size: contents?.byteLength ?? 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  const prefix = `${rel}/`;
  if (files.some((file) => file.startsWith(prefix))) {
    return { path, type: "directory", size: null, createdAt: now, updatedAt: now };
  }

  return null;
}
