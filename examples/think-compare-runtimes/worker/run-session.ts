import type { RunEvent } from "../shared/events";
import { applyRunMessage } from "../shared/run-messages";
import type { RunEventInput } from "./runs";

export { applyRunMessage };

export interface RunSession {
  runId: string;
  socketPath: string;
  events: RunEvent[];
}

export function createRunSession(createId: () => string = () => crypto.randomUUID()): RunSession {
  const id = createId();
  const runId = id.startsWith("compare-") ? id : `compare-${id}`;
  return {
    runId,
    socketPath: `/api/runs/compare-run/${runId}`,
    events: [],
  };
}

interface RunEventSinkOptions {
  runId: string;
  now?: () => string;
  initialEvents: RunEvent[];
  persist(events: RunEvent[]): Promise<void>;
  broadcast(message: string): void;
}

export class RunEventSink {
  #events: RunEvent[];
  #queue: Promise<unknown> = Promise.resolve();
  readonly #runId: string;
  readonly #now: () => string;
  readonly #persist: (events: RunEvent[]) => Promise<void>;
  readonly #broadcast: (message: string) => void;

  constructor({
    runId,
    now = () => new Date().toISOString(),
    initialEvents,
    persist,
    broadcast,
  }: RunEventSinkOptions) {
    this.#runId = runId;
    this.#now = now;
    this.#events = [...initialEvents].sort((left, right) => left.sequence - right.sequence);
    this.#persist = persist;
    this.#broadcast = broadcast;
  }

  get events(): RunEvent[] {
    return this.#events;
  }

  get runId(): string {
    return this.#runId;
  }

  record(input: RunEventInput): Promise<RunEvent> {
    return this.append(input);
  }

  async append(input: RunEventInput): Promise<RunEvent> {
    const append = this.#queue.then(() => this.#appendNow(input));
    this.#queue = append.catch(() => undefined);
    return append;
  }

  async reset(): Promise<void> {
    this.#events = [];
    await this.#persist(this.#events);
  }

  #appendNow(input: RunEventInput): Promise<RunEvent> {
    const event: RunEvent = {
      ...input,
      id: `${this.#runId}:${this.#events.length}`,
      runId: this.#runId,
      sequence: this.#events.length,
      timestamp: this.#now(),
    };
    this.#events = [...this.#events, event];
    return this.#persist(this.#events).then(() => {
      this.#broadcast(JSON.stringify({ type: "event", event }));
      return event;
    });
  }
}
