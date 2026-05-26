import { Result } from "better-result";
import { PathNotFoundError } from "../model/errors";
import type { WorkspaceReadResult } from "../model/rpc";
import type { BlobRef } from "./tree";

export class WorkspaceBlobStore {
  constructor(private readonly bucket: R2Bucket) {}

  async put(contents: Uint8Array): Promise<BlobRef> {
    const bytes = new Uint8Array(contents);
    const blobKey = await blobKeyFor(bytes);
    await this.bucket.put(blobKey, bytes);
    return { blobKey, size: bytes.byteLength };
  }

  async get(path: string, blobKey: string | null): Promise<WorkspaceReadResult> {
    if (!blobKey) {
      // A file row without a blob key is storage corruption. The prototype still maps missing
      // blob references to PathNotFoundError; see docs/known-limitations.md.
      return Result.err(new PathNotFoundError({ path }));
    }

    const object = await this.bucket.get(blobKey);
    if (!object) {
      return Result.err(new PathNotFoundError({ path }));
    }

    return Result.ok(new Uint8Array(await object.arrayBuffer()));
  }
}

async function blobKeyFor(contents: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", arrayBufferFor(contents));
  return `blobs/sha256/${hex(new Uint8Array(digest))}`;
}

function arrayBufferFor(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
