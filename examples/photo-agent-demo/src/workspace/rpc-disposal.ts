type RpcResult<T = unknown> =
  | { status: "ok"; value?: T }
  | { status: "error"; error: { tag: string; message?: string } };

function disposeRpc(value: unknown): void {
  if (value && typeof value === "object" && Symbol.dispose in value) {
    (value as { [Symbol.dispose](): void })[Symbol.dispose]();
  }
}

export function disposeRpcResult(result: RpcResult): void {
  if (result.status === "ok") {
    disposeRpc(result.value);
  }
}
