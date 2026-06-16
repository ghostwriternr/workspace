import { useAgent } from "agents/react";

import type { CodingAgentState } from "../agent/coding-agent";
import type { RepoDirectoryState, RepoState } from "../repo/state-controller";

type RepoStateResult =
  | { status: "ok"; value: RepoState }
  | { status: "error"; error: { tag: string; message?: string } };

type RepoDirectoryResult =
  | { status: "ok"; value: RepoDirectoryState }
  | { status: "error"; error: { tag: string; message?: string } };

export async function loadRepoState(agent: ReturnType<typeof useAgent<CodingAgentState>>): Promise<RepoState> {
  const result = await agent.call("getRepoState") as RepoStateResult;
  if (result.status === "error") {
    throw new Error(result.error.message ?? result.error.tag);
  }
  return result.value;
}

export async function loadDirectoryState(
  agent: ReturnType<typeof useAgent<CodingAgentState>>,
  path = "/",
): Promise<RepoDirectoryState> {
  const result = await agent.call("listDirectory", [{ path }]) as RepoDirectoryResult;
  if (result.status === "error") {
    throw new Error(result.error.message ?? result.error.tag);
  }
  return result.value;
}
