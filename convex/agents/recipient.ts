import { v } from "convex/values";
import type {
  AgentQuery,
  AgentReply,
  RecipientGrant,
  RecipientPreference,
  Result,
} from "../../lib/contracts";
import {
  recipientProfileUpdateSchema,
  agentQuerySchema,
} from "../../lib/validation";
import {
  internalAction,
  internalQuery,
  mutation,
  query,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { getMembership, getUserId } from "../lib/auth";
import { err, ok } from "../lib/result";
import * as V from "../validators";
import { configuredModel } from "./model";
import { answerRecipientQuery } from "./recipientPolicy";

export const createProfile = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (
    ctx,
    { roomId },
  ): Promise<Result<{ recipientProfileId: Id<"recipientProfiles"> }>> => {
    const member = await getMembership(ctx, roomId);
    if (
      !member ||
      member.role !== "organizer" ||
      process.env.RECIPIENT_AGENT_DEMO_ENABLED !== "true"
    )
      return err(
        "unauthorized",
        "Synthetic recipient operator mode is not enabled for this account.",
      );
    const room = await ctx.db.get(roomId);
    if (!room) return err("not_found", "Room not found.");
    if (room.recipientProfileId) {
      const existing = await ctx.db.get(room.recipientProfileId);
      return existing?.ownerUserId === member.userId
        ? ok({ recipientProfileId: existing._id })
        : err("unauthorized", "Recipient profile belongs to another identity.");
    }
    const recipientProfileId = await ctx.db.insert("recipientProfiles", {
      roomId,
      ownerUserId: member.userId,
      revision: 0,
      createdAt: Date.now(),
    });
    await ctx.db.patch(roomId, { recipientProfileId });
    return ok({ recipientProfileId });
  },
});

export const updateRecipientPreferences = mutation({
  args: {
    recipientProfileId: v.id("recipientProfiles"),
    preferences: v.array(
      v.object({
        category: V.recipientCategory,
        text: v.string(),
        disclosable: v.boolean(),
        authorized: v.boolean(),
      }),
    ),
    grants: v.array(
      v.object({
        category: V.recipientCategory,
        allowedQuestionTypes: v.array(V.recipientQuestionType),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.recipientProfileId);
    const userId = await getUserId(ctx);
    if (!profile || !userId || profile.ownerUserId !== userId)
      return err("unauthorized", "Recipient profile is owner-only.");
    const parsed = recipientProfileUpdateSchema.safeParse({
      preferences: args.preferences,
      grants: args.grants,
    });
    if (!parsed.success)
      return err(
        "validation_failed",
        "Invalid recipient preferences or grants.",
      );
    for (const table of ["recipientPreferences", "recipientGrants"] as const) {
      const old = await ctx.db
        .query(table)
        .withIndex("by_profile", (q) => q.eq("recipientProfileId", profile._id))
        .collect();
      for (const row of old) await ctx.db.delete(row._id);
    }
    for (const row of parsed.data.preferences)
      await ctx.db.insert("recipientPreferences", {
        ...row,
        recipientProfileId: profile._id,
        createdAt: Date.now(),
      });
    for (const row of parsed.data.grants)
      await ctx.db.insert("recipientGrants", {
        ...row,
        recipientProfileId: profile._id,
      });
    await ctx.db.patch(profile._id, { revision: profile.revision + 1 });
    return ok(parsed.data);
  },
});

export const getMyProfile = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await getMembership(ctx, roomId);
    if (!member) return err("unauthorized", "Room membership required.");
    const room = await ctx.db.get(roomId);
    const profile = room?.recipientProfileId
      ? await ctx.db.get(room.recipientProfileId)
      : null;
    if (!profile || profile.ownerUserId !== member.userId)
      return err("unauthorized", "Recipient profile is owner-only.");
    const preferences = await ctx.db
      .query("recipientPreferences")
      .withIndex("by_profile", (q) => q.eq("recipientProfileId", profile._id))
      .collect();
    const grants = await ctx.db
      .query("recipientGrants")
      .withIndex("by_profile", (q) => q.eq("recipientProfileId", profile._id))
      .collect();
    return ok({ recipientProfileId: profile._id, preferences, grants });
  },
});

interface RecipientContext {
  roomId: string;
  jobId: string;
  profileId: Id<"recipientProfiles">;
  revision: number;
  preferences: RecipientPreference[];
  grants: RecipientGrant[];
}
export const getQueryContext = internalQuery({
  args: { jobId: v.id("agentJobs"), attempt: v.number(), query: v.any() },
  handler: async (ctx, args): Promise<RecipientContext | null> => {
    const parsed = agentQuerySchema.safeParse(args.query as unknown);
    const job = await ctx.db.get(args.jobId);
    if (
      !parsed.success ||
      !job ||
      job.kind !== "evaluate_thread" ||
      job.status !== "running" ||
      job.attempt !== args.attempt ||
      parsed.data.askedByJobId !== job._id ||
      parsed.data.roomId !== job.roomId ||
      parsed.data.id !== `${job._id}:recipient` ||
      process.env.RECIPIENT_AGENT_DEMO_ENABLED !== "true"
    )
      return null;
    const member = job.actingParticipantId
      ? await ctx.db.get(job.actingParticipantId)
      : null;
    if (!member || member.roomId !== job.roomId) return null;
    const room = await ctx.db.get(job.roomId);
    const profile = room?.recipientProfileId
      ? await ctx.db.get(room.recipientProfileId)
      : null;
    if (!profile || profile.roomId !== job.roomId) return null;
    const grants = await ctx.db
      .query("recipientGrants")
      .withIndex("by_profile", (q) => q.eq("recipientProfileId", profile._id))
      .collect();
    const allowed = new Set(
      grants
        .filter((g) => g.allowedQuestionTypes.includes(parsed.data.type))
        .map((g) => g.category),
    );
    const rows = await ctx.db
      .query("recipientPreferences")
      .withIndex("by_profile", (q) => q.eq("recipientProfileId", profile._id))
      .collect();
    return {
      roomId: job.roomId,
      jobId: job._id,
      profileId: profile._id,
      revision: profile.revision,
      grants: grants.map((g) => ({
        recipientProfileId: g.recipientProfileId,
        category: g.category,
        allowedQuestionTypes: g.allowedQuestionTypes,
      })),
      preferences: rows
        .filter((p) => p.authorized && p.disclosable && allowed.has(p.category))
        .map((p) => ({
          id: p._id,
          recipientProfileId: p.recipientProfileId,
          category: p.category,
          text: p.text,
          authorized: p.authorized,
          disclosable: p.disclosable,
          createdAt: p.createdAt,
        })),
    };
  },
});

export interface RecipientResult {
  reply: AgentReply;
  profileId?: Id<"recipientProfiles">;
  profileRevision?: number;
}
export const queryRecipientAgent = internalAction({
  args: { jobId: v.id("agentJobs"), attempt: v.number(), query: v.any() },
  handler: async (ctx, args): Promise<RecipientResult> => {
    const context = await ctx.runQuery(
      internal.agents.recipient.getQueryContext,
      args,
    );
    if (!context)
      return {
        reply: {
          queryId: `${args.jobId}:recipient`,
          status: "refused",
          usedPreferenceIds: [],
          policy: { allowed: false, reason: "out_of_policy" },
        },
      };
    const reply = await answerRecipientQuery(
      args.query as AgentQuery,
      context,
      configuredModel(),
    );
    return {
      reply,
      profileId: context.profileId,
      profileRevision: context.revision,
    };
  },
});
