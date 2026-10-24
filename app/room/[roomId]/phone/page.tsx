import type { Metadata, Viewport } from "next";
import { RoomScreen } from "@/components/room/RoomScreen";

export const metadata: Metadata = { title: "Unwrap · Your notes" };
// Keyboard-safe: the layout viewport shrinks for the on-screen keyboard instead of covering the form.
export const viewport: Viewport = { width: "device-width", initialScale: 1, interactiveWidget: "resizes-content", themeColor: "#fbf7f0" };

/** The participant's phone controller for a room. No 3D scene is loaded here. */
export default async function RoomPhonePage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <RoomScreen roomId={roomId} surface="phone" />;
}
