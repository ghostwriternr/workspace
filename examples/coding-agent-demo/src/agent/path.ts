export function normalizeAgentPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "" || trimmed === "." || trimmed === "./") {
    return "/";
  }

  const withoutCurrentDirectory = trimmed.replace(/^\.\/+/, "");
  return withoutCurrentDirectory.startsWith("/") ? withoutCurrentDirectory : `/${withoutCurrentDirectory}`;
}
