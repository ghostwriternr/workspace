import { useAgent } from "agents/react";
import { useEffect, useState, type FormEvent } from "react";

import type { CodingAgentState } from "../agent/coding-agent";
import type { RepoState } from "../repo/state-controller";
import { UI_COPY } from "./ui-copy";
import "./styles.css";

const DEFAULT_WORKSPACE = "coding-demo";

type ImportStatus = { tone: "idle" | "ok" | "error"; message: string };
type RepoStateResult =
  | { status: "ok"; value: RepoState }
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
  const lastImportKey = lastImport?.revisionId;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await agent.ready;
        if (!cancelled) {
          setRepo(await loadRepoState(agent, "refreshRepoState"));
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
  }, [workspaceName, lastImportKey]);

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

    setRepo(await loadRepoState(agent, "refreshRepoState"));
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
          <strong>{lastImport ? `${lastImport.source.owner}/${lastImport.source.repo}@${lastImport.source.ref}` : "none"}</strong>
          <code>{lastImport?.source.commitSha ?? "waiting for import"}</code>
        </div>
      </section>

      <section className="workspace-grid">
        <RepoFilesPanel files={repo?.files ?? []} />
        <AgentChat agent={agent} />
      </section>
    </main>
  );
}

function RepoFilesPanel({ files }: { files: RepoState["files"] }) {
  return (
    <article className="panel files-panel">
      <div className="panel-heading">
        <p className="eyebrow">Passive state</p>
        <h2>{UI_COPY.filesTitle}</h2>
      </div>
      {files.length === 0 ? (
        <p className="empty">No repository files imported yet.</p>
      ) : (
        <ol className="file-list">
          {files.map((file) => (
            <li key={file.path}>
              <span className={file.type}>{file.type === "directory" ? "dir" : "file"}</span>
              <code>{file.path}</code>
              <small>{file.type}</small>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

type ChatMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
};

function AgentChat({ agent }: { agent: ReturnType<typeof useAgent<CodingAgentState>> }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;

    setInput("");
    setBusy(true);
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text }]);
    try {
      const repo = await loadRepoState(agent, "listRepoState");
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "agent",
          text: repo.files.length === 0
            ? "No files are imported yet."
            : `Workspace has ${repo.files.length} entries. The first files are ${repo.files.slice(0, 8).map((file) => file.path).join(", ")}.`,
        },
      ]);
    } catch (error) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "agent",
        text: error instanceof Error ? error.message : "Could not read repo state.",
      }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="panel chat-panel">
      <div className="panel-heading">
        <p className="eyebrow">Chat</p>
        <h2>{UI_COPY.chatTitle}</h2>
      </div>
      <div className="messages" aria-live="polite">
        {messages.length === 0 ? (
          <p className="empty">Ask “what files are in this repo?” after import.</p>
        ) : (
          messages.map((message) => (
            <section key={message.id} className={`message ${message.role}`}>
              <strong>{message.role === "user" ? "You" : "Agent"}</strong>
              <p>{message.text}</p>
            </section>
          ))
        )}
      </div>
      <form className="chat-form" onSubmit={submit}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          placeholder={UI_COPY.chatPlaceholder}
          disabled={busy}
        />
        <button type="submit" disabled={!input.trim() || busy}>Send</button>
      </form>
    </article>
  );
}

function parseRepoInput(value: string): { owner: string; repo: string } | undefined {
  const [owner, repo, extra] = value.trim().split("/");
  if (!owner || !repo || extra) {
    return undefined;
  }
  return { owner, repo };
}

async function loadRepoState(
  agent: ReturnType<typeof useAgent<CodingAgentState>>,
  method: "listRepoState" | "refreshRepoState",
): Promise<RepoState> {
  const result = await agent.call(method) as RepoStateResult;
  if (result.status === "error") {
    throw new Error(result.error.message ?? result.error.tag);
  }
  return result.value;
}
