import { useAgent } from "agents/react";
import {
  getToolInput,
  getToolOutput,
  getToolPartState,
  useAgentChat,
} from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { CodingAgentState } from "../agent/coding-agent";
import type { RepoState } from "../repo/state-controller";
import { UI_COPY } from "./ui-copy";
import "./styles.css";

const DEFAULT_WORKSPACE = "coding-demo";

type ImportStatus = { tone: "idle" | "ok" | "error"; message: string };
type RepoStateResult =
  | { status: "ok"; value: RepoState }
  | { status: "error"; error: { tag: string; message?: string } };
type EditActionResult =
  | { status: "ok"; value: unknown }
  | { status: "error"; error: { tag: string; message?: string } };
type ToolPart = Parameters<typeof getToolName>[0];

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
  const activeEditId = repo?.editCopyId ?? agent.state?.editCopyId;

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
  }, [workspaceName, lastImportKey, agent.state?.editCopyId]);

  async function applyEdit() {
    await runEditAction("applyEdit", "Applying edit to current Workspace files…", "Edit applied to current Workspace files.");
  }

  async function discardEdit() {
    await runEditAction("discardEdit", "Discarding edit copy…", "Edit copy discarded.");
  }

  async function runEditAction(method: "applyEdit" | "discardEdit", pending: string, done: string) {
    setStatus({ tone: "idle", message: pending });
    try {
      await agent.ready;
      const result = await agent.call(method) as EditActionResult;
      if (result.status === "error") {
        throw new Error(result.error.message ?? result.error.tag);
      }
      setRepo(await loadRepoState(agent));
      setStatus({ tone: "ok", message: done });
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Could not update edit copy." });
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
          <strong>{lastImport ? `${lastImport.source.owner}/${lastImport.source.repo}@${lastImport.source.ref}` : "none"}</strong>
          <code>{lastImport?.source.commitSha ?? "waiting for import"}</code>
        </div>
      </section>

      <section className="workspace-grid">
        <RepoFilesPanel
          files={repo?.files ?? []}
          activeEditId={activeEditId}
          onApplyEdit={applyEdit}
          onDiscardEdit={discardEdit}
        />
        <AgentChat agent={agent} onRepoState={setRepo} />
      </section>
    </main>
  );
}

function RepoFilesPanel({
  files,
  activeEditId,
  onApplyEdit,
  onDiscardEdit,
}: {
  files: RepoState["files"];
  activeEditId?: string;
  onApplyEdit(): void;
  onDiscardEdit(): void;
}) {
  return (
    <article className="panel files-panel">
      <div className="panel-heading">
        <p className="eyebrow">Passive state</p>
        <h2>{UI_COPY.filesTitle}</h2>
      </div>
      {activeEditId ? (
        <div className="edit-actions">
          <span>{UI_COPY.activeEditLabel}</span>
          <code>{activeEditId}</code>
          <button type="button" onClick={onApplyEdit}>{UI_COPY.applyEditAction}</button>
          <button type="button" className="secondary" onClick={onDiscardEdit}>{UI_COPY.discardEditAction}</button>
        </div>
      ) : null}
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

function AgentChat({
  agent,
  onRepoState,
}: {
  agent: ReturnType<typeof useAgent<CodingAgentState>>;
  onRepoState(repo: RepoState): void;
}) {
  const [input, setInput] = useState("");
  const timelineRef = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, status, isStreaming, clearHistory } = useAgentChat({ agent });

  useEffect(() => {
    timelineRef.current?.scrollTo({ top: timelineRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (status !== "ready" && status !== "error") return;
      try {
        await agent.ready;
        const repo = await loadRepoState(agent);
        if (!cancelled) onRepoState(repo);
      } catch {
        // The import panel reports initial connection/import errors; chat state refresh is opportunistic.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, agent.state?.editCopyId]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <article className="panel chat-panel">
      <div className="chat-header">
        <div>
          <p className="eyebrow">Chat / Agent activity timeline</p>
          <h2>{UI_COPY.chatTitle}</h2>
        </div>
        <button className="secondary" type="button" onClick={() => clearHistory()} disabled={isStreaming}>
          Clear chat
        </button>
      </div>
      <div ref={timelineRef} className="messages" aria-live="polite">
        {messages.length === 0 ? (
          <p className="empty">Ask the agent to inspect the repo or make a focused edit.</p>
        ) : (
          messages.map((message) => (
            <MessageView key={message.id} message={message} streaming={isStreaming && message === messages.at(-1)} />
          ))
        )}
      </div>
      <form className="chat-form" onSubmit={submit}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          placeholder={UI_COPY.chatPlaceholder}
          disabled={status !== "ready" && status !== "error"}
        />
        <button type="submit" disabled={!input.trim() || (status !== "ready" && status !== "error")}>Send</button>
      </form>
    </article>
  );
}

function MessageView({ message, streaming }: { message: UIMessage; streaming: boolean }) {
  return (
    <section className={`message ${message.role}`}>
      <div className="message-role">{message.role === "user" ? "You" : "Agent"}</div>
      <div className="parts">
        {message.parts.map((part, index) => {
          if (part.type === "text") {
            return part.text ? <p key={index} className="text-part">{part.text}</p> : null;
          }

          if (part.type === "reasoning") {
            return <ReasoningPart key={index} part={part} />;
          }

          if (isToolUIPart(part)) {
            return <ToolCard key={part.toolCallId ?? index} part={part} />;
          }

          return null;
        })}
        {streaming && <span className="cursor" aria-label="Agent is responding" />}
      </div>
    </section>
  );
}

function ReasoningPart({ part }: { part: Extract<UIMessage["parts"][number], { type: "reasoning" }> }) {
  return (
    <details className="reasoning" open={(part as { state?: string }).state === "streaming"}>
      <summary>Thinking</summary>
      <p>{part.text}</p>
    </details>
  );
}

function ToolCard({ part }: { part: ToolPart }) {
  const toolName = getToolName(part);
  const state = getToolPartState(part);
  const input = getToolInput(part);
  const output = getToolOutput(part);
  const error = "errorText" in part ? part.errorText : undefined;

  return (
    <article className={`tool-card ${state}`}>
      <div className="tool-row">
        <span className="tool-dot" />
        <strong>{toolTitle(toolName)}</strong>
        <span>{toolStatus(state)}</span>
      </div>
      {input != null && (
        <div className="tool-detail">
          <span>Tool call</span>
          <code>{formatToolPayload(toolName, input)}</code>
        </div>
      )}
      {output != null && (
        <div className="tool-detail result">
          <span>Tool result</span>
          <code>{formatValue(output)}</code>
        </div>
      )}
      {error && (
        <div className="tool-detail error">
          <span>Tool error</span>
          <code>{error}</code>
        </div>
      )}
    </article>
  );
}

function formatToolPayload(toolName: string, input: unknown) {
  if (toolName === "runDynamicWorker" && isRecord(input) && typeof input.code === "string") {
    return input.code;
  }

  return formatValue(input);
}

function formatValue(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function toolTitle(toolName: string) {
  return toolName.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

function toolStatus(state: ReturnType<typeof getToolPartState>) {
  switch (state) {
    case "complete":
      return "done";
    case "error":
      return "error";
    case "streaming":
    case "loading":
      return "running";
    case "waiting-approval":
      return "waiting";
    case "approved":
      return "approved";
    case "denied":
      return "denied";
  }
}

function parseRepoInput(value: string): { owner: string; repo: string } | undefined {
  const [owner, repo, extra] = value.trim().split("/");
  if (!owner || !repo || extra) {
    return undefined;
  }
  return { owner, repo };
}

async function loadRepoState(agent: ReturnType<typeof useAgent<CodingAgentState>>): Promise<RepoState> {
  const result = await agent.call("listRepoState") as RepoStateResult;
  if (result.status === "error") {
    throw new Error(result.error.message ?? result.error.tag);
  }
  return result.value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
