/**
 * Advisory votes on listings. Owner: Dev 2 (BE-007). Votes never select a gift
 * and never enter allocation.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMember } from "./lib/auth";
import { err, memberError, ok } from "./lib/result";
import * as V from "./validators";

type Tally = { up: number; down: number; flag_duplicate: number };

function emptyTally(): Tally {
  return { up: 0, down: 0, flag_duplicate: 0 };
}

async function tallyFor(ctx: QueryCtx, listingId: Id<"productListings">): Promise<Tally> {
  const votes = await ctx.db
    .query("votes")
    .withIndex("by_listing_participant", (q) => q.eq("listingId", listingId))
    .collect();
  const tally = emptyTally();
  for (const vote of votes) tally[vote.value] += 1;
  return tally;
}

/** One vote per participant per listing; casting again replaces it. */
export const castVote = mutation({
  args: { roomId: v.id("rooms"), listingId: v.id("productListings"), value: V.voteValue },
  handler: async (ctx, { roomId, listingId, value }) => {
    type Out = { listingId: Id<"productListings">; tally: Tally };
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<Out>(member.code);
    const listing = await ctx.db.get(listingId);
    if (!listing || listing.roomId !== roomId) return err<Out>("not_found", "Listing not found.");

    const existing = await ctx.db
      .query("votes")
      .withIndex("by_listing_participant", (q) => q.eq("listingId", listingId).eq("participantId", member.me._id))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { value, updatedAt: now });
    } else {
      await ctx.db.insert("votes", { roomId, listingId, participantId: member.me._id, value, updatedAt: now });
    }
    return ok<Out>({ listingId, tally: await tallyFor(ctx, listingId) });
  },
});

export const clearVote = mutation({
  args: { roomId: v.id("rooms"), listingId: v.id("productListings") },
  handler: async (ctx, { roomId, listingId }) => {
    type Out = { listingId: Id<"productListings">; tally: Tally };
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<Out>(member.code);
    const existing = await ctx.db
      .query("votes")
      .withIndex("by_listing_participant", (q) => q.eq("listingId", listingId).eq("participantId", member.me._id))
      .unique();
    if (existing && existing.roomId === roomId) await ctx.db.delete(existing._id);
    return ok<Out>({ listingId, tally: await tallyFor(ctx, listingId) });
  },
});

/** Per-listing tallies plus the caller's own vote. */
export const listVotes = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    type Row = { listingId: Id<"productListings">; tally: Tally; myVote?: Doc<"votes">["value"] };
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<Row[]>(member.code);
    const votes = await ctx.db
      .query("votes")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();
    const rows = new Map<Id<"productListings">, Row>();
    for (const vote of votes) {
      const row = rows.get(vote.listingId) ?? { listingId: vote.listingId, tally: emptyTally() };
      row.tally[vote.value] += 1;
      if (vote.participantId === member.me._id) row.myVote = vote.value;
      rows.set(vote.listingId, row);
    }
    return ok([...rows.values()]);
  },
});
