import type { WorkspaceEntry } from "../model/rpc";

export type EntryType = "directory" | "file";

export type EntryRow = {
  path: string;
  parent_path: string;
  name: string;
  type: EntryType;
  blob_key: string | null;
  size: number | null;
  created_at: number;
  updated_at: number;
};

export type BlobRef = {
  blobKey: string;
  size: number;
};

export interface ReadableTree {
  getEntry(path: string): EntryRow | null;
  listChildren(path: string): WorkspaceEntry[];
}

export interface MutableTree extends ReadableTree {
  putDirectory(path: string, now: number): void;
  putFile(path: string, blob: BlobRef, now: number): void;
  deleteEntry(path: string): void;
  hasChildren(path: string): boolean;
}
