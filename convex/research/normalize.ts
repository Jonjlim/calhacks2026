/**
 * Provider payload → ProductListing. Owner: Dev 4 (RC-001, RC-003).
 *
 * Rules: drop rows missing sourceUrl or retrievedAt; drop non-USD; unknown
 * price becomes priceStatus "unknown" (never invented).
 */
import type { ProductListing } from "../../lib/contracts";

export type NormalizedListing = Omit<ProductListing, "id" | "roomId" | "jobId" | "status">;

export function normalizeListing(_raw: unknown, _retrievedAt: number): NormalizedListing | null {
  // TODO(RC-003): parse the verified provider's payload with Zod.
  return null;
}
