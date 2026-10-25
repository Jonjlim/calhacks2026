import type {
  ProductListing,
  PublishedClue,
  Recommendation,
  RecommendationsView,
  SearchOrigin,
  SearchPoolSummary,
} from "../../lib/contracts";
import { fadeOf } from "../../lib/map/directions";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { searchOrigin, withSearchNote } from "./foundBy";
import { filterListings, rankListings, type ExcludedListing } from "./score";
import { trendJobIdInFingerprint } from "./trendJobs";
import { loadRoomSteering, steerRanked, type RoomSteering } from "./groupRanking";
import { boxListingIds } from "../lib/giftBox";

export interface CatalogState extends RecommendationsView {
  clues: PublishedClue[];
  latestRequest: Doc<"researchJobs"> | null;
  candidatePool: Doc<"researchJobs"> | null;
  excluded: ExcludedListing[];
}

/** Gifts shown per direction, and from the general search once directions exist (D23 trial). */
export const GIFTS_PER_DIRECTION = 2;

const toListing = ({ _id, _creationTime: _, ...fields }: Doc<"productListings">): ProductListing => ({ ...fields, id: _id });

/**
 * Ranks one search's listings and says what happened to them: how many it
 * found, how many the room's clues removed, how many were repeats of one product.
 */
function rankPool(pool: ProductListing[], clues: PublishedClue[], budgetMinor: number | undefined, limit: number, steering: RoomSteering, directionId?: string) {
  const { kept, excluded } = filterListings({ listings: pool, clues });
  const distinct = steerRanked(rankListings({ listings: pool, clues, budgetMinor, limit: kept.length }), pool, steering, directionId);
  return {
    ranked: distinct.slice(0, limit),
    excluded,
    counts: { found: pool.length, removedByClues: excluded.length, foldedDuplicates: kept.length - distinct.length, shown: Math.min(limit, distinct.length) },
  };
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
    // The general search lane: anything not run for a council direction.
    ctx.db.query("researchJobs")
      .withIndex("by_room_direction", q => q.eq("roomId", room._id).eq("directionId", undefined))
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

  // Directions still on the map, each with its newest finished search (D23 trial).
  const directions = (await ctx.db.query("mapDirections").withIndex("by_room", q => q.eq("roomId", room._id)).take(60))
    .filter(d => !d.retiredAt);
  const lanes: { direction: Doc<"mapDirections">; job: Doc<"researchJobs">; pulled: boolean }[] = [];
  if (directions.length) {
    const members = (await ctx.db.query("participants").withIndex("by_room", q => q.eq("roomId", room._id)).collect()).length;
    const signals = await ctx.db.query("mapSignals").withIndex("by_room", q => q.eq("roomId", room._id)).take(2000);
    for (const direction of directions) {
      const votes = signals.filter(s => s.targetKind === "direction" && s.targetId === direction._id);
      const tally = { up: votes.filter(s => s.value > 0).length, down: votes.filter(s => s.value < 0).length };
      if (fadeOf(tally, members) === "gone") continue;
      const job = await ctx.db.query("researchJobs")
        .withIndex("by_room_direction", q => q.eq("roomId", room._id).eq("directionId", direction._id))
        .order("desc").filter(q => q.eq(q.field("status"), "succeeded")).first();
      if (job) lanes.push({ direction, job, pulled: tally.up > tally.down });
    }
  }

  const steering = await loadRoomSteering(ctx, room);
  const recommendations: Recommendation[] = [];
  const listings: ProductListing[] = [];
  const searchPools: SearchPoolSummary[] = [];
  const shownIds = new Set<string>();
  const add = (job: Doc<"researchJobs">, pool: ProductListing[], ranked: ReturnType<typeof rankListings>, foundBy: SearchOrigin | undefined,
    note: (row: ReturnType<typeof rankListings>[number]) => string) => {
    for (const row of ranked) {
      // The same listing found by two searches shows once, credited to the first.
      if (shownIds.has(row.listingId)) continue;
      shownIds.add(row.listingId);
      recommendations.push({ ...row, explanation: note(row), ...(foundBy ? { foundBy } : {}), id: `${job._id}:${row.listingId}`, roomId: room._id, createdAt: job.createdAt });
      listings.push(pool.find(l => l.id === row.listingId)!);
    }
  };

  for (const { direction, job, pulled } of lanes) {
    const pool = (await ctx.db.query("productListings").withIndex("by_job", q => q.eq("jobId", job._id)).collect())
      .filter(l => l.roomId === room._id).map(toListing);
    // A direction the room pulled in earns one more gift on the map.
    const { ranked, counts } = rankPool(pool, clues, room.budgetMinor, GIFTS_PER_DIRECTION + (pulled ? 1 : 0), steering, direction._id);
    const foundBy: SearchOrigin = { query: direction.query, source: "direction", directionId: direction._id, ...(direction.clueIds[0] ? { publishedClueId: direction.clueIds[0] } : {}) };
    add(job, pool, ranked, foundBy, row => row.publishedClueIds.length
      ? row.explanation
      : `Found by the “${direction.label}” direction, searching “${direction.query}”. ${row.explanation}`);
    searchPools.push({ jobId: job._id, directionId: direction._id, query: direction.query, ...counts });
  }

  // The general search: its usual 12 alone, or its best two beside the directions.
  let excluded: ExcludedListing[] = [];
  if (candidatePool) {
    const docs = await ctx.db.query("productListings").withIndex("by_job", (q) => q.eq("jobId", candidatePool._id)).collect();
    const council = await ctx.db.query("councilRuns").withIndex("by_research", q => q.eq("researchJobId", candidatePool._id)).unique();
    const approved = new Map(council?.approved?.map(a => [a.listingId as string, a.notes]) ?? []);
    const pool = docs
      .filter((listing) => listing.roomId === room._id && (!council || (council.deliveredAt && approved.has(listing._id))))
      .map(toListing);
    const limit = lanes.length ? GIFTS_PER_DIRECTION : candidatePool.brief?.listingLimit ?? 12;
    const result = rankPool(pool, clues, room.budgetMinor, limit, steering);
    excluded = result.excluded;
    const trendId = trendJobIdInFingerprint(candidatePool.inputHash);
    const trendJobId = trendId ? ctx.db.normalizeId("trendJobs", trendId) : null;
    const trendJob = trendJobId ? await ctx.db.get(trendJobId) : null;
    const foundBy = searchOrigin({
      query: candidatePool.brief?.queryTerms[0],
      clues,
      poolClueIds: candidatePool.publishedClueIds,
      trendClueId: trendId ? (trendJob?.publishedClueId ?? "") : null,
    });
    add(candidatePool, pool, result.ranked, foundBy,
      row => [withSearchNote(row.explanation, row.publishedClueIds, foundBy, clues), ...(approved.get(row.listingId) ?? [])].join(" "));
    searchPools.push({ jobId: candidatePool._id, query: candidatePool.brief?.queryTerms[0] ?? "", ...result.counts });
  }

  // Keep the current box's observed products available even after a new search.
  const selection = room.currentSelectionId ? await ctx.db.get(room.currentSelectionId) : null;
  if (selection?.status === "active") {
    for (const id of boxListingIds(selection)) {
      if (shownIds.has(id)) continue;
      const doc = await ctx.db.get(id);
      if (!doc || doc.roomId !== room._id) continue;
      const listing = toListing(doc);
      const rows = rankListings({ listings: [listing], clues, budgetMinor: room.budgetMinor, budgetMinMinor: room.budgetMinMinor, limit: 1 });
      if (rows[0]) {
        recommendations.push({ ...rows[0], id: `box:${id}`, roomId: room._id, createdAt: selection.selectedAt });
        shownIds.add(id);
      }
      if (!listings.some(l => l.id === id)) listings.push(listing);
    }
  }
  // Each lane is vote-ranked before truncation. Apply the same ordering across lanes.
  const finalOrder = steerRanked(recommendations, listings, steering, new Map(recommendations.map(r => [r.listingId, r.foundBy?.directionId])));
  recommendations.splice(0, recommendations.length, ...finalOrder);

  return {
    clues,
    recommendations,
    listings,
    searchPools,
    latestRequest,
    candidatePool,
    excluded,
  };
}
