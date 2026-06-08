import { Workspace } from "@cloudflare/workspace";
import {
  createFakeArtifacts,
  resetFakeArtifacts as resetFakeArtifactsWorkspace,
  type FakeArtifacts,
  type Tree,
} from "@cloudflare/workspace/testing";

export type FakeArtifactsWorkspace = FakeArtifacts & {
  workspaceName: string;
  workspace: Workspace;
};

export function createFakeArtifactsWorkspace(tree: Tree = {}): FakeArtifactsWorkspace {
  const workspaceName = `repo-${crypto.randomUUID()}`;
  const { artifacts, driver } = createFakeArtifacts({ [workspaceName]: tree });
  return {
    artifacts,
    driver,
    workspaceName,
    workspace: Workspace.fromArtifacts(artifacts, workspaceName),
  };
}

export { resetFakeArtifactsWorkspace };
