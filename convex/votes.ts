/**
 * Advisory votes on listings. Owner: Dev 2 (BE-007). Votes never select a gift
 * and never enter allocation.
 */
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { notImplemented } from "./lib/result";
import * as V from "./validators";

export const castVote = mutation({
  args: { roomId: v.id("rooms"), listingId: v.id("productListings"), value: V.voteValue },
  handler: async (_ctx, _args) =>
    notImplemented<{
      listingId: Id<"productListings">;
      tally: { up: number; down: number; flag_duplicate: number };
    }>("BE-007"),
});
