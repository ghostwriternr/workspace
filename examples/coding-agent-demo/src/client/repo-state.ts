import { useAgent } from "agents/react";

import type { CodingAgentState } from "../agent/coding-agent";
import type { RepoState } from "../repo/state-controller";

type RepoStateResult =
  | { status: "ok"; value: RepoState }
  | { status: "error"; error: { tag: string; message?: string } };

export async function loadRepoState(agent: ReturnType<typeof useAgent<CodingAgentState>>): Promise<RepoState> {
  const result = await agent.call("listRepoState") as RepoStateResult;
  if (result.status === "error") {
    throw new Error(result.error.message ?? result.error.tag);
  }
  return result.value;
}
