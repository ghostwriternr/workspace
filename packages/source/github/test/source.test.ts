import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import { resolveGitHubSource, type FetchFn } from "../src";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function text(value: Uint8Array): string {
  return textDecoder.decode(value);
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function blobPayload(value: string) {
  return {
    size: bytes(value).byteLength,
    encoding: "base64",
    content: btoa(value),
  };
}

function createFetchStub(routes: Record<string, Response | (() => Promise<Response>)>): FetchFn & { urls: string[]; requests: RequestInit[] } {
  const urls: string[] = [];
  const requests: RequestInit[] = [];
  const fetchStub = async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    urls.push(url);
    requests.push(init ?? {});
    const response = routes[url];
    if (!response) {
      return jsonResponse({ message: `unexpected ${url}` }, 599);
    }
    const resolved = typeof response === "function" ? await response() : response;
    return resolved.clone();
  };

  return Object.assign(fetchStub, { urls, requests });
}

async function collect(source: AsyncIterable<{ path: string; contents: Uint8Array }>) {
  const entries: Array<{ path: string; text: string }> = [];
  for await (const entry of source) {
    entries.push({ path: entry.path, text: text(entry.contents) });
  }
  return entries;
}

async function expectEntryError(source: AsyncIterable<{ path: string; contents: Uint8Array }>): Promise<Error> {
  try {
    await collect(source);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }

  throw new Error("Expected entry stream to fail");
}

describe("GitHub source adapter", () => {
  it("resolves the default branch and streams repository files", async () => {
    const fetch = createFetchStub({
      "https://api.github.com/repos/acme/demo": jsonResponse({ default_branch: "main" }),
      "https://api.github.com/repos/acme/demo/commits/main": jsonResponse({
        sha: "1111111111111111111111111111111111111111",
        commit: { tree: { sha: "tree-1" } },
      }),
      "https://api.github.com/repos/acme/demo/git/trees/tree-1?recursive=1": jsonResponse({
        truncated: false,
        tree: [
          { path: "README.md", type: "blob", sha: "blob-readme", size: 8 },
          { path: "src", type: "tree", sha: "tree-src" },
          { path: "src/index.ts", type: "blob", sha: "blob-index", size: 16 },
        ],
      }),
      "https://api.github.com/repos/acme/demo/git/blobs/blob-readme": jsonResponse(blobPayload("# Demo\n")),
      "https://api.github.com/repos/acme/demo/git/blobs/blob-index": jsonResponse(blobPayload("export {};\n")),
    });

    const source = await resolveGitHubSource({ owner: "acme", repo: "demo", fetch });

    expect(Result.isOk(source)).toBe(true);
    if (Result.isError(source)) return;
    expect(source.value.snapshot).toEqual({
      type: "github",
      owner: "acme",
      repo: "demo",
      ref: "main",
      commitSha: "1111111111111111111111111111111111111111",
    });
    await expect(collect(source.value.entries())).resolves.toEqual([
      { path: "README.md", text: "# Demo\n" },
      { path: "src/index.ts", text: "export {};\n" },
    ]);
  });

  it("resolves an explicit ref and sends token auth", async () => {
    const fetch = createFetchStub({
      "https://api.github.com/repos/acme/demo/commits/feature%2Fimport": jsonResponse({
        sha: "2222222222222222222222222222222222222222",
        commit: { tree: { sha: "tree-2" } },
      }),
      "https://api.github.com/repos/acme/demo/git/trees/tree-2?recursive=1": jsonResponse({ truncated: false, tree: [] }),
    });

    const source = await resolveGitHubSource({
      owner: "acme",
      repo: "demo",
      ref: "feature/import",
      token: "github-token",
      fetch,
    });

    expect(Result.isOk(source)).toBe(true);
    expect(fetch.requests[0]?.headers).toMatchObject({ authorization: "token github-token" });
  });

  it("rejects invalid source identity", async () => {
    const source = await resolveGitHubSource({ owner: "../acme", repo: "demo", fetch: async () => jsonResponse({}) });

    expect(Result.isError(source)).toBe(true);
    if (Result.isError(source)) {
      expect(source.error).toMatchObject({ tag: "InvalidGitHubSourceError" });
    }
  });

  it("rejects invalid GitHub API base URLs", async () => {
    const source = await resolveGitHubSource({
      owner: "acme",
      repo: "demo",
      apiBaseUrl: "ftp://api.github.com?x=1",
      fetch: async () => jsonResponse({}),
    });

    expect(Result.isError(source)).toBe(true);
    if (Result.isError(source)) {
      expect(source.error).toMatchObject({ tag: "InvalidGitHubSourceError", field: "apiBaseUrl" });
    }
  });

  it("returns upstream errors for malformed GitHub responses", async () => {
    const fetch = createFetchStub({
      "https://api.github.com/repos/acme/demo": jsonResponse({}),
    });

    const source = await resolveGitHubSource({ owner: "acme", repo: "demo", fetch });

    expect(Result.isError(source)).toBe(true);
    if (Result.isError(source)) {
      expect(source.error).toMatchObject({
        tag: "GitHubUpstreamError",
        message: "GitHub repository response did not include default_branch",
      });
    }
  });

  it("returns not found when GitHub cannot resolve the ref", async () => {
    const fetch = createFetchStub({
      "https://api.github.com/repos/acme/demo/commits/missing": jsonResponse({ message: "Not Found" }, 404),
    });

    const source = await resolveGitHubSource({ owner: "acme", repo: "demo", ref: "missing", fetch });

    expect(Result.isError(source)).toBe(true);
    if (Result.isError(source)) {
      expect(source.error).toMatchObject({ tag: "GitHubSourceNotFoundError", status: 404 });
    }
  });

  it("returns auth errors separately from upstream failures", async () => {
    const fetch = createFetchStub({
      "https://api.github.com/repos/acme/demo/commits/main": jsonResponse({ message: "Bad credentials" }, 401),
    });

    const source = await resolveGitHubSource({ owner: "acme", repo: "demo", ref: "main", fetch });

    expect(Result.isError(source)).toBe(true);
    if (Result.isError(source)) {
      expect(source.error).toMatchObject({ tag: "GitHubAuthenticationError", status: 401 });
    }
  });

  it("rejects truncated GitHub trees", async () => {
    const fetch = createFetchStub({
      "https://api.github.com/repos/acme/demo/commits/main": jsonResponse({
        sha: "3333333333333333333333333333333333333333",
        commit: { tree: { sha: "tree-3" } },
      }),
      "https://api.github.com/repos/acme/demo/git/trees/tree-3?recursive=1": jsonResponse({ truncated: true, tree: [] }),
    });

    const source = await resolveGitHubSource({ owner: "acme", repo: "demo", ref: "main", fetch });

    expect(Result.isError(source)).toBe(true);
    if (Result.isError(source)) {
      expect(source.error).toMatchObject({ tag: "GitHubTreeTruncatedError" });
    }
  });

  it("rejects files larger than the configured byte limit before fetching blobs", async () => {
    const fetch = createFetchStub({
      "https://api.github.com/repos/acme/demo/commits/main": jsonResponse({
        sha: "4444444444444444444444444444444444444444",
        commit: { tree: { sha: "tree-4" } },
      }),
      "https://api.github.com/repos/acme/demo/git/trees/tree-4?recursive=1": jsonResponse({
        truncated: false,
        tree: [{ path: "large.bin", type: "blob", sha: "blob-large", size: 11 }],
      }),
    });

    const source = await resolveGitHubSource({ owner: "acme", repo: "demo", ref: "main", fetch, maxFileBytes: 10 });

    expect(Result.isOk(source)).toBe(true);
    if (Result.isError(source)) return;
    const error = await expectEntryError(source.value.entries());

    expect(error.message).toBe("GitHub file exceeds 10 bytes: large.bin");
    expect(error).toMatchObject({
      tag: "GitHubFileTooLargeError",
      path: "large.bin",
      size: 11,
      maxSize: 10,
    });
    expect(fetch.urls).not.toContain("https://api.github.com/repos/acme/demo/git/blobs/blob-large");
  });

  it("fetches blobs concurrently while preserving tree order", async () => {
    let firstBlobRequested = false;
    let resolveFirstBlob: (() => void) | undefined;
    const firstBlobStarted = new Promise<void>((resolve) => { resolveFirstBlob = resolve; });
    const fetch = createFetchStub({
      "https://api.github.com/repos/acme/demo/commits/main": jsonResponse({
        sha: "5555555555555555555555555555555555555555",
        commit: { tree: { sha: "tree-5" } },
      }),
      "https://api.github.com/repos/acme/demo/git/trees/tree-5?recursive=1": jsonResponse({
        truncated: false,
        tree: [
          { path: "a.txt", type: "blob", sha: "blob-a", size: 1 },
          { path: "b.txt", type: "blob", sha: "blob-b", size: 1 },
        ],
      }),
      "https://api.github.com/repos/acme/demo/git/blobs/blob-a": async () => {
        firstBlobRequested = true;
        await firstBlobStarted;
        return jsonResponse(blobPayload("a"));
      },
      "https://api.github.com/repos/acme/demo/git/blobs/blob-b": async () => {
        expect(firstBlobRequested).toBe(true);
        resolveFirstBlob?.();
        return jsonResponse(blobPayload("b"));
      },
    });

    const source = await resolveGitHubSource({ owner: "acme", repo: "demo", ref: "main", fetch });

    expect(Result.isOk(source)).toBe(true);
    if (Result.isError(source)) return;
    await expect(collect(source.value.entries())).resolves.toEqual([
      { path: "a.txt", text: "a" },
      { path: "b.txt", text: "b" },
    ]);
  });

  it("surfaces blob fetch failures while streaming entries", async () => {
    const fetch = createFetchStub({
      "https://api.github.com/repos/acme/demo/commits/main": jsonResponse({
        sha: "5555555555555555555555555555555555555555",
        commit: { tree: { sha: "tree-5" } },
      }),
      "https://api.github.com/repos/acme/demo/git/trees/tree-5?recursive=1": jsonResponse({
        truncated: false,
        tree: [{ path: "README.md", type: "blob", sha: "blob-missing", size: 1 }],
      }),
      "https://api.github.com/repos/acme/demo/git/blobs/blob-missing": jsonResponse({ message: "Not Found" }, 404),
    });

    const source = await resolveGitHubSource({ owner: "acme", repo: "demo", ref: "main", fetch });

    expect(Result.isOk(source)).toBe(true);
    if (Result.isError(source)) return;
    const error = await expectEntryError(source.value.entries());

    expect(error.message).toBe("GitHub resource not found: https://api.github.com/repos/acme/demo/git/blobs/blob-missing");
    expect(error).toMatchObject({
      tag: "GitHubSourceNotFoundError",
      status: 404,
    });
  });
});
