import type { Metadata } from "next";
import { GiftTwinStudio } from "@/components/giftTwin/GiftTwinStudio";

export const metadata: Metadata = { title: "Unwrap · Gift Twin" };

/** Demo surface for agent collaborators. Separate from the main room so it can be mounted later without conflicts. */
export default async function RoomTwinPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <GiftTwinStudio roomId={roomId} />;
}
