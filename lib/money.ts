import type { Currency } from "@/lib/contracts";

export const SUPPORTED_CURRENCIES: readonly Currency[] = ["USD"];

export function isCurrency(value: string): value is Currency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

/** Valid money amounts are non-negative safe integers in minor units (cents). */
export function isValidMinor(amountMinor: number): boolean {
  return Number.isSafeInteger(amountMinor) && amountMinor >= 0;
}

/** Parses user input like "25", "25.5", or "$25.50" into cents. Returns null if invalid. */
export function parseMajorToMinor(input: string): number | null {
  const match = /^\$?\s*(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0"));
  const minor = whole * 100 + cents;
  return isValidMinor(minor) ? minor : null;
}

export function formatMinor(amountMinor: number, currency: Currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    amountMinor / 100,
  );
}

export function sumMinor(amounts: readonly number[]): number {
  return amounts.reduce((total, amount) => total + amount, 0);
}
