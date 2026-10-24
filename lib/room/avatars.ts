/**
 * Which storybook spirit each friend is, shared by the 3D stage and the
 * phone controller so both always agree. Assigned by join order (earliest
 * first) because participants have no stored avatar choice yet. Pure data:
 * importing this never loads Three.js.
 */
export const AVATAR_IDS = ["explorer", "dreamer", "kind", "calm", "curious"] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];

export const AVATAR_LABEL: Record<AvatarId, string> = {
  explorer: "Explorer",
  dreamer: "Dreamer",
  kind: "Kind",
  calm: "Calm",
  curious: "Curious",
};

export const avatarForIndex = (i: number): AvatarId => AVATAR_IDS[((i % AVATAR_IDS.length) + AVATAR_IDS.length) % AVATAR_IDS.length]!;

/** Participants in join order, the order both surfaces use for seats and spirits. */
export function inJoinOrder<T extends { id: string; joinedAt?: number }>(participants: readonly T[]): T[] {
  return [...participants].sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || a.id.localeCompare(b.id));
}

export function avatarFor(participants: readonly { id: string; joinedAt?: number }[], participantId: string): AvatarId {
  return avatarForIndex(Math.max(0, inJoinOrder(participants).findIndex((p) => p.id === participantId)));
}

export const portraitUrl = (id: AvatarId) => `/avatars/portraits/${id}.png`;
