"use client";

import { useCallback, useState } from "react";
import type { AppError, Result } from "@/lib/contracts";
import { settle } from "@/lib/client";

/** Tracks pending/error state for a backend call that returns a Result. */
export function useResultAction<A extends unknown[], T>(fn: ((...args: A) => Promise<Result<T>>) | undefined) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const run = useCallback(
    async (...args: A): Promise<Result<T>> => {
      if (!fn) return { ok: false, error: { code: "unknown", message: "Not available in preview mode." } };
      setPending(true);
      setError(null);
      const result = await settle(fn(...args));
      setPending(false);
      if (!result.ok) setError(result.error);
      return result;
    },
    [fn],
  );

  return { run, pending, error, clearError: useCallback(() => setError(null), []) };
}
