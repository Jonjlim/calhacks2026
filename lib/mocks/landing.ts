/**
 * Typed create/join handlers for the landing page. The mock implementation
 * validates input the way the real `createRoom` / `joinRoom` mutations will
 * (docs/CONTRACTS.md) but never pretends a room was saved: every success is
 * tagged `source: "mock"` and points at the fixture demo room.
 *
 * Swap `mockLandingActions` for a Convex-backed implementation once BE-002
 * lands; the UI only depends on the `LandingActions` interface.
 */
import { z } from "zod";
import type { Result } from "@/lib/contracts";
import { LIMITS } from "@/lib/validation";
import { mockRoom } from "./fixtures";

const name = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Add ${label}.`)
    .max(LIMITS.displayNameMaxChars, `Keep ${label} under ${LIMITS.displayNameMaxChars} characters.`);

export const createRoomDraftSchema = z.strictObject({
  recipientDisplayName: name("who the gift is for"),
  occasion: z
    .string()
    .trim()
    .min(1, "Add the occasion.")
    .max(LIMITS.roomTitleMaxChars, `Keep the occasion under ${LIMITS.roomTitleMaxChars} characters.`),
  displayName: name("your name"),
});

export const joinRoomDraftSchema = z.strictObject({
  inviteToken: z.string().trim().min(1, "Add your invite code.").max(64, "That code looks too long."),
  displayName: name("your name"),
});

export type CreateRoomDraft = z.infer<typeof createRoomDraftSchema>;
export type JoinRoomDraft = z.infer<typeof joinRoomDraftSchema>;

export interface LandingRoomEntry {
  roomId: string;
  /** `mock` means nothing was persisted; the UI must say so. */
  source: "mock" | "convex";
}

export interface LandingActions {
  createRoom(draft: CreateRoomDraft): Promise<Result<LandingRoomEntry>>;
  joinRoom(draft: JoinRoomDraft): Promise<Result<LandingRoomEntry>>;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function invalid(error: z.ZodError): Result<never> {
  return { ok: false, error: { code: "validation_failed", message: error.issues[0]?.message ?? "Check the form." } };
}

export const MOCK_INVITE_TOKEN = mockRoom.inviteToken;

export const mockLandingActions: LandingActions = {
  async createRoom(draft) {
    const parsed = createRoomDraftSchema.safeParse(draft);
    if (!parsed.success) return invalid(parsed.error);
    await wait(650);
    return { ok: true, value: { roomId: mockRoom.id, source: "mock" } };
  },
  async joinRoom(draft) {
    const parsed = joinRoomDraftSchema.safeParse(draft);
    if (!parsed.success) return invalid(parsed.error);
    await wait(550);
    if (parsed.data.inviteToken !== MOCK_INVITE_TOKEN) {
      return { ok: false, error: { code: "not_found", message: "We couldn't find a room with that code." } };
    }
    return { ok: true, value: { roomId: mockRoom.id, source: "mock" } };
  },
};
