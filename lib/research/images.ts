import type { ProductListing } from "../contracts";
import { publicHttpUrlSchema } from "../validation";

/** URL eligibility only; the frontend handles image load failures. */
export function hasProductImageUrl(listing: Pick<ProductListing, "imageUrl">): boolean {
  const parsed = publicHttpUrlSchema.safeParse(listing.imageUrl);
  return parsed.success && new URL(parsed.data).protocol === "https:";
}
