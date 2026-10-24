/**
 * "How Unwrap worked on this gift". Owner: Dev 3.
 *
 * Every number is read from records the agents already wrote. Anything we do
 * not have is null (unknown), never estimated. Model usage and private clue
 * counts are the caller's own; everything else is room-visible.
 */
import { v } from "convex/values";
import { query } from "../_generated/server";
import { getMembership } from "../lib/auth";
import { err, ok } from "../lib/result";
import { readCatalog } from "../research/catalog";

export interface RoomStats {
  model: {
    /** The caller's own agent jobs in the last 100. */
    jobs: number;
    calls: number;
    reportedCalls: number;
    /** Sum over calls the provider reported usage for. Null when none were reported. */
    inputTokens: number | null;
    outputTokens: number | null;
    /** False when some calls reported no usage, so the sums are lower bounds. */
    tokensComplete: boolean;
    /** Set only when LLM_INPUT_USD_PER_MTOK and LLM_OUTPUT_USD_PER_MTOK are configured and usage is complete. */
    costUsd: number | null;
  };
  timing: { medianAnswerMs: number | null; samples: number };
  clues: {
    mine: { proposed: number; published: number; discarded: number };
    room: { active: number; withdrawn: number };
  };
  listings: {
    shown: number;
    dropped: { excluded_by_clue: number; unavailable: number; inactive: number };
  };
  recipient: { asked: number; answered: number; unknown: number; refused: number };
}

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
};

export const getRoomStats = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await getMembership(ctx, roomId);
    if (!member) return err<RoomStats>("unauthorized", "Room membership required.");
    const room = await ctx.db.get(roomId);
    if (!room) return err<RoomStats>("not_found", "Room not found.");

    const jobs = await ctx.db
      .query("agentJobs")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .order("desc")
      .take(100);
    const mine = jobs.filter((j) => j.actingParticipantId === member._id);
    let calls = 0;
    let reportedCalls = 0;
    let input = 0;
    let output = 0;
    for (const job of mine) {
      if (!job.modelUsage) continue;
      calls += job.modelUsage.calls;
      reportedCalls += job.modelUsage.reportedCalls;
      input += job.modelUsage.inputTokens;
      output += job.modelUsage.outputTokens;
    }
    const tokensComplete = calls > 0 && reportedCalls === calls;
    const inRate = Number(process.env.LLM_INPUT_USD_PER_MTOK);
    const outRate = Number(process.env.LLM_OUTPUT_USD_PER_MTOK);
    const priced =
      tokensComplete &&
      process.env.LLM_INPUT_USD_PER_MTOK !== undefined &&
      process.env.LLM_OUTPUT_USD_PER_MTOK !== undefined &&
      Number.isFinite(inRate) &&
      Number.isFinite(outRate);

    // Question to answer: job creation to finish, for turns this person's messages started.
    const latencies = mine
      .filter(
        (j) =>
          j.kind === "evaluate_thread" &&
          (j.trigger ?? "human") === "human" &&
          j.status === "succeeded" &&
          j.finishedAt !== undefined,
      )
      .map((j) => j.finishedAt! - j.createdAt);

    const proposed = await ctx.db
      .query("proposedClues")
      .withIndex("by_room_participant", (q) =>
        q.eq("roomId", roomId).eq("participantId", member._id),
      )
      .collect();
    const published = await ctx.db
      .query("publishedClues")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();

    const catalog = await readCatalog(ctx, room);
    const dropped = { excluded_by_clue: 0, unavailable: 0, inactive: 0 };
    for (const row of catalog.excluded) dropped[row.reason]++;

    const decisions = await ctx.db
      .query("agentDecisions")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .filter((q) => q.eq(q.field("intent"), "query_recipient"))
      .take(200);
    const recipient = { asked: decisions.length, answered: 0, unknown: 0, refused: 0 };
    for (const d of decisions) if (d.recipientOutcome) recipient[d.recipientOutcome]++;

    return ok<RoomStats>({
      model: {
        jobs: mine.length,
        calls,
        reportedCalls,
        inputTokens: reportedCalls > 0 ? input : null,
        outputTokens: reportedCalls > 0 ? output : null,
        tokensComplete,
        costUsd: priced ? (input * inRate + output * outRate) / 1_000_000 : null,
      },
      timing: { medianAnswerMs: median(latencies), samples: latencies.length },
      clues: {
        mine: {
          proposed: proposed.length,
          published: proposed.filter((c) => c.status === "published").length,
          discarded: proposed.filter((c) => c.status === "rejected").length,
        },
        room: {
          active: published.filter((c) => c.status === "active").length,
          withdrawn: published.filter((c) => c.status !== "active").length,
        },
      },
      listings: { shown: catalog.listings.length, dropped },
      recipient,
    });
  },
});
