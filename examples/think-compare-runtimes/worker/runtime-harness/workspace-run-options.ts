import { Result } from "better-result";
import { Workspace, type WorkspaceBindingOptions, type WorkspaceCopy } from "@cloudflare/workspace";
import { connectArtifactsRepository } from "@cloudflare/workspace/source-adapter";
import { createWorkspaceDynamicWorkerRunner, type WorkspaceDynamicWorkerFileCapability, type WorkspaceDynamicWorkerLoader } from "@cloudflare/workspace-adapter-dynamic-worker";
import { attachWorkspaceCopyToSandbox, type WorkspaceSandboxClient, type WorkspaceSandboxMount } from "@cloudflare/workspace-adapter-sandbox";

import { fixtureFileEntries } from "../../shared/fixture";
import { createDurableSandboxWarmPool, type SandboxWarmPoolNamespace } from "../sandbox-warm-pool";
import type { StartComparisonRunOptions } from "../runs";
import { createWorkspaceRuntimeFactory, type WorkspaceRunLease, type WorkspaceRuntimeFactoryOptions } from "./workspace-runtime-factory";

const encoder = new TextEncoder();

export interface WorkspaceRunDependencyOptions extends WorkspaceRuntimeFactoryOptions {
  workspaceSandboxPool?: StartComparisonRunOptions["workspaceSandboxPool"];
}

export type WorkspaceRunBindingOptions = {
  artifacts: WorkspaceBindingOptions["artifacts"] & {
    create(name: string, options?: { description?: string; setDefaultBranch?: string }): Promise<unknown>;
  };
  objects: WorkspaceBindingOptions["objects"];
  dynamicWorkers: WorkspaceDynamicWorkerLoader;
  workspaceName?: string;
  sandboxPoolPrefix?: string;
  workspaceSandboxWarmPool?: SandboxWarmPoolNamespace;
  sandboxForLease(lease: WorkspaceRunLease): WorkspaceSandboxClient;
  workspaceForWorkingCopy?(workingCopyId: string): WorkspaceDynamicWorkerFileCapability;
};

const DEFAULT_WORKSPACE_NAME = "think-runtime-comparison";

export async function createWorkspaceRunOptionsFromBindings(
  options: WorkspaceRunBindingOptions,
): Promise<Pick<StartComparisonRunOptions, "createWorkspaceRuntime" | "workspaceSandboxPool">> {
  const workspaceName = options.workspaceName ?? DEFAULT_WORKSPACE_NAME;
  const workspace = Workspace.bind({ artifacts: options.artifacts, objects: options.objects }).get(workspaceName);
  await ensureWorkspaceRepository({ artifacts: options.artifacts, workspace, workspaceName });
  await seedCurrentWorkspaceFixture(workspace);

  const dynamicWorkerRunner = createWorkspaceDynamicWorkerRunner(options.dynamicWorkers);
  const mounts = new Map<string, Promise<WorkspaceSandboxMount>>();

  async function mountFor(copyId: string, lease: WorkspaceRunLease): Promise<WorkspaceSandboxMount> {
    const key = `${lease.id}:${copyId}`;
    let mount = mounts.get(key);
    if (!mount) {
      const pendingMount = (async () => {
        const copy = await workspace.copies.get(copyId);
        if (Result.isError(copy)) {
          throw new Error(copy.error.message);
        }
        const attached = await attachWorkspaceCopyToSandbox({
          copy: copy.value as WorkspaceCopy,
          sandbox: options.sandboxForLease(lease),
          path: "/workspace",
        });
        if (Result.isError(attached)) {
          throw new Error(attached.error.message);
        }
        return attached.value;
      })();
      mount = pendingMount.catch((error) => {
        if (mounts.get(key) === mount) {
          mounts.delete(key);
        }
        throw error;
      });
      mounts.set(key, mount);
    }
    return mount;
  }

  return createWorkspaceRunOptions({
    workspace,
    async runDynamicWorker(input) {
      const workspaceCapability = options.workspaceForWorkingCopy?.(input.copyId) ??
        input.workspace as WorkspaceDynamicWorkerFileCapability;
      const result = await dynamicWorkerRunner.run({
        code: input.code,
        workspace: workspaceCapability,
      });
      if (Result.isError(result)) {
        throw new Error(result.error.message);
      }
      return result.value;
    },
    async runShell(input) {
      const mount = await mountFor(input.copyId, input.lease);
      const result = await options.sandboxForLease(input.lease).exec(input.command, { cwd: mount.path });
      return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    },
    async captureShell(input) {
      const mount = await mountFor(input.copyId, input.lease);
      const captured = await mount.capture();
      if (Result.isError(captured)) {
        throw new Error(captured.error.message);
      }
    },
    workspaceSandboxPool: options.workspaceSandboxWarmPool
      ? createDurableSandboxWarmPool(
          options.workspaceSandboxWarmPool,
          options.sandboxPoolPrefix ?? `workspace-sandbox-${crypto.randomUUID()}`,
        )
      : createStaticSandboxPool(options.sandboxPoolPrefix ?? `workspace-sandbox-${crypto.randomUUID()}`, 2),
  });
}

export function createWorkspaceRunOptions(
  options: WorkspaceRunDependencyOptions,
): Pick<StartComparisonRunOptions, "createWorkspaceRuntime" | "workspaceSandboxPool"> {
  return {
    workspaceSandboxPool: options.workspaceSandboxPool ?? createStaticSandboxPool("workspace-sandbox", 2),
    createWorkspaceRuntime: createWorkspaceRuntimeFactory(options),
  };
}

async function ensureWorkspaceRepository(input: {
  artifacts: WorkspaceRunBindingOptions["artifacts"];
  workspace: Workspace;
  workspaceName: string;
}): Promise<void> {
  try {
    await input.artifacts.get(input.workspaceName);
    return;
  } catch (error) {
    if (!isArtifactsNotFound(error)) {
      throw error;
    }
  }

  const created = await input.artifacts.create(input.workspaceName, {
    description: `Workspace runtime comparison ${input.workspaceName}`,
    setDefaultBranch: "main",
  });
  const connected = await connectArtifactsRepository(input.workspace, {
    repository: artifactsRepositoryFrom(created),
    defaultBranch: "main",
  });
  if (Result.isError(connected)) {
    throw new Error(connected.error.message);
  }
}

async function seedCurrentWorkspaceFixture(workspace: Workspace): Promise<void> {
  for (const file of fixtureFileEntries()) {
    const written = await workspace.files.write(toAbsolutePath(file.path), encoder.encode(file.contents));
    if (Result.isError(written)) {
      throw new Error(written.error.message);
    }
  }
}

function artifactsRepositoryFrom(value: unknown): { remote?: string; defaultBranch?: string } {
  if (typeof value !== "object" || value === null) return {};
  const remote = (value as { remote?: unknown }).remote;
  const defaultBranch = (value as { defaultBranch?: unknown }).defaultBranch;
  return {
    ...(typeof remote === "string" ? { remote } : {}),
    ...(typeof defaultBranch === "string" ? { defaultBranch } : {}),
  };
}

function isArtifactsNotFound(error: unknown): boolean {
  if (typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown; code?: unknown }).name === "ArtifactsError" &&
    (error as { code?: unknown }).code === "NOT_FOUND") {
    return true;
  }

  return error instanceof Error && error.message.startsWith("ArtifactsError: Repository not found:");
}

function toAbsolutePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function createStaticSandboxPool(prefix: string, size: number): NonNullable<StartComparisonRunOptions["workspaceSandboxPool"]> {
  const available = Array.from({ length: size }, (_, index) => `${prefix}-${index}`);
  const leased = new Set<string>();

  return {
    async lease() {
      const id = available.shift();
      if (!id) throw new Error(`No warm sandboxes available for ${prefix}`);
      leased.add(id);
      return { id };
    },
    async release(lease) {
      if (!leased.delete(lease.id)) return;
      available.unshift(lease.id);
    },
  };
}
