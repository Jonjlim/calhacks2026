"use client";

import { useMutation } from "convex/react";
import { useMemo } from "react";
import { api } from "@/convex/_generated/api";
import { mockLandingActions, type LandingActions } from "@/lib/mocks/landing";
import { errorText } from "./result";

function useConvexLandingActions(): LandingActions {
  const createRoom = useMutation(api.rooms.createRoom);
  const joinRoom = useMutation(api.rooms.joinRoom);
  return useMemo<LandingActions>(
    () => ({
      async createRoom(draft) {
        try {
          const res = await createRoom({
            title: `${draft.recipientDisplayName}'s ${draft.occasion}`.slice(0, 80),
            recipientDisplayName: draft.recipientDisplayName,
            occasion: draft.occasion,
            displayName: draft.displayName,
          });
          return res.ok
            ? { ok: true, value: { roomId: res.value.room._id, source: "convex" } }
            : res;
        } catch (e) {
          return { ok: false, error: { code: "unknown", message: errorText(e) } };
        }
      },
      async joinRoom(draft) {
        try {
          const res = await joinRoom({ inviteToken: draft.inviteToken, displayName: draft.displayName });
          return res.ok
            ? { ok: true, value: { roomId: res.value.room._id, source: "convex" } }
            : res;
        } catch (e) {
          return { ok: false, error: { code: "unknown", message: errorText(e) } };
        }
      },
    }),
    [createRoom, joinRoom],
  );
}

const useMockLandingActions = () => mockLandingActions;

/** Chosen once per build, so hook order never changes: live Convex when a deployment is configured, fixtures otherwise. */
export const useLandingActions: () => LandingActions = process.env.NEXT_PUBLIC_CONVEX_URL
  ? useConvexLandingActions
  : useMockLandingActions;
