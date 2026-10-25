// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "./schema";
import { modules } from "./test.setup";
import { api } from "./_generated/api";
import type { Result } from "../lib/contracts";
function unwrap<T>(r: Result<T>): T { if (!r.ok) throw Error(r.error.message); return r.value; }
it("keeps member ranges private, updates aggregates, and removes departing members", async () => {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({subject:"alice|session"});
  const bob = t.withIdentity({subject:"bob|session"});
  const eve = t.withIdentity({subject:"eve|session"});
  const created = unwrap(await alice.mutation(api.rooms.createRoom,{title:"Gift",recipientDisplayName:"Maya",occasion:"Birthday",displayName:"Alice"}));
  const roomId = created.room._id;
  expect(unwrap(await alice.query(api.budgets.state,{roomId})).range).toBeNull();
  unwrap(await alice.mutation(api.budgets.setRange,{roomId,minMinor:1000,maxMinor:5000}));
  unwrap(await bob.mutation(api.rooms.joinRoom,{inviteToken:created.inviteToken,displayName:"Bob"}));
  expect(unwrap(await bob.query(api.budgets.state,{roomId}))).toMatchObject({range:null,guidance:{lowerMinor:1000,upperMinor:10000,responseCount:1,participantCount:2}});
  unwrap(await bob.mutation(api.budgets.setRange,{roomId,minMinor:3000,maxMinor:9000}));
  const state = unwrap(await alice.query(api.budgets.state,{roomId}));
  expect(state.range?.maxMinor).toBe(5000);
  expect(state.guidance).toMatchObject({lowerMinor:2000,upperMinor:10000,responseCount:2});
  expect((await eve.query(api.budgets.state,{roomId})).ok).toBe(false);
  expect((await eve.mutation(api.budgets.setRange,{roomId,minMinor:0,maxMinor:0})).ok).toBe(false);
  expect((await bob.mutation(api.budgets.setRange,{roomId,minMinor:4000,maxMinor:3000})).ok).toBe(false);
  const before = unwrap(await alice.query(api.rooms.getRoom,{roomId}));
  unwrap(await bob.mutation(api.budgets.setRange,{roomId,minMinor:0,maxMinor:2000}));
  const after = unwrap(await alice.query(api.rooms.getRoom,{roomId}));
  expect(after.room.knowledgeRevision).toBe(before.room.knowledgeRevision);
  expect(await t.run(ctx=>ctx.db.query("contributionLimits").collect())).toEqual([]);
  unwrap(await bob.mutation(api.rooms.leaveRoom,{roomId}));
  expect(unwrap(await alice.query(api.budgets.state,{roomId})).guidance).toMatchObject({lowerMinor:1000,upperMinor:5000,responseCount:1,participantCount:1});
  expect(await t.run(ctx=>ctx.db.query("budgetRanges").collect())).toHaveLength(1);
});
