#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { get } from "node:https";
import { arch, platform } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

export const DEFAULT_OWNER = "ghostwriternr";
export const DEFAULT_REPO = "workerd";
export const DEFAULT_VERSION = "1.20260610.0-fuse.2";
export const DEFAULT_OUTPUT = ".cache/workerd-fuse/workerd";

const USER_AGENT = "workspace-fuse-workerd-installer";

export async function installFuseWorkerd(options = {}) {
  const owner = options.owner ?? process.env.FUSE_WORKERD_OWNER ?? DEFAULT_OWNER;
  const repo = options.repo ?? process.env.FUSE_WORKERD_REPO ?? DEFAULT_REPO;
  const version = options.version ?? process.env.FUSE_WORKERD_VERSION ?? DEFAULT_VERSION;
  const output = resolve(options.output ?? process.env.FUSE_WORKERD_PATH ?? DEFAULT_OUTPUT);
  const target = options.target ?? targetForCurrentPlatform();
  const assetName = `workerd-${target}.gz`;
  const baseUrl = releaseBaseUrl({ owner, repo, version });
  const binaryUrl = `${baseUrl}/${assetName}`;
  const checksumUrl = `${binaryUrl}.sha256`;
  const tmpGz = `${output}.download.gz`;
  const tmpBinary = `${output}.download`;
  const checksumPath = `${output}.sha256`;

  await mkdir(dirname(output), { recursive: true });

  try {
    console.log(`Downloading ${assetName} from ${owner}/${repo}@v${version}...`);
    await download(binaryUrl, tmpGz);

    const expected = await fetchText(checksumUrl).then(parseChecksum);
    const actual = await sha256(tmpGz);
    if (actual !== expected) {
      throw new Error(`Checksum mismatch for ${assetName}: expected ${expected}, got ${actual}`);
    }

    await gunzip(tmpGz, tmpBinary);
    await chmod(tmpBinary, 0o755);
    await rename(tmpBinary, output);
    await writeFile(checksumPath, `${actual}  ${assetName}\n`);

    console.log(`Installed patched workerd to ${output}`);
    console.log("Use with:");
    console.log(`  MINIFLARE_WORKERD_PATH=${output}`);
    console.log("  WORKERD_LOCAL_DOCKER_ENABLE_FUSE=1");

    return { output, checksumPath, assetName, version };
  } finally {
    await rm(tmpGz, { force: true });
    await rm(tmpBinary, { force: true });
  }
}

export function releaseBaseUrl({ owner, repo, version }) {
  return `https://github.com/${owner}/${repo}/releases/download/v${version}`;
}

export function targetForCurrentPlatform() {
  return targetForPlatform(platform(), arch());
}

export function assetNameForPlatform(os, cpu) {
  return `workerd-${targetForPlatform(os, cpu)}.gz`;
}

export function targetForPlatform(os, cpu) {
  if (os === "darwin" && cpu === "arm64") return "darwin-arm64";
  if (os === "darwin" && cpu === "x64") return "darwin-64";
  if (os === "linux" && cpu === "x64") return "linux-64";

  throw new Error(
    `Unsupported platform ${os}/${cpu}. Supported targets: darwin-arm64, darwin-64, linux-64. ` +
      "On Windows, use WSL with the linux-64 asset.",
  );
}

export function parseChecksum(text) {
  const [checksum] = text.trim().split(/\s+/u);
  if (!/^[a-f0-9]{64}$/iu.test(checksum ?? "")) {
    throw new Error("Release checksum file did not contain a SHA-256 digest");
  }
  return checksum.toLowerCase();
}

function download(url, destination) {
  return new Promise((resolveDownload, rejectDownload) => {
    const request = get(url, { headers: { "User-Agent": USER_AGENT } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        download(response.headers.location, destination).then(resolveDownload, rejectDownload);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        rejectDownload(new Error(`GET ${url} failed with HTTP ${response.statusCode}`));
        return;
      }

      pipeline(response, createWriteStream(destination, { mode: 0o644 })).then(
        resolveDownload,
        rejectDownload,
      );
    });

    request.on("error", rejectDownload);
  });
}

function fetchText(url) {
  return new Promise((resolveText, rejectText) => {
    get(url, { headers: { "User-Agent": USER_AGENT } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        fetchText(response.headers.location).then(resolveText, rejectText);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        rejectText(new Error(`GET ${url} failed with HTTP ${response.statusCode}`));
        return;
      }

      response.setEncoding("utf8");
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolveText(body));
    }).on("error", rejectText);
  });
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function gunzip(source, destination) {
  return pipeline(
    createReadStream(source),
    createGunzip(),
    createWriteStream(destination, { mode: 0o755 }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  installFuseWorkerd().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
