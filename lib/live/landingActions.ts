"use client";

// Preserve the previous import path while sharing dev's session-aware adapter.
export { useLandingActions } from "@/components/landing/useLandingActions";
import { LIMITS } from "@/lib/validation";

export const CONVEX_ENABLED = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

export function roomTitle(recipient: string, occasion: string): string {
  const title = `${recipient.trim()} · ${occasion.trim()}`;
  return title.length <= LIMITS.roomTitleMaxChars ? title : `${title.slice(0, LIMITS.roomTitleMaxChars - 1).trimEnd()}…`;
}
