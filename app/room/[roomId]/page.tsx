import { RoomScreen } from "@/components/room/RoomScreen";

export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <RoomScreen roomId={roomId} />;
}
