export function relativeGitPath(path: string): string {
  return path.replace(/^\/+/, "");
}

export function workingCopyRef(copyId: string): string {
  return `refs/workspace/copies/${copyId}`;
}

export function workingCopyLocalBranch(copyId: string): string {
  return `workspace/copies/${copyId}`;
}

export function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}
