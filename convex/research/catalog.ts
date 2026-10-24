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
  const [latestRequest, candidatePool] = await Promise.all([
    ctx.db.query("researchJobs")
      .withIndex("by_room", q => q.eq("roomId", room._id))
      .order("desc").first(),
    ctx.db.query("researchJobs")
      .withIndex("by_room", q => q.eq("roomId", room._id))
      .order("desc").filter(q => q.eq(q.field("status"), "succeeded")).first(),
  ]);
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
  const council = candidatePool ? await ctx.db.query("councilRuns").withIndex("by_research", q => q.eq("researchJobId", candidatePool._id)).unique() : null;
  const approved = new Map(council?.approved?.map(a => [a.listingId as string, a.notes]) ?? []);
  const pool = docs
    .filter((listing) => listing.roomId === room._id && (!council || (council.deliveredAt && approved.has(listing._id))))
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
    explanation: [row.explanation, ...(approved.get(row.listingId) ?? [])].join(" "),
    id: `${candidatePool!._id}:${row.listingId}`,
    roomId: room._id,
    createdAt: candidatePool!.createdAt,
  }));
  const visible = new Set(recommendations.map((row) => row.listingId));
  return {
    clues,
    recommendations,
    listings: pool.filter((listing) => visible.has(listing.id)),
    latestRequest,
    candidatePool,
    excluded: filterListings({ listings: pool, clues }).excluded,
  };
}
