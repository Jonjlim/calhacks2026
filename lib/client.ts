import type { AppError, Result } from "@/lib/contracts";

/** Maps a Convex document to the contract shape (`id` instead of `_id`). */
export function withId<T extends { _id: string; _creationTime: number }>(doc: T): Omit<T, "_id" | "_creationTime"> & { id: T["_id"] } {
  const { _id, _creationTime: _, ...rest } = doc;
  return { ...rest, id: _id };
}

/** Unexpected throws (network, argument validation) become a safe, generic AppError. */
export function errorFromThrown(error: unknown): AppError {
  if (error instanceof Error && /ArgumentValidationError|Value does not match validator/.test(error.message)) {
    return { code: "not_found", message: "That link doesn't point to anything we can find." };
  }
  return { code: "unknown", message: "Something went wrong reaching the server. Try again." };
}

export async function settle<T>(promise: Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await promise;
  } catch (error) {
    return { ok: false, error: errorFromThrown(error) };
  }
}

export function newRequestKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
