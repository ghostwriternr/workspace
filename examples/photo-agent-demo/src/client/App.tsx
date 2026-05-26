import { useAgent } from "agents/react";
import {
  getToolInput,
  getToolOutput,
  getToolPartState,
  useAgentChat,
} from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { PhotoState } from "../photo/draft-controller";

type PhotoAgentState = {
  draftEditId?: string;
  photo?: PhotoState;
};

type ImageState = PhotoState["original"] | PhotoState["current"] | PhotoState["draft"];

type UploadStatus = { tone: "idle" | "ok" | "error"; message: string };

type ToolPart = Parameters<typeof getToolName>[0];

const DEFAULT_WORKSPACE = "manual-demo";

export function App() {
  const [workspaceDraft, setWorkspaceDraft] = useState(DEFAULT_WORKSPACE);
  const [workspaceName, setWorkspaceName] = useState(DEFAULT_WORKSPACE);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({ tone: "idle", message: "Choose an image to begin." });

  const agent = useAgent<PhotoAgentState>({
    agent: "PhotoAgent",
    name: workspaceName,
  });

  const photo = agent.state?.photo;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await agent.ready;
        if (!cancelled) {
          await agent.call("refreshPhotoState");
        }
      } catch (error) {
        if (!cancelled) {
          setUploadStatus({
            tone: "error",
            message: error instanceof Error ? error.message : "Could not load Workspace state.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceName]);

  async function uploadOriginal(file: File) {
    setUploadStatus({ tone: "idle", message: "Uploading original…" });
    const response = await fetch(originalUrl(workspaceName), {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: await file.arrayBuffer(),
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(body.error || `Upload failed with ${response.status}`);
    }

    setUploadStatus({ tone: "ok", message: "Original uploaded. Tell the agent what to change." });
  }

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Cloudflare Workspace × Think × Sandbox</p>
          <h1>Chat edits. Workspace remembers.</h1>
        </div>
        <p>
          Upload gives the agent bytes. From there, edits happen through conversation:
          draft previews update passively, and only “make this current” publishes the draft.
        </p>
      </header>

      <section className="setup-card" aria-label="Upload and workspace name">
        <form
          className="workspace-form"
          onSubmit={(event) => {
            event.preventDefault();
            setWorkspaceName(normalizeWorkspaceName(workspaceDraft));
            setUploadStatus({ tone: "idle", message: "Workspace selected." });
          }}
        >
          <label htmlFor="workspace-name">Workspace name</label>
          <div className="inline-controls">
            <input
              id="workspace-name"
              value={workspaceDraft}
              onChange={(event) => setWorkspaceDraft(event.currentTarget.value)}
              spellCheck={false}
            />
            <button type="submit">Connect</button>
          </div>
        </form>

        <ImageUpload onUpload={uploadOriginal} status={uploadStatus} />
      </section>

      <section className="preview-grid" aria-label="Passive previews">
        <PreviewCard
          title="Original"
          image={photo?.original}
          url={originalUrl(workspaceName)}
          empty="Upload a PNG or JPEG"
        />
        <PreviewCard
          title="Draft edit"
          image={photo?.draft}
          url={draftUrl(workspaceName)}
          empty="Ask for an edit"
        />
        <PreviewCard
          title="Current"
          image={photo?.current}
          url={currentUrl(workspaceName)}
          empty="Say “make this current”"
        />
      </section>

      <section className="chat-zone" aria-label="Chat and agent activity timeline">
        <AgentChat key={workspaceName} agent={agent} />
        <details className="state-drawer">
          <summary>Workspace state</summary>
          <pre>{JSON.stringify(photo ?? { workspaceName, status: "waiting for agent state" }, null, 2)}</pre>
        </details>
      </section>
    </main>
  );
}

function ImageUpload({ onUpload, status }: { onUpload(file: File): Promise<void>; status: UploadStatus }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [localStatus, setLocalStatus] = useState(status);

  useEffect(() => setLocalStatus(status), [status]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setLocalStatus({ tone: "error", message: "Choose a PNG or JPEG first." });
      return;
    }

    setBusy(true);
    try {
      await onUpload(file);
    } catch (error) {
      setLocalStatus({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="upload-form" onSubmit={submit}>
      <label htmlFor="photo-file">Photo upload</label>
      <div className="inline-controls file-row">
        <input
          id="photo-file"
          type="file"
          accept="image/png,image/jpeg"
          onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
        />
        <button type="submit" disabled={busy}>Upload original</button>
      </div>
      <p className={`status ${localStatus.tone}`}>{localStatus.message}</p>
    </form>
  );
}

function PreviewCard({ title, image, url, empty }: { title: string; image?: ImageState; url: string; empty: string }) {
  const cacheKey = image?.exists ? `${image.path}:${image.bytes}:${image.updatedAt ?? ""}` : undefined;
  const objectUrl = usePreviewObjectUrl(image?.exists ? `${url}?v=${encodeURIComponent(cacheKey ?? "")}` : undefined, cacheKey);

  return (
    <article className="preview-card">
      <div className="preview-title">
        <h2>{title}</h2>
        <span>{image?.exists ? `${formatBytes(image.bytes)} · ready` : "empty"}</span>
      </div>
      {objectUrl ? <img src={objectUrl} alt={`${title} preview`} /> : <div className="empty-preview">{empty}</div>}
    </article>
  );
}

function usePreviewObjectUrl(url: string | undefined, cacheKey: string | undefined) {
  const [objectUrl, setObjectUrl] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    let nextObjectUrl: string | undefined;

    if (!url || !cacheKey) {
      setObjectUrl(undefined);
      return undefined;
    }

    void (async () => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok || cancelled) return;
      nextObjectUrl = URL.createObjectURL(await response.blob());
      if (!cancelled) setObjectUrl(nextObjectUrl);
    })();

    return () => {
      cancelled = true;
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [url, cacheKey]);

  return objectUrl;
}

function AgentChat({ agent }: { agent: ReturnType<typeof useAgent<PhotoAgentState>> }) {
  const [input, setInput] = useState("");
  const timelineRef = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, status, isStreaming, clearHistory } = useAgentChat({ agent });

  useEffect(() => {
    timelineRef.current?.scrollTo({ top: timelineRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <article className="chat-card">
      <div className="chat-header">
        <div>
          <p className="eyebrow">Chat / Agent activity timeline</p>
          <h2>Photo agent</h2>
        </div>
        <button className="secondary" type="button" onClick={() => clearHistory()} disabled={isStreaming}>
          Clear chat
        </button>
      </div>

      <div ref={timelineRef} className="timeline" aria-live="polite">
        {messages.length === 0 ? (
          <div className="empty-chat">
            Try “make this look like an old newspaper photo”, then “make it current” or “throw away the draft”.
          </div>
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
          placeholder="Describe the edit you want…"
          disabled={status !== "ready" && status !== "error"}
        />
        <button type="submit" disabled={!input.trim() || (status !== "ready" && status !== "error")}>
          Send to agent
        </button>
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
  if (toolName === "runWorkspaceCommand" && isRecord(input) && typeof input.command === "string") {
    return input.command;
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

function normalizeWorkspaceName(name: string) {
  return name.trim() || DEFAULT_WORKSPACE;
}

function originalUrl(workspaceName: string) {
  return `/api/workspaces/${encodeURIComponent(workspaceName)}/photos/original`;
}

function draftUrl(workspaceName: string) {
  return `/api/workspaces/${encodeURIComponent(workspaceName)}/photos/draft`;
}

function currentUrl(workspaceName: string) {
  return `/api/workspaces/${encodeURIComponent(workspaceName)}/photos/current`;
}

async function readJson(response: Response): Promise<{ error?: string }> {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
