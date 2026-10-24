import { ChatPanel } from "@/components/chat/ChatPanel";
import { ProposedClueReview } from "@/components/clues/ProposedClueReview";
import { PublishedClueRail } from "@/components/clues/PublishedClueRail";
import { GiftMap } from "@/components/map/GiftMap";
import { ProductShortlist } from "@/components/products/ProductShortlist";
import { ProposalPanel } from "@/components/proposal/ProposalPanel";
import {
  chatQuery,
  myProposedCluesQuery,
  proposalQuery,
  publishedCluesQuery,
  recommendationsQuery,
  roomQuery,
} from "@/lib/mocks/queries";

// Reads from in-memory mocks until the Convex queries are implemented.
export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const { room, participants, me } = roomQuery(roomId);
  const publishedClues = publishedCluesQuery(roomId);
  const { recommendations, listings } = recommendationsQuery(roomId);

  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-6 py-8 lg:grid-cols-[1fr_1.4fr_1fr]">
      <header className="lg:col-span-3">
        <h1 className="text-2xl font-semibold text-plum">{room.title}</h1>
        <p className="text-sm text-plum-soft">
          For {room.recipientDisplayName} · {room.occasion} · {participants.length} in the room
        </p>
      </header>

      <section className="flex flex-col gap-6">
        <ChatPanel messages={chatQuery(roomId)} participants={participants} />
      </section>

      <section className="flex flex-col gap-6">
        <ProductShortlist recommendations={recommendations} listings={listings} />
        <GiftMap />
      </section>

      <section className="flex flex-col gap-6">
        <ProposedClueReview clues={myProposedCluesQuery()} />
        <PublishedClueRail clues={publishedClues} />
        <ProposalPanel proposal={proposalQuery(roomId)} participants={participants} me={me} />
      </section>
    </main>
  );
}
