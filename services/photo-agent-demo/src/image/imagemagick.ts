const workspacePathPrefix = "/workspace/";

export function buildDemoImageCommand(outputPath: string): string {
  return [
    "convert",
    "-size",
    quoteShell("96x64"),
    quoteShell("gradient:#5b8cff-#111827"),
    quoteWorkspacePath(outputPath),
  ].join(" ");
}

export function buildGrayscaleCommand(inputPath: string, outputPath: string): string {
  return ["convert", quoteWorkspacePath(inputPath), "-colorspace", "Gray", quoteWorkspacePath(outputPath)].join(" ");
}

export function buildSquareCropCommand(
  inputPath: string,
  outputPath: string,
  size: number,
): string {
  assertPositiveInteger(size);
  const geometry = `${size}x${size}`;

  return [
    "convert",
    quoteWorkspacePath(inputPath),
    "-resize",
    quoteShell(`${geometry}^`),
    "-gravity",
    "center",
    "-extent",
    quoteShell(geometry),
    quoteWorkspacePath(outputPath),
  ].join(" ");
}

function quoteWorkspacePath(path: string): string {
  if (!path.startsWith(workspacePathPrefix)) {
    throw new Error("Image path must live under /workspace/");
  }

  return quoteShell(path);
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function assertPositiveInteger(value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Image size must be a positive integer");
  }
}
