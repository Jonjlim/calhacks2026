import { useSyncExternalStore } from "react";
import type { AvatarId } from "@/lib/room/avatars";

/**
 * The lobby's confirmed participants, mirrored from the Convex `getRoom`
 * subscription (InvitationTag) for the 3D scene, which spawns one spirit per
 * entry. Display data only: id, name, role and assigned spirit. Never filled
 * from timers or fixtures — an entry exists only once the backend says so.
 */
export interface LobbyMember {
  id: string;
  displayName: string;
  role: "organizer" | "contributor";
  avatar: AvatarId;
}

type Listener = () => void;

class LobbyStore {
  members: readonly LobbyMember[] = [];
  /** Members already in the room when a lobby was restored: they appear without an arrival. */
  settled = new Set<string>();
  private listeners = new Set<Listener>();

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  set(members: readonly LobbyMember[]) {
    const same = members.length === this.members.length && members.every((m, i) => {
      const prev = this.members[i];
      return prev && prev.id === m.id && prev.displayName === m.displayName && prev.avatar === m.avatar;
    });
    if (same) return;
    this.members = members;
    this.listeners.forEach((fn) => fn());
  }

  clear() {
    this.settled.clear();
    this.set([]);
  }
}

export const lobby = new LobbyStore();

export function useLobbyMembers(): readonly LobbyMember[] {
  return useSyncExternalStore(lobby.subscribe, () => lobby.members, () => lobby.members);
}
