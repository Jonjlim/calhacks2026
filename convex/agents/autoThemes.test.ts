// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Result } from "../../lib/contracts";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code + ": " + result.error.message);
  return result.value;
}
async function setup() {
  const t = convexTest(schema, modules);
  const alex = t.withIdentity({ subject: "user_alex|session1" });
  const roomId = unwrap(await alex.mutation(api.rooms.createRoom, { title: "Maya", recipientDisplayName: "Maya", occasion: "Birthday" })).room._id;
  const add = async (text: string) => unwrap(await alex.mutation(api.clues.upsertManualPreference, { roomId, kind: "interest", text }))._id;
  const revision = async () => (await t.run((ctx) => ctx.db.get(roomId)))!.knowledgeRevision;
  return { t, alex, roomId, add, revision };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("themes that form on their own", () => {
  it("schedules a regroup a few seconds after each memory change", async () => {
    const s = await setup();
    await s.add("hiking");
    const scheduled = await s.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.filter((f) => f.name.includes("autoRegroup")).at(-1)?.args[0]).toMatchObject({ roomId: s.roomId, revision: await s.revision() });
  });

  it("gives way when a newer memory change has its own regroup coming", async () => {
    const s = await setup();
    const a = await s.add("hiking");
    await s.add("matcha");
    await s.add("bowling");
    await s.t.run((ctx) => ctx.db.insert("mapThemes", { roomId: s.roomId, label: "Outdoors", clueIds: [a], source: "agent", knowledgeRevision: 1, createdAt: 0 }));
    await s.t.action(internal.agents.themes.autoRegroup, { roomId: s.roomId, revision: (await s.revision()) - 1 });
    expect(await s.t.run((ctx) => ctx.db.query("mapThemes").collect())).toHaveLength(1);
  });

  it("lets memories float again when fewer than three remain", async () => {
    const s = await setup();
    const a = await s.add("hiking");
    await s.add("matcha");
    await s.t.run((ctx) => ctx.db.insert("mapThemes", { roomId: s.roomId, label: "Outdoors", clueIds: [a], source: "agent", knowledgeRevision: 1, createdAt: 0 }));
    await s.t.action(internal.agents.themes.autoRegroup, { roomId: s.roomId, revision: await s.revision() });
    expect(await s.t.run((ctx) => ctx.db.query("mapThemes").collect())).toEqual([]);
  });

  it("without a model, leaves the current themes alone and never sorts memories into kind buckets", async () => {
    const s = await setup();
    vi.stubEnv("LLM_API_KEY", "");
    for (const text of ["hiking", "matcha", "bowling"]) await s.add(text);
    await s.t.action(internal.agents.themes.autoRegroup, { roomId: s.roomId, revision: await s.revision() });
    expect(await s.t.run((ctx) => ctx.db.query("mapThemes").collect())).toEqual([]);
  });

  it("keeps a theme's id through a regroup and logs a line only when something changed", async () => {
    const s = await setup();
    const [a, b, c] = [await s.add("hiking"), await s.add("camping"), await s.add("matcha")];
    const rev = await s.revision();
    const themeId = await s.t.run((ctx) => ctx.db.insert("mapThemes", { roomId: s.roomId, label: "Outdoors", clueIds: [a], source: "agent", knowledgeRevision: rev, createdAt: 0 }));
    const store = (themes: { label: string; clueIds: typeof a[] }[]) => s.t.mutation(internal.agents.themes.storeThemes, { roomId: s.roomId, knowledgeRevision: rev, source: "agent", themes });
    await store([{ label: "Loves the outdoors", clueIds: [a, b] }, { label: "Matcha", clueIds: [c] }]);
    const rows = await s.t.run((ctx) => ctx.db.query("mapThemes").collect());
    expect(rows.find((r) => r._id === themeId)).toMatchObject({ label: "Loves the outdoors", clueIds: [a, b] });
    const logged = async () => (await s.t.run((ctx) => ctx.db.query("roomTrail").collect())).filter((e) => e.text.startsWith("Regrouped")).length;
    expect(await logged()).toBe(1);
    await store([{ label: "Loves the outdoors", clueIds: [a, b] }, { label: "Matcha", clueIds: [c] }]);
    expect(await logged()).toBe(1);
  });
});
