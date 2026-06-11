import { Result, type Result as BetterResult } from "better-result";

export type WorkspaceRuntimeMountDescriptor = {
  copyId: string;
  remote: string;
  baseRef: string;
  ref: string;
};

export type WorkspaceRuntimeMountError = {
  tag: "WorkspaceRuntimeMountUnavailableError";
  message: string;
};

type RuntimeMountProvider = () => Promise<BetterResult<WorkspaceRuntimeMountDescriptor, WorkspaceRuntimeMountError>>;

const runtimeMountProviders = new WeakMap<object, RuntimeMountProvider>();

export function registerWorkspaceCopyRuntimeMount(copy: object, provider: RuntimeMountProvider): void {
  runtimeMountProviders.set(copy, provider);
}

export async function workspaceCopyRuntimeMount(copy: object): Promise<BetterResult<WorkspaceRuntimeMountDescriptor, WorkspaceRuntimeMountError>> {
  const provider = runtimeMountProviders.get(copy);
  if (!provider) {
    return Result.err({
      tag: "WorkspaceRuntimeMountUnavailableError",
      message: "Workspace copy does not expose a runtime mount descriptor.",
    });
  }

  return provider();
}
