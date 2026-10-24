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

const MEMBER_ERRORS = {
  unauthorized: "You are not a member of this room.",
  not_found: "Room not found.",
} as const;

export function memberError<T = never>(code: "unauthorized" | "not_found"): Result<T> {
  return err(code, MEMBER_ERRORS[code]);
}
