/** Human steering is separate from factual relevance scores and evidence citations. */
import type { ProductListing } from "../../lib/contracts";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { shoppingMatchTokens, shoppingPhrase } from "./text";

type Poll = Pick<Doc<"mapSharpens">, "options" | "ballots" | "directionId">;
export interface RoomSteering { giftNet: Map<string, number>; polls: Poll[] }

export async function loadRoomSteering(ctx: QueryCtx, room: Doc<"rooms">): Promise<RoomSteering> {
  const [members, votes, polls] = await Promise.all([
    ctx.db.query("participants").withIndex("by_room", q => q.eq("roomId", room._id)).collect(),
    ctx.db.query("votes").withIndex("by_room", q => q.eq("roomId", room._id)).collect(),
    ctx.db.query("mapSharpens").withIndex("by_room", q => q.eq("roomId", room._id)).order("desc").take(20),
  ]);
  const ids = new Set(members.map(m => m._id));
  const giftNet = new Map<string, number>();
  for (const vote of votes) if (ids.has(vote.participantId))
    giftNet.set(vote.listingId, (giftNet.get(vote.listingId) ?? 0) + (vote.value === "up" ? 1 : vote.value === "down" ? -1 : 0));
  return { giftNet, polls: polls.filter(p => p.status !== "dismissed" && p.knowledgeRevision === room.knowledgeRevision)
    .map(p => ({ ...p, ballots: p.ballots?.filter(b => ids.has(b.participantId)) })) };
}

/** Literal matching supplies advisory support only, never a new recipient fact. */
export function questionSupport(listing: Pick<ProductListing, "id" | "title" | "variant">, steering: RoomSteering, directionId?: string) {
  const title = new Set(shoppingMatchTokens(`${listing.title} ${listing.variant ?? ""}`));
  let support = 0;
  for (const poll of steering.polls) {
    if (poll.directionId && poll.directionId !== directionId) continue;
    for (const ballot of poll.ballots ?? []) {
      const option = poll.options[ballot.option];
      if (!option) continue;
      if (option.listingIds.some(id => id === listing.id)) { support += 1; continue; }
      // Product-choice options are explicit: don't boost their competing product by title.
      if (option.listingIds.length) continue;
      const phrase = shoppingPhrase(option.clue || option.label);
      // Negated statements need interpretation; literal overlap is not adequate support.
      if (/\b(?:no|not|never|avoid|without|dislikes?|hates?|don['’]?t|doesn['’]?t)\b/i.test(`${option.clue} ${option.label}`)) continue;
      const tokens = shoppingMatchTokens(phrase).filter(t => !["maya", "recipient", "prefer", "mostly", "usually"].includes(t));
      if (tokens.length && tokens.filter(t => title.has(t)).length / tokens.length >= 0.5) support += 1;
    }
  }
  return support;
}

export function steerRanked<T extends { listingId: string; score: number }>(
  ranked: T[], listings: ProductListing[], steering: RoomSteering, directionId?: string | Map<string, string | undefined>,
): T[] {
  const byId = new Map(listings.map(l => [l.id, l]));
  const support = new Map(listings.map(l => [l.id, questionSupport(l, steering, typeof directionId === "string" ? directionId : directionId?.get(l.id))]));
  return [...ranked].sort((a, b) => (steering.giftNet.get(b.listingId) ?? 0) - (steering.giftNet.get(a.listingId) ?? 0)
    || (support.get(b.listingId) ?? 0) - (support.get(a.listingId) ?? 0)
    || b.score - a.score || a.listingId.localeCompare(b.listingId))
    .filter(row => byId.has(row.listingId));
}
