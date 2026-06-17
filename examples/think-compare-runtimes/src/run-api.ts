import type { RunEvent } from "../shared/events";

export interface ComparisonRunResponse {
  id: string;
  events: RunEvent[];
}

export async function startComparisonRunFromApi(
  fetcher: typeof fetch = fetch,
): Promise<ComparisonRunResponse> {
  const response = await fetcher("/api/runs", { method: "POST" });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Failed to start run: ${response.status}`);
  }

  return (await response.json()) as ComparisonRunResponse;
}
