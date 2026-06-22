import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_VERSION,
  assetNameForPlatform,
  parseChecksum,
  releaseBaseUrl,
} from "./install-fuse-workerd.mjs";

describe("install-fuse-workerd", () => {
  it("pins the completed FUSE workerd release", () => {
    assert.equal(DEFAULT_VERSION, "1.20260610.0-fuse.2");
    assert.equal(
      releaseBaseUrl({ owner: "ghostwriternr", repo: "workerd", version: DEFAULT_VERSION }),
      "https://github.com/ghostwriternr/workerd/releases/download/v1.20260610.0-fuse.2",
    );
  });

  it("selects the release asset for supported platforms", () => {
    assert.equal(assetNameForPlatform("darwin", "arm64"), "workerd-darwin-arm64.gz");
    assert.equal(assetNameForPlatform("darwin", "x64"), "workerd-darwin-64.gz");
    assert.equal(assetNameForPlatform("linux", "x64"), "workerd-linux-64.gz");
    assert.throws(() => assetNameForPlatform("win32", "x64"), /Unsupported platform win32\/x64/u);
  });

  it("parses GitHub checksum asset contents", () => {
    assert.equal(
      parseChecksum("ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789  workerd.gz\n"),
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    );
    assert.throws(() => parseChecksum("not-a-digest"), /SHA-256/u);
  });
});
