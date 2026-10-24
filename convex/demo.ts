/**
 * Demo-only fixture pool. Owner: Dev 3.
 *
 * Lets a room show the shortlist, revision trace and replies without a paid
 * product search. Disabled unless DEMO_SEED_ENABLED=true on the deployment,
 * organizer-only, and every listing is `manual_fixture` (the UI labels these
 * "fixture") with an example.com URL: nothing here is presented as a real offer.
 */
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireMember } from "./lib/auth";
import { err, memberError, ok } from "./lib/result";

const FIXTURES = [
  { slug: "wheel-class", title: "Intro wheel-throwing class (4 sessions)", priceMinor: 9_500, availability: "in_stock" as const },
  { slug: "starter-kit", title: "Complete Pottery Starter Kit", priceMinor: 4_800, availability: "in_stock" as const },
  { slug: "trimming-tools", title: "Pro trimming tool set", priceMinor: 3_800, availability: "limited" as const },
  { slug: "sculpt-workshop", title: "Clay sculpting workshop (2 hours)", priceMinor: 4_200, availability: "in_stock" as const },
  { slug: "pottery-class-card", title: "Beginner pottery class gift card", priceMinor: 6_000, availability: "in_stock" as const },
];

export const seedFixturePool = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    if (process.env.DEMO_SEED_ENABLED !== "true")
      return err<{ listings: number }>("refused", "Demo seeding is not enabled on this deployment.");
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<{ listings: number }>(member.code);
    if (member.me.role !== "organizer")
      return err<{ listings: number }>("unauthorized", "Only the organizer can seed the demo.");

    const clues = await ctx.db
      .query("publishedClues")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();
    const now = Date.now();
    const jobId = await ctx.db.insert("researchJobs", {
      roomId,
      knowledgeRevision: member.room.knowledgeRevision,
      publishedClueIds: clues.filter((c) => c.status === "active").map((c) => c._id),
      actingParticipantId: member.me._id,
      brief: {
        knowledgeRevision: member.room.knowledgeRevision,
        queryTerms: ["pottery class", "pottery kit"],
        mustExclude: [],
        ...(member.room.budgetMinor !== undefined ? { budgetMinor: member.room.budgetMinor } : {}),
        occasion: member.room.occasion,
        listingLimit: 12,
      },
      status: "succeeded",
      inputHash: `demo-seed:${now}`,
      idempotencyKey: `demo-seed:${roomId}:${now}`,
      attempt: 1,
      createdAt: now,
    });
    for (const f of FIXTURES)
      await ctx.db.insert("productListings", {
        roomId,
        jobId,
        source: "manual_fixture",
        sourceUrl: `https://example.com/fixture/${f.slug}`,
        title: f.title,
        currency: "USD",
        priceMinor: f.priceMinor,
        priceStatus: "observed",
        availability: f.availability,
        shippingStatus: "unknown",
        retrievedAt: now,
        status: "active",
      });
    return ok({ listings: FIXTURES.length });
  },
});
