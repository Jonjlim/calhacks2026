/**
 * What Moss may search in a room (MAP-024). Owner: Dev 3.
 *
 * Only active published memories (room-visible by definition), never gift ideas,
 * private imports, proposed clues, limits or Gift Twin vault text.
 */
import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { isLiveRoom } from "../lib/auth";
import { isGiftIdea } from "../../lib/map/rings";
import { RECALL_DOC_LIMIT, type RecallDoc } from "../../lib/room/mossRecall";

export const roomMemories = internalQuery({
  args: { roomId: v.id("rooms"), userId: v.string() },
  handler: async (ctx, { roomId, userId }): Promise<{ askerId: string; docs: RecallDoc[] } | "not_found" | "unauthorized"> => {
    const room = await ctx.db.get(roomId);
    if (!isLiveRoom(room)) return "not_found";
    const me = await ctx.db.query("participants").withIndex("by_room_user", (q) => q.eq("roomId", roomId).eq("userId", userId)).first();
    if (!me) return "unauthorized";
    const names = new Map((await ctx.db.query("participants").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect()).map((p) => [p._id as string, p.displayName]));
    const docs: RecallDoc[] = [];
    // Newest first, bounded: the index only ever holds a small working set.
    for await (const clue of ctx.db.query("publishedClues").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc")) {
      if (clue.status !== "active" || isGiftIdea(clue.text)) continue;
      docs.push({ id: clue._id, text: clue.text, authorId: clue.publisherId, author: names.get(clue.publisherId) ?? "A friend" });
      if (docs.length >= RECALL_DOC_LIMIT) break;
    }
    return { askerId: me._id, docs };
  },
});
