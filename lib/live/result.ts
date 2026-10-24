import type { AppError, Result } from "@/lib/contracts";

/** Unwraps a Convex Result for rendering. `loading` is true until the first response arrives. */
export function unwrap<T>(result: Result<T> | undefined): {
  loading: boolean;
  value?: T;
  error?: AppError;
} {
  if (result === undefined) return { loading: true };
  return result.ok ? { loading: false, value: result.value } : { loading: false, error: result.error };
}

export function errorText(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong.";
}
