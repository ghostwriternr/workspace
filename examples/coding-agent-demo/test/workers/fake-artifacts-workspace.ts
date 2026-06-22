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
  const { artifacts, driver, object } = createFakeArtifacts({ [workspaceName]: tree });
  void object.recordCurrentRepository({
    repository: workspaceName,
    remote: `https://git.example/${workspaceName}.git`,
    defaultBranch: "main",
  });
  return {
    artifacts,
    driver,
    object,
    workspaceName,
    workspace: Workspace.bind({ artifacts, objects: { getByName: () => object } }).get(workspaceName),
  };
}

export { resetFakeArtifactsWorkspace };
