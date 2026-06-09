import { useAgent } from "agents/react";
import { useEffect, useState, type FormEvent } from "react";

import type { CodingAgentState } from "../agent/coding-agent";
import type { RepoState } from "../repo/state-controller";
import { AgentChat } from "./agent-chat";
import { RepoFilesPanel } from "./repo-files-panel";
import { loadRepoState } from "./repo-state";
import { UI_COPY } from "./ui-copy";
import "./styles.css";

const DEFAULT_WORKSPACE = "coding-demo";

type ImportStatus = { tone: "idle" | "ok" | "error"; message: string };
type WorkingCopyActionResult =
  | { status: "ok"; value: unknown }
  | { status: "error"; error: { tag: string; message?: string } };

export function App() {
  const [workspaceName, setWorkspaceName] = useState(DEFAULT_WORKSPACE);
  const [repoInput, setRepoInput] = useState("cloudflare/workspace");
  const [refInput, setRefInput] = useState("");
  const [status, setStatus] = useState<ImportStatus>({ tone: "idle", message: "Import a public GitHub repo to begin." });
  const [repo, setRepo] = useState<RepoState>();

  const agent = useAgent<CodingAgentState>({
    agent: "CodingAgent",
    name: workspaceName,
  });
  const lastImport = agent.state?.lastImport;
  const lastImportKey = lastImport?.capture.id;
  const activeWorkingCopyId = repo?.workingCopyId ?? agent.state?.workingCopyId;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await agent.ready;
        if (!cancelled) {
          setRepo(await loadRepoState(agent));
        }
      } catch (error) {
        if (!cancelled) {
          setStatus({ tone: "error", message: error instanceof Error ? error.message : "Could not load repo state." });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceName, lastImportKey, agent.state?.workingCopyId]);

  async function applyWorkingCopy() {
    await runWorkingCopyAction("applyWorkingCopy", "Applying working copy to current Workspace files…", "Working copy applied to current Workspace files.");
  }

  async function discardWorkingCopy() {
    await runWorkingCopyAction("discardWorkingCopy", "Discarding working copy…", "Working copy discarded.");
  }

  async function runWorkingCopyAction(method: "applyWorkingCopy" | "discardWorkingCopy", pending: string, done: string) {
    setStatus({ tone: "idle", message: pending });
    try {
      await agent.ready;
      const result = await agent.call(method) as WorkingCopyActionResult;
      if (result.status === "error") {
        throw new Error(result.error.message ?? result.error.tag);
      }
      setRepo(await loadRepoState(agent));
      setStatus({ tone: "ok", message: done });
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Could not update working copy." });
    }
  }

  async function importRepo(event: FormEvent) {
    event.preventDefault();
    const parsed = parseRepoInput(repoInput);
    if (!parsed) {
      setStatus({ tone: "error", message: "Use owner/repo, for example cloudflare/workers-sdk." });
      return;
    }

    setStatus({ tone: "idle", message: "Importing repository into Workspace…" });
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceName)}/imports/github`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...parsed, ref: refInput.trim() || undefined }),
    });
    const body = await response.json() as { error?: { message?: string }; message?: string };
    if (!response.ok) {
      setStatus({ tone: "error", message: body.error?.message ?? body.message ?? `Import failed with ${response.status}` });
      return;
    }

    setRepo(await loadRepoState(agent));
    setStatus({ tone: "ok", message: "Repository imported into current Workspace files." });
  }

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">{UI_COPY.eyebrow}</p>
        <h1>{UI_COPY.title}</h1>
        <p>{UI_COPY.subtitle}</p>
      </header>

      <section className="panel import-panel" aria-label="Import public GitHub repository">
        <form onSubmit={importRepo}>
          <label htmlFor="workspace-name">Workspace name</label>
          <input
            id="workspace-name"
            value={workspaceName}
            onChange={(event) => setWorkspaceName(event.currentTarget.value)}
            spellCheck={false}
          />

          <label htmlFor="repo-input">{UI_COPY.importLabel}</label>
          <div className="inline-controls">
            <input
              id="repo-input"
              value={repoInput}
              onChange={(event) => setRepoInput(event.currentTarget.value)}
              placeholder={UI_COPY.importPlaceholder}
              spellCheck={false}
            />
            <input
              aria-label="GitHub ref"
              value={refInput}
              onChange={(event) => setRefInput(event.currentTarget.value)}
              placeholder={UI_COPY.refPlaceholder}
              spellCheck={false}
            />
            <button type="submit">{UI_COPY.importAction}</button>
          </div>
          <p className={`status ${status.tone}`}>{status.message}</p>
        </form>
        <div className="import-meta">
          <span>Last import</span>
          <strong>{lastImport ? `${lastImport.source.owner}/${lastImport.source.repo}@${lastImport.source.requestedRef ?? "default"}` : "none"}</strong>
          <code>{lastImport?.capture.id ?? "waiting for import"}</code>
        </div>
      </section>

      <section className="workspace-grid">
        <RepoFilesPanel
          files={repo?.files ?? []}
          activeWorkingCopyId={activeWorkingCopyId}
          onApplyWorkingCopy={applyWorkingCopy}
          onDiscardWorkingCopy={discardWorkingCopy}
        />
        <AgentChat agent={agent} onRepoState={setRepo} />
      </section>
    </main>
  );
}

function parseRepoInput(value: string): { owner: string; repo: string } | undefined {
  const [owner, repo, extra] = value.trim().split("/");
  if (!owner || !repo || extra) {
    return undefined;
  }
  return { owner, repo };
}
