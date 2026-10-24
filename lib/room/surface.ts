/**
 * Which presentation suits this device: the shared 3D stage (laptop / TV) or
 * the lightweight phone controller. Presentation only; it never grants or
 * removes permissions (those come from room membership and the organizer role
 * on the server). `?surface=stage|phone` overrides the guess.
 */
export type RoomSurface = "stage" | "phone";

export function guessSurface(): RoomSurface {
  if (typeof window === "undefined") return "stage";
  const forced = new URLSearchParams(window.location.search).get("surface");
  if (forced === "stage" || forced === "phone") return forced;
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const narrow = window.matchMedia("(max-width: 767px)").matches;
  return touch && narrow ? "phone" : "stage";
}

export const phonePath = (roomId: string) => `/room/${roomId}/phone`;
export const stagePath = (roomId: string) => `/room/${roomId}`;
