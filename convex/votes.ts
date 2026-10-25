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
import { logTrail, shortTitle } from "./lib/trail";
import { PASS_REASON_TEXT, reactToPasses } from "./agents/directions";
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
  /** `reason` (D23 trial): why, on a pass. The council avoids it when it replaces a direction. */
  args: { roomId: v.id("rooms"), listingId: v.id("productListings"), value: V.voteValue, reason: v.optional(V.passReason) },
  handler: async (ctx, { roomId, listingId, value, reason }) => {
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
    const why = value === "down" && reason ? reason : undefined;
    if (existing) {
      await ctx.db.patch(existing._id, { value, updatedAt: now, reason: why });
    } else {
      await ctx.db.insert("votes", { roomId, listingId, participantId: member.me._id, value, updatedAt: now, ...(why ? { reason: why } : {}) });
    }
    // "How we got here" (D23 trial): only a changed vote, or a newly given reason, is a new decision.
    if (existing?.value !== value || (why && existing?.reason !== why)) await logTrail(ctx, roomId, { stage: "steering", actor: "person", participantId: member.me._id, listingId,
      outcome: value === "up" ? "kept" : value === "down" ? "rejected" : "info",
      text: `${member.me.displayName || "A friend"} ${value === "up" ? "pulled in" : value === "down" ? "passed on" : "voted on"} “${shortTitle(listing.title)}”${why ? ` (${PASS_REASON_TEXT[why]})` : ""}.` });
    // Enough passes on a direction's gifts make the council give up on that direction and suggest another.
    const job = value === "down" ? await ctx.db.get(listing.jobId) : null;
    if (job?.directionId) await reactToPasses(ctx, roomId, job.directionId, member.me._id);
    return ok<Out>({ listingId, tally: await tallyFor(ctx, listingId) });
  },
});

export const clearVote = mutation({
  args: { roomId: v.id("rooms"), listingId: v.id("productListings") },
  handler: async (ctx, { roomId, listingId }) => {
    type Out = { listingId: Id<"productListings">; tally: Tally };
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<Out>(member.code);
    // Without this check a member could read another room's tally by passing its listing id.
    const listing = await ctx.db.get(listingId);
    if (!listing || listing.roomId !== roomId) return err<Out>("not_found", "Listing not found.");
    const existing = await ctx.db
      .query("votes")
      .withIndex("by_listing_participant", (q) => q.eq("listingId", listingId).eq("participantId", member.me._id))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
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
