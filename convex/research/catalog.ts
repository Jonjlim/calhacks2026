import type {
  ProductListing,
  PublishedClue,
  RecommendationsView,
} from "../../lib/contracts";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { filterListings, rankListings, type ExcludedListing } from "./score";

export interface CatalogState extends RecommendationsView {
  clues: PublishedClue[];
  latestRequest: Doc<"researchJobs"> | null;
  candidatePool: Doc<"researchJobs"> | null;
  excluded: ExcludedListing[];
}

/** Internal projection only. Callers must establish room membership before using it. */
export async function readCatalog(
  ctx: QueryCtx,
  room: Doc<"rooms">,
): Promise<CatalogState> {
  const recent = await ctx.db
    .query("researchJobs")
    .withIndex("by_room", (q) => q.eq("roomId", room._id))
    .order("desc")
    .take(50);
  const candidatePool =
    recent.find((job) => job.status === "succeeded") ?? null;
  const clues = (
    await ctx.db
      .query("publishedClues")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect()
  )
    .filter((clue) => clue.status === "active")
    .map(({ _id, _creationTime: _, ...fields }): PublishedClue => ({
      ...fields,
      id: _id,
    }));
  const docs = candidatePool
    ? await ctx.db
        .query("productListings")
        .withIndex("by_job", (q) => q.eq("jobId", candidatePool._id))
        .collect()
    : [];
  const pool = docs
    .filter((listing) => listing.roomId === room._id)
    .map(({ _id, _creationTime: _, ...fields }): ProductListing => ({
      ...fields,
      id: _id,
    }));
  const ranked = rankListings({
    listings: pool,
    clues,
    budgetMinor: room.budgetMinor,
    limit: candidatePool?.brief?.listingLimit ?? 12,
  });
  const recommendations = ranked.map((row) => ({
    ...row,
    id: `${candidatePool!._id}:${row.listingId}`,
    roomId: room._id,
    createdAt: candidatePool!.createdAt,
  }));
  const visible = new Set(recommendations.map((row) => row.listingId));
  return {
    clues,
    recommendations,
    listings: pool.filter((listing) => visible.has(listing.id)),
    latestRequest: recent[0] ?? null,
    candidatePool,
    excluded: filterListings({ listings: pool, clues }).excluded,
  };
}
