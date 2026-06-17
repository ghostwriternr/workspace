import { useMemo, useState } from "react";

import type { RunEvent } from "../shared/events";
import { compareFixture, fixtureManifest } from "../shared/fixture";
import { buildDashboardModel } from "./dashboard-model";
import { startComparisonRunFromApi } from "./run-api";
import "./styles.css";

export function App() {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const dashboard = useMemo(() => buildDashboardModel(events, new Date().toISOString()), [events]);

  async function startRun() {
    setStarting(true);
    setError(null);
    try {
      const run = await startComparisonRunFromApi();
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
