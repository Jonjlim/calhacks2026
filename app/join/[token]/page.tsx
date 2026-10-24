import { JoinRoomForm } from "@/components/room/JoinRoomForm";

// QR / invite-link landing (PX-013, BE-013).
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="min-h-dvh bg-paper px-6 py-16">
      <div className="mx-auto max-w-md">
        <JoinRoomForm initialToken={decodeURIComponent(token)} />
      </div>
    </main>
  );
}
