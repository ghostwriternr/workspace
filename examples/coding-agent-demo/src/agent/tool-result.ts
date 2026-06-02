import { Result, type Result as BetterResult } from "better-result";

export type ModelToolError<E> = {
  status: "error";
  error: E;
};

export function resultToModelToolOutput<T, E>(result: BetterResult<T, E>): T | ModelToolError<E> {
  if (Result.isError(result)) {
    return { status: "error", error: result.error };
  }

  return result.value;
}
