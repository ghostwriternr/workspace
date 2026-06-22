import type { WorkspaceEntry, WorkspaceStat } from "../model/entries";
import { ArtifactsWorkingCopyRefNotFoundError, isArtifactsNotFound } from "./errors";

export type ArtifactsWorkspaceFileWrite = {
  path: string;
  contents: Uint8Array;
};

export type ArtifactsFileTarget = {
  readFile(path: string): Promise<Uint8Array | null>;
  list(path: string): Promise<WorkspaceEntry[]>;
  stat(path: string): Promise<WorkspaceStat | null>;
  writeFile(path: string, contents: Uint8Array): Promise<void>;
  writeFiles(files: ArtifactsWorkspaceFileWrite[]): Promise<void>;
  deleteFile(path: string): Promise<void>;
};

export type ArtifactsCurrentFileTargetDriver = {
  readFile(repository: string, path: string): Promise<Uint8Array | null>;
  list(repository: string, path: string): Promise<WorkspaceEntry[]>;
  stat(repository: string, path: string): Promise<WorkspaceStat | null>;
  writeFile(
    repository: string,
    path: string,
    contents: Uint8Array,
  ): Promise<void>;
  writeFiles(
    repository: string,
    files: ArtifactsWorkspaceFileWrite[],
  ): Promise<void>;
  deleteFile(repository: string, path: string): Promise<void>;
};

export type ArtifactsWorkingCopyFileTargetDriver = {
  readWorkingCopyFile(
    baseRepository: string,
    copyId: string,
    path: string,
  ): Promise<Uint8Array | null>;
  listWorkingCopy(
    baseRepository: string,
    copyId: string,
    path: string,
  ): Promise<WorkspaceEntry[]>;
  statWorkingCopy(
    baseRepository: string,
    copyId: string,
    path: string,
  ): Promise<WorkspaceStat | null>;
  writeWorkingCopyFile(
    baseRepository: string,
    copyId: string,
    path: string,
    contents: Uint8Array,
  ): Promise<void>;
  writeWorkingCopyFiles(
    baseRepository: string,
    copyId: string,
    files: ArtifactsWorkspaceFileWrite[],
  ): Promise<void>;
  deleteWorkingCopyFile(
    baseRepository: string,
    copyId: string,
    path: string,
  ): Promise<void>;
};

export function currentFileTarget(
  driver: ArtifactsCurrentFileTargetDriver,
  repository: string,
): ArtifactsFileTarget {
  return {
    readFile(path) {
      return driver.readFile(repository, path);
    },
    list(path) {
      return driver.list(repository, path);
    },
    stat(path) {
      return driver.stat(repository, path);
    },
    writeFile(path, contents) {
      return driver.writeFile(repository, path, contents);
    },
    writeFiles(files) {
      return driver.writeFiles(repository, files);
    },
    deleteFile(path) {
      return driver.deleteFile(repository, path);
    },
  };
}

export function workingCopyFileTarget(
  driver: ArtifactsWorkingCopyFileTargetDriver,
  baseRepository: string,
  copyId: string,
): ArtifactsFileTarget {
  return {
    readFile(path) {
      return withWorkingCopyRef(copyId, () =>
        driver.readWorkingCopyFile(baseRepository, copyId, path),
      );
    },
    list(path) {
      return withWorkingCopyRef(copyId, () =>
        driver.listWorkingCopy(baseRepository, copyId, path),
      );
    },
    stat(path) {
      return withWorkingCopyRef(copyId, () =>
        driver.statWorkingCopy(baseRepository, copyId, path),
      );
    },
    writeFile(path, contents) {
      return withWorkingCopyRef(copyId, () =>
        driver.writeWorkingCopyFile(baseRepository, copyId, path, contents),
      );
    },
    writeFiles(files) {
      return withWorkingCopyRef(copyId, () =>
        driver.writeWorkingCopyFiles(baseRepository, copyId, files),
      );
    },
    deleteFile(path) {
      return withWorkingCopyRef(copyId, () =>
        driver.deleteWorkingCopyFile(baseRepository, copyId, path),
      );
    },
  };
}

async function withWorkingCopyRef<T>(
  copyId: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isArtifactsNotFound(error)) {
      throw new ArtifactsWorkingCopyRefNotFoundError(copyId, { cause: error });
    }
    throw error;
  }
}
