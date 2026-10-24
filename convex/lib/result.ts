import type { AppError, AppErrorCode, Result } from "../../lib/contracts";

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(code: AppErrorCode, message: string): Result<T> {
  const error: AppError = { code, message };
  return { ok: false, error };
}

/** Placeholder return for endpoints whose contract exists but body does not. */
export function notImplemented<T = never>(taskId: string): Result<T> {
  return err("unknown", `Not implemented yet (${taskId}).`);
}
