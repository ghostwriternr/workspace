export type WorkspaceSelection = {
  activeWorkspaceName: string;
  draftWorkspaceName: string;
};

export type WorkspaceActivationResult =
  | { status: "ok"; value: WorkspaceSelection }
  | { status: "error"; message: string };

export function updateDraftWorkspaceName(selection: WorkspaceSelection, draftWorkspaceName: string): WorkspaceSelection {
  return { ...selection, draftWorkspaceName };
}

export function activateDraftWorkspaceName(selection: WorkspaceSelection): WorkspaceActivationResult {
  const workspaceName = selection.draftWorkspaceName.trim();
  if (!workspaceName) {
    return { status: "error", message: "Workspace name is required." };
  }

  return {
    status: "ok",
    value: {
      activeWorkspaceName: workspaceName,
      draftWorkspaceName: workspaceName,
    },
  };
}
