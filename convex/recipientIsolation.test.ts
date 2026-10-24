// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/**
 * BE-016: recipient-authorized tables stay isolated from every room-visible
 * query. Dev 3 owns the recipient operations; Dev 2 checks the room boundary.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Result } from "../lib/contracts";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("RECIPIENT_AGENT_DEMO_ENABLED", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("recipient preference isolation", () => {
  it("never returns recipient profiles, preferences, or grants from room queries", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "user_alice|s1" });
    const bob = t.withIdentity({ subject: "user_bob|s2" });
    const created = unwrap(
      await alice.mutation(api.rooms.createRoom, {
        title: "Maya",
        recipientDisplayName: "Maya",
        occasion: "Birthday",
        displayName: "Alice",
      }),
    );
    const roomId = created.room._id;
    unwrap(await bob.mutation(api.rooms.joinRoom, { inviteToken: created.inviteToken, displayName: "Bob" }));
    const { recipientProfileId } = unwrap(await alice.mutation(api.agents.recipient.createProfile, { roomId }));
    const secret = "Secretly collects vintage fountain pens";
    unwrap(
      await alice.mutation(api.agents.recipient.updateRecipientPreferences, {
        recipientProfileId,
        preferences: [{ category: "interest", text: secret, authorized: true, disclosable: true }],
        grants: [{ category: "interest", allowedQuestionTypes: ["suitability"] }],
      }),
    );

    for (const who of [alice, bob]) {
      const views = await Promise.all([
        who.query(api.rooms.getRoom, { roomId }),
        who.query(api.rooms.listMyRooms, {}),
        who.query(api.rooms.previewInvite, { inviteToken: created.inviteToken }),
        who.query(api.messages.listMessages, { roomId }),
        who.query(api.clues.listPublishedClues, { roomId }),
        who.query(api.clues.listMyProposedClues, { roomId }),
        who.query(api.proposals.getProposal, { roomId }),
        who.query(api.proposals.listRevisions, { roomId }),
        who.query(api.jobs.listRoomJobs, { roomId }),
        who.query(api.agents.buyer.listActivity, { roomId }),
        who.query(api.payments.state.getPaymentStatus, { roomId }),
      ]);
      const json = JSON.stringify(views);
      expect(json).not.toContain(secret);
      expect(json).not.toContain(recipientProfileId);
    }
    expect(await bob.query(api.agents.recipient.getMyProfile, { roomId })).toMatchObject({ ok: false });
  });
});
