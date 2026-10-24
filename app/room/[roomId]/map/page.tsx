import type { Metadata } from "next";
import { GiftCanvas } from "@/components/map/GiftCanvas";

export const metadata: Metadata = { title: "Unwrap · Gift map" };

/** The shared gift map: memories as seeds, agent-grown ideas, real products, and the gift box. */
export default async function RoomMapPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <GiftCanvas roomId={roomId} />;
}
