import type { RuntimeId } from "../../shared/events";
import type { RunEventInput } from "../runs";
import type { RuntimeThinkToolRecorder } from "./runtime-tools";

export interface RuntimeEventStreamer {
  recordRuntimeEvent(input: RunEventInput): Promise<void>;
}

export class RuntimeAgentRecorder implements RuntimeThinkToolRecorder {
  readonly events: RunEventInput[] = [];
  #queue: Promise<unknown> = Promise.resolve();
  #streamError: unknown;

  constructor(
    private readonly defaultRuntime: RuntimeId,
    private readonly streamer?: RuntimeEventStreamer,
  ) {}

  record(input: RunEventInput): RunEventInput {
    const event = { ...input, runtime: input.runtime ?? this.defaultRuntime };
    this.events.push(event);

    if (this.streamer) {
      this.#queue = this.#queue
        .then(() => this.streamer?.recordRuntimeEvent(event))
        .catch((error) => {
          this.#streamError ??= error;
        });
    }

    return event;
  }

  async flush(): Promise<void> {
    await this.#queue;
    if (this.#streamError) throw this.#streamError;
  }
}
