import { LiveRoom } from "@/components/room/LiveRoom";

export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <LiveRoom roomId={roomId} />;
}
