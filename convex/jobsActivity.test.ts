// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

it("keeps unfinished research visible beyond ten recent completions, for members only", async () => {
  const t = convexTest(schema, modules);
  const member = t.withIdentity({ subject: "activity-owner" });
  const created = await member.mutation(api.rooms.createRoom, { title: "Activity", recipientDisplayName: "Maya", occasion: "Birthday", displayName: "Alex" });
  if (!created.ok) throw new Error(created.error.message);
  const roomId = created.value.room._id;
  const activeId = await t.run(async (ctx) => {
    const base = { roomId, knowledgeRevision: 0, publishedClueIds: [], attempt: 1 };
    const active = await ctx.db.insert("researchJobs", { ...base, status: "running", inputHash: "active", idempotencyKey: "active", createdAt: 1 });
    for (let i = 0; i < 12; i++) await ctx.db.insert("researchJobs", { ...base, status: "succeeded", inputHash: `done${i}`, idempotencyKey: `done${i}`, createdAt: i + 2 });
    return active;
  });
  const result = await member.query(api.jobs.listRoomJobs, { roomId });
  if (!result.ok) throw new Error(result.error.message);
  expect(result.value.researchJobs.some((job) => job._id === activeId && job.status === "running")).toBe(true);
  expect(new Set(result.value.researchJobs.map((job) => job._id)).size).toBe(result.value.researchJobs.length);
  expect(await t.withIdentity({ subject: "outsider" }).query(api.jobs.listRoomJobs, { roomId })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
});
