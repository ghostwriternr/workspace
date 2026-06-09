export class ArtifactsWorkingCopyRefNotFoundError extends Error {
  readonly name = "ArtifactsWorkingCopyRefNotFoundError";

  constructor(readonly ref: string, options?: { cause?: unknown }) {
    super(`Workspace working copy ref not found: ${ref}`, options);
  }
}

export function isArtifactsNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown; code?: unknown }).name === "ArtifactsError" &&
    (error as { code?: unknown }).code === "NOT_FOUND"
  );
}

export function isGitPushRejected(error: unknown): boolean {
  return error instanceof Error && error.name === "PushRejectedError";
}

export function isMissingWorkingCopyRef(error: unknown): boolean {
  return error instanceof ArtifactsWorkingCopyRefNotFoundError;
}
