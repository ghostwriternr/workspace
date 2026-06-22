const DEFAULT_CONTAINER_SLEEP_AFTER = "2m";
const DEFAULT_WARM_POOL_REFRESH_INTERVAL_MS = 10_000;
const DEFAULT_WARM_POOL_TARGET = 2;

export interface ContainerPoolConfigEnv {
  CONTAINER_SLEEP_AFTER?: string;
  WARM_POOL_REFRESH_INTERVAL?: string;
  WARM_POOL_RESET_KEY?: string;
  WARM_POOL_TARGET?: string;
}

export function containerSleepAfter(env: { CONTAINER_SLEEP_AFTER?: string }): string {
  return env.CONTAINER_SLEEP_AFTER ?? DEFAULT_CONTAINER_SLEEP_AFTER;
}

export function warmPoolRefreshIntervalMs(env: ContainerPoolConfigEnv): number {
  return parsePositiveInteger(
    env.WARM_POOL_REFRESH_INTERVAL,
    DEFAULT_WARM_POOL_REFRESH_INTERVAL_MS,
  );
}

export function warmPoolTarget(env: ContainerPoolConfigEnv): number {
  return parsePositiveInteger(env.WARM_POOL_TARGET, DEFAULT_WARM_POOL_TARGET);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
