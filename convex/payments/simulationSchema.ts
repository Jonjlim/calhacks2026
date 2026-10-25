/** Demo progress only. Never provider objects, real payment attempts or private caps. */
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const simulationTables = {
  paymentSimulations: defineTable({
    roomId: v.id("rooms"), revisionId: v.id("proposalRevisions"),
    approvalFingerprint: v.string(), completedParticipantIds: v.array(v.id("participants")),
    wrappedAt: v.optional(v.number()), createdAt: v.number(),
  }).index("by_room", ["roomId"]).index("by_revision", ["revisionId"]),
};
