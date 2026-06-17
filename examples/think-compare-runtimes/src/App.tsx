import { usePartySocket } from "partysocket/react";
import { useMemo, useRef, useState } from "react";

import type { RunEvent } from "../shared/events";
import { compareFixture, fixtureManifest } from "../shared/fixture";
import { applyRunMessage, type RunMessage } from "../shared/run-messages";
import { buildDashboardModel } from "./dashboard-model";
import { startComparisonRunFromApi } from "./run-api";
import "./styles.css";

export function App() {
  const [runId, setRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const activeRunIdRef = useRef<string | null>(null);
  const dashboard = useMemo(() => buildDashboardModel(events, new Date().toISOString()), [events]);

  usePartySocket({
    prefix: "api/runs",
    party: "compare-run",
    room: runId ?? "idle",
    enabled: runId !== null,
    onMessage(message) {
      const parsed = JSON.parse(String(message.data)) as RunMessage;
      const activeRunId = activeRunIdRef.current;
      if (!activeRunId || !messageBelongsToRun(parsed, activeRunId)) return;
      setEvents((current) => applyRunMessage(current, parsed));
    },
  });

  async function startRun() {
    activeRunIdRef.current = null;
    setRunId(null);
    setEvents([]);
    setStarting(true);
    setError(null);
    try {
      const run = await startComparisonRunFromApi();
      activeRunIdRef.current = run.runId;
      setRunId(run.runId);
      setEvents(run.events);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setStarting(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="eyebrow">Fixed-task demo</p>
        <h1>Think Runtime Comparison</h1>
        <p className="hero-copy">
          Same task. Same model. Same project path. Similar coding tools. Different state
          authority.
        </p>
        <button className="start-button" type="button" onClick={() => void startRun()} disabled={starting}>
          {starting ? "Starting…" : dashboard.run.actionLabel}
        </button>
        {runId ? <p className="run-id">Run {runId}</p> : null}
        {error ? <p className="error-banner">{error}</p> : null}
      </header>

      <section className="task-card" aria-labelledby="task-title">
        <div>
          <p className="eyebrow">Task</p>
          <h2 id="task-title">{compareFixture.task.title}</h2>
          <p>{compareFixture.task.brief}</p>
        </div>
        <pre>{fixtureManifest()}</pre>
      </section>

      <section className="runtime-grid" aria-label="Runtime comparison">
        <RuntimeWing
          title="Workspace-backed"
          subtitle="@cloudflare/workspace + Dynamic Workers + Sandbox SDK"
          status={dashboard.runtimes.workspace.status}
          container={dashboard.runtimes.workspace.container}
          bullets={[
            "Workspace is the durable file authority",
            "Dynamic Workers run lightweight JavaScript",
            "Sandbox SDK provides shell execution when needed",
          ]}
        />
        <RuntimeWing
          title="Raw Sandbox"
          subtitle="@cloudflare/sandbox"
          status={dashboard.runtimes.sandbox.status}
          container={dashboard.runtimes.sandbox.container}
          bullets={[
            "Sandbox filesystem is the working environment",
            "File tools call Sandbox file APIs directly",
            "Shell commands run in the same runtime-local state",
          ]}
        />
      </section>
    </main>
  );
}

interface RuntimeWingProps {
  title: string;
  subtitle: string;
  status: string;
  container: string;
  bullets: string[];
}

function RuntimeWing({ title, subtitle, status, container, bullets }: RuntimeWingProps) {
  return (
    <article className="runtime-wing">
      <div>
        <p className="eyebrow">Runtime</p>
        <h2>{title}</h2>
        <p className="subtitle">{subtitle}</p>
      </div>
      <dl className="telemetry-grid">
        <div>
          <dt>Status</dt>
          <dd>{status}</dd>
        </div>
        <div>
          <dt>Sandbox</dt>
          <dd>{container}</dd>
        </div>
      </dl>
      <ul>
        {bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
    </article>
  );
}

function messageBelongsToRun(message: RunMessage, runId: string): boolean {
  if (message.type === "event") return message.event.runId === runId;
  return message.events.every((event) => event.runId === runId);
}
