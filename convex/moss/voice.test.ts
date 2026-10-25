import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";

describe("Moss voice call access", () => {
  it("lets room members call and turns everyone else away", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "user_alice|s1" });
    const mallory = t.withIdentity({ subject: "user_mallory|s3" });
    const created = await alice.mutation(api.rooms.createRoom, { title: "Maya", recipientDisplayName: "Maya", occasion: "Birthday", displayName: "Alice" });
    if (!created.ok) throw new Error("room not created");
    const roomId = created.value.room._id;
    expect(await alice.query(api.moss.voice.canCall, { roomId })).toMatchObject({ ok: true });
    expect(await mallory.query(api.moss.voice.canCall, { roomId })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(await t.query(api.moss.voice.canCall, { roomId })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });
});
