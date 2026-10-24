/**
 * Small input guards shared by Dev 2 mutations. Limits come from
 * lib/validation.ts so the UI and the backend agree.
 */
import { isValidMinor } from "../../lib/money";
import { LIMITS } from "../../lib/validation";

export { LIMITS };

/** Upper bound on any single money input (1,000,000.00 USD). */
export const MAX_MINOR = 100_000_000;

/** Trims and length-checks free text. Returns null when empty or too long. */
export function cleanText(raw: string, maxChars: number): string | null {
  const text = raw.trim();
  if (text.length === 0 || text.length > maxChars) return null;
  return text;
}

export function isMoney(amountMinor: number): boolean {
  return isValidMinor(amountMinor) && amountMinor <= MAX_MINOR;
}

export const IDEMPOTENCY_KEY_MAX_CHARS = 128;
