const KIMI_TURN_RETRY_DELAYS_MS = [1_000, 2_500, 5_000] as const;

export const KIMI_TURN_MAX_ATTEMPTS = KIMI_TURN_RETRY_DELAYS_MS.length;

export function isRetryableThinkTurnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Capacity temporarily exceeded") ||
    message.includes("Think turn ended in status=error: An error occurred");
}

export function thinkTurnRetryDelayMs(attempt: number): number {
  return KIMI_TURN_RETRY_DELAYS_MS[Math.max(0, Math.min(attempt - 1, KIMI_TURN_RETRY_DELAYS_MS.length - 1))];
}

export async function withRuntimeSetupTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
