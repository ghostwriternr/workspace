// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { App } from "./App";

vi.mock("partysocket/react", () => ({
  usePartySocket: vi.fn(),
}));

describe("App", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("renders the rich comparison dashboard without fixture debug cards", () => {
    vi.stubGlobal("fetch", vi.fn());

    render(<App />);

    expect(screen.getByText("Workspace / Sandbox")).toBeTruthy();
    expect(screen.queryByText("Think Runtime Comparison")).toBeNull();
    expect(screen.queryByText("TASK")).toBeNull();
    expect(screen.getByRole("button", { name: "START RUN" })).toBeTruthy();

    const workspace = screen.getByLabelText("Workspace runtime wing");
    const sandbox = screen.getByLabelText("Sandbox runtime wing");

    expect(within(workspace).getByText("Workspace")).toBeTruthy();
    expect(within(workspace).getAllByText("Files").length).toBeGreaterThanOrEqual(1);
    expect(within(workspace).getAllByText("Dynamic Worker").length).toBeGreaterThanOrEqual(1);
    expect(within(workspace).getAllByText("Sandbox").length).toBeGreaterThanOrEqual(1);
    expect(within(workspace).queryByText("Workspace-backed")).toBeNull();

    expect(within(sandbox).getAllByText("Sandbox").length).toBeGreaterThanOrEqual(1);
    expect(within(sandbox).queryByText("Raw Sandbox")).toBeNull();
  });

  test("starts and stops a comparison run without exposing run IDs", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/runs/run-123/stop") return new Response(null, { status: 204 });
      return Response.json(
        {
          runId: "run-123",
          socketPath: "/api/runs/compare-run/run-123",
          events: [
            event({
              id: "run-123:0",
              runId: "run-123",
              sequence: 0,
              runtime: "both",
              kind: "run_started",
              title: "Comparison run started",
              detail: "Both agents are starting.",
              timestamp: new Date().toISOString(),
            }),
          ],
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "START RUN" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/runs", { method: "POST" }));
    expect(screen.queryByText("run-123")).toBeNull();

    const stopButton = await screen.findByRole("button", { name: "STOP RUN" });
    fireEvent.click(stopButton);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-123/stop", { method: "POST" }),
    );
    expect(screen.getByRole("button", { name: "START RUN" })).toBeTruthy();
  });

  test("updates running elapsed time while a run is active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-16T00:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      sessionWithEvents([
        event({ sequence: 0, runtime: "both", kind: "run_started", timestamp: "2026-06-16T00:00:00.000Z" }),
        event({ sequence: 1, runtime: "workspace", kind: "runtime_started", timestamp: "2026-06-16T00:00:00.000Z" }),
      ]),
    );

    render(<App />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "START RUN" }));
      await Promise.resolve();
    });

    act(() => {
      vi.setSystemTime(new Date("2026-06-16T00:00:01.000Z"));
      vi.advanceTimersByTime(1000);
    });

    expect(within(screen.getByLabelText("Workspace runtime wing")).getByText(/Running · 00:02/i)).toBeTruthy();
  });

  test("renders lanes, streamed thinking, commands, and Markdown final responses", async () => {
    vi.stubGlobal(
      "fetch",
      sessionWithEvents([
        event({ sequence: 0, runtime: "both", kind: "run_started", timestamp: "2026-06-16T00:00:00.000Z" }),
        event({ sequence: 1, runtime: "workspace", kind: "runtime_started", timestamp: "2026-06-16T00:00:01.000Z" }),
        event({
          sequence: 2,
          runtime: "workspace",
          kind: "agent_tool_call",
          title: "Think requested read",
          detail: JSON.stringify({ path: "/README.md" }),
          timestamp: "2026-06-16T00:00:02.000Z",
        }),
        event({
          sequence: 3,
          runtime: "workspace",
          kind: "agent_message_delta",
          title: "Think response stream",
          detail: "Reading the fixture before editing.",
          timestamp: "2026-06-16T00:00:03.000Z",
        }),
        event({
          sequence: 4,
          runtime: "workspace",
          kind: "agent_tool_result",
          title: "Think shell result",
          detail: JSON.stringify({
            command: "npm run check",
            cwd: "/workspace",
            executionTarget: "workspace-sandbox",
            exitCode: 0,
            stdout: "docs check passed",
            stderr: "",
          }),
          timestamp: "2026-06-16T00:00:05.000Z",
        }),
        event({
          sequence: 5,
          runtime: "workspace",
          kind: "agent_message",
          title: "Think turn complete",
          detail: "## Summary\n\nUpdated `docs/smart-request-policies.md`.",
          timestamp: "2026-06-16T00:00:06.000Z",
        }),
        event({ sequence: 6, runtime: "sandbox", kind: "runtime_started", timestamp: "2026-06-16T00:00:01.000Z" }),
        event({
          sequence: 7,
          runtime: "sandbox",
          kind: "agent_tool_result",
          title: "Think shell result",
          detail: JSON.stringify({
            command: "npm run check",
            cwd: "/workspace",
            executionTarget: "raw-sandbox",
            exitCode: 0,
            stdout: "docs check passed",
            stderr: "",
          }),
          timestamp: "2026-06-16T00:00:06.000Z",
        }),
      ]),
    );

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "START RUN" }));

    const workspace = await screen.findByLabelText("Workspace runtime wing");
    const sandbox = screen.getByLabelText("Sandbox runtime wing");

    expect(within(workspace).getByLabelText("workspace substrate timeline")).toBeTruthy();
    expect(await within(workspace).findByText("Reading the fixture before editing.")).toBeTruthy();
    expect(within(workspace).getByText("$ npm run check")).toBeTruthy();
    expect(within(workspace).getAllByText("Workspace Sandbox").length).toBeGreaterThanOrEqual(1);
    expect(within(workspace).getByText("exit 0")).toBeTruthy();
    expect(within(workspace).getByRole("heading", { name: "Summary" })).toBeTruthy();
    expect(within(workspace).getByText("docs/smart-request-policies.md")).toBeTruthy();

    expect(within(sandbox).getByLabelText("sandbox substrate timeline")).toBeTruthy();
    expect(within(sandbox).getByText("$ npm run check")).toBeTruthy();
    expect(within(sandbox).getAllByText("raw Sandbox").length).toBeGreaterThanOrEqual(1);
  });

  test("renders completed status and capacity failure hints", async () => {
    vi.stubGlobal(
      "fetch",
      sessionWithEvents([
        event({ sequence: 0, runtime: "both", kind: "run_started", timestamp: "2026-06-16T00:00:00.000Z" }),
        event({ sequence: 1, runtime: "workspace", kind: "runtime_started", timestamp: "2026-06-16T00:00:01.000Z" }),
        event({ sequence: 2, runtime: "workspace", kind: "runtime_completed", title: "Workspace runtime completed", timestamp: "2026-06-16T00:02:51.000Z" }),
        event({ sequence: 3, runtime: "sandbox", kind: "runtime_started", timestamp: "2026-06-16T00:00:02.000Z" }),
        event({
          sequence: 4,
          runtime: "sandbox",
          kind: "runtime_failed",
          title: "Sandbox runtime failed",
          detail: "3040: Capacity temporarily exceeded, please try again.",
          timestamp: "2026-06-16T00:03:42.000Z",
        }),
        event({ sequence: 5, runtime: "both", kind: "run_completed", title: "Comparison run complete", timestamp: "2026-06-16T00:03:42.000Z" }),
      ]),
    );

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "START RUN" }));

    expect(await within(screen.getByLabelText("Workspace runtime wing")).findByText(/Completed · 02:50/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "RUN AGAIN" })).toBeTruthy();

    const sandbox = screen.getByLabelText("Sandbox runtime wing");
    expect(within(sandbox).getByText(/Failed · 03:40/i)).toBeTruthy();
    expect(within(sandbox).getByText("Upstream model capacity; retry later.")).toBeTruthy();
  });
});

function sessionWithEvents(events: ReturnType<typeof event>[]) {
  return vi.fn(async () =>
    Response.json(
      {
        runId: "run-456",
        socketPath: "/api/runs/compare-run/run-456",
        events,
      },
      { status: 201 },
    ),
  );
}

function event(overrides: Partial<import("../shared/events").RunEvent>) {
  return {
    id: `run-1:${overrides.sequence ?? 0}`,
    runId: "run-1",
    sequence: overrides.sequence ?? 0,
    runtime: overrides.runtime ?? "both",
    kind: overrides.kind ?? "run_started",
    title: overrides.title ?? "Event",
    detail: overrides.detail ?? "Detail",
    timestamp: overrides.timestamp ?? "1970-01-01T00:00:00.000Z",
    ...overrides,
  } as import("../shared/events").RunEvent;
}
