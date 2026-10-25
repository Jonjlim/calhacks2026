/**
 * The room's decision log (D23 trial). Owner: Dev 4 for the trial.
 *
 * Each step of the gift flow appends one plain line: what the council
 * proposed, what a check threw out, how a friend steered, what a search
 * found, who chose and approved. It is the story "How we got here" tells.
 * Room-visible facts only: callers never pass private imports, unpublished
 * clues or contribution caps. Logging never blocks or changes a decision.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export type TrailRow = Omit<Doc<"roomTrail">, "_id" | "_creationTime" | "roomId" | "at">;

const MAX_TEXT = 280;

export async function logTrail(ctx: MutationCtx, roomId: Id<"rooms">, row: TrailRow): Promise<void> {
  const text = row.text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  if (!text) return;
  await ctx.db.insert("roomTrail", { ...row, text, roomId, at: Date.now() });
}

/** "Sam" for the trail; a missing participant reads as "A friend". */
export async function nameOf(ctx: MutationCtx, participantId: Id<"participants">): Promise<string> {
  return (await ctx.db.get(participantId))?.displayName || "A friend";
}

export const shortTitle = (title: string) => (title.length > 60 ? `${title.slice(0, 58).trimEnd()}…` : title);
