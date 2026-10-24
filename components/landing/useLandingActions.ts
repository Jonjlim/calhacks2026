"use client";

import { type ConvexReactClient, useConvex } from "convex/react";
import { useMemo } from "react";
import { api } from "@/convex/_generated/api";
import { useSession } from "@/components/providers/ConvexClientProvider";
import type { Result } from "@/lib/contracts";
import { settle } from "@/lib/client";
import { extractInviteToken } from "@/lib/invite";
import {
  createRoomDraftSchema,
  invalidDraft,
  joinRoomDraftSchema,
  type LandingActions,
  type LandingRoomEntry,
  mockLandingActions,
} from "@/lib/mocks/landing";
import { LIMITS } from "@/lib/validation";

const NOT_CONNECTED: Result<never> = {
  ok: false,
  error: { code: "unknown", message: "We couldn't connect to Unwrap. Check your connection and try again." },
};

function roomTitle(recipient: string): string {
  return `Gift for ${recipient}`.slice(0, LIMITS.roomTitleMaxChars);
}

function convexLandingActions(convex: ConvexReactClient, ensureReady: () => Promise<boolean>): LandingActions {
  return {
    source: "convex",
    async createRoom(draft) {
      const parsed = createRoomDraftSchema.safeParse(draft);
      if (!parsed.success) return invalidDraft(parsed.error);
      if (!(await ensureReady())) return NOT_CONNECTED;
      const res = await settle(
        convex.mutation(api.rooms.createRoom, {
          title: roomTitle(parsed.data.recipientDisplayName),
          recipientDisplayName: parsed.data.recipientDisplayName,
          occasion: parsed.data.occasion,
          displayName: parsed.data.displayName,
        }),
      );
      return res.ok ? { ok: true, value: { roomId: res.value.room._id, source: "convex", inviteToken: res.value.inviteToken } satisfies LandingRoomEntry } : res;
    },
    async joinRoom(draft) {
      const parsed = joinRoomDraftSchema.safeParse({ ...draft, inviteToken: extractInviteToken(draft.inviteToken) });
      if (!parsed.success) return invalidDraft(parsed.error);
      if (!(await ensureReady())) return NOT_CONNECTED;
      const res = await settle(convex.mutation(api.rooms.joinRoom, parsed.data));
      return res.ok ? { ok: true, value: { roomId: res.value.room._id, source: "convex", inviteToken: res.value.room.inviteToken } satisfies LandingRoomEntry } : res;
    },
  };
}

/** Convex-backed create/join when a deployment is configured; otherwise the labeled mock. */
export function useLandingActions(): LandingActions {
  const convex = useConvex();
  const { ensureReady } = useSession();
  return useMemo(() => (convex ? convexLandingActions(convex, ensureReady) : mockLandingActions), [convex, ensureReady]);
}
