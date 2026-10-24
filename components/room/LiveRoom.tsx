"use client";

import { RoomScreen } from "./RoomScreen";

/** Compatibility entry point; the integrated room implementation lives in RoomScreen. */
export function LiveRoom({ roomId }: { roomId: string }) {
  return <RoomScreen roomId={roomId} />;
}
