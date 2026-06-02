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
import { loadRepoState } from "./repo-state";

type ToolPart = Parameters<typeof getToolName>[0];
type CodingAgentClient = ReturnType<typeof useAgent<CodingAgentState>>;

export function AgentChat({
  agent,
  onRepoState,
}: {
  agent: CodingAgentClient;
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
  }, [status, agent.state?.workingCopyId]);

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
  if (toolName === "run" && isRecord(input) && typeof input.code === "string") {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
