"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useSession } from "@/components/providers/ConvexClientProvider";
import { ErrorText } from "@/components/ui/ErrorText";
import { extractInviteToken } from "@/lib/invite";
import { guessSurface, phonePath, stagePath } from "@/lib/room/surface";
import { useResultAction } from "@/lib/useResultAction";
import { LIMITS } from "@/lib/validation";

/** QR / invite-link landing (PX-013, BE-013). */
export function JoinRoomForm({ initialToken = "" }: { initialToken?: string }) {
  const convex = useConvex();
  const token = extractInviteToken(initialToken);
  return (
    <div className="paper-card flex flex-col gap-4 rounded-[22px] p-6">
      {convex ? <LiveJoin token={token} /> : <OfflineJoin />}
    </div>
  );
}

function OfflineJoin() {
  return (
    <>
      <h1 className="font-display text-[28px] leading-tight text-dusk">Join a gift room</h1>
      <p className="text-[15px] text-dusk/70">
        This preview build isn&apos;t connected to a backend, so invite links can&apos;t be opened. You can still walk through the demo room.
      </p>
      <Link href="/room/room_demo" className="btn-primary self-start">
        Open the demo room
      </Link>
    </>
  );
}

function LiveJoin({ token }: { token: string }) {
  const session = useSession();
  const router = useRouter();
  const preview = useQuery(api.rooms.previewInvite, session.status === "ready" && token ? { inviteToken: token } : "skip");
  const join = useResultAction(useMutation(api.rooms.joinRoom));
  const [displayName, setDisplayName] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const res = await join.run({ inviteToken: token, displayName });
    // Phones go straight to their controller; laptops to the shared stage.
    if (res.ok) router.push(guessSurface() === "phone" ? phonePath(res.value.room._id) : stagePath(res.value.room._id));
  }

  if (!token) return <JoinProblem message="This invite link is missing its code." />;
  if (session.status === "error") {
    return (
      <>
        <JoinProblem message="We couldn't connect to Unwrap." />
        <button type="button" onClick={session.retry} className="btn-secondary h-11 self-start px-5">
          Try again
        </button>
      </>
    );
  }
  if (session.status !== "ready" || preview === undefined) return <p className="text-[15px] text-dusk/70">Finding the room…</p>;
  if (!preview.ok) return <JoinProblem message={preview.error.message} />;

  const room = preview.value;
  return (
    <>
      <div>
        <p className="text-[12.5px] font-semibold tracking-wide text-dusk/60 uppercase">You&apos;re invited</p>
        <h1 className="font-display mt-1 text-[30px] leading-tight text-dusk">{room.title}</h1>
        <p className="mt-1 text-[15px] text-dusk/70">
          For {room.recipientDisplayName} · {room.occasion} · {room.participantCount} {room.participantCount === 1 ? "person" : "people"} so far
        </p>
      </div>
      {room.alreadyMember ? (
        <Link href={guessSurface() === "phone" ? phonePath(room.roomId) : stagePath(room.roomId)} className="btn-primary self-start">
          You&apos;re already in. Enter the room
        </Link>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-semibold tracking-wide text-dusk/70">Your name</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={LIMITS.displayNameMaxChars}
              placeholder="Sam"
              autoComplete="given-name"
              autoFocus
              className="h-11 rounded-xl border border-dusk/15 bg-white/80 px-3.5 text-[15px] text-dusk outline-none focus:border-dusk/40 focus:ring-4 focus:ring-lilac/70"
            />
          </label>
          <ErrorText error={join.error} />
          <button type="submit" disabled={join.pending || !displayName.trim()} className="btn-primary self-start disabled:opacity-60">
            {join.pending ? "Joining…" : "Join the room"}
          </button>
        </form>
      )}
    </>
  );
}

function JoinProblem({ message }: { message: string }) {
  return (
    <>
      <h1 className="font-display text-[28px] leading-tight text-dusk">Hmm, that didn&apos;t work</h1>
      <p className="text-[15px] text-dusk/70">{message}</p>
      <Link href="/" className="text-sm font-medium text-dusk/70 underline underline-offset-4">
        Back to Unwrap
      </Link>
    </>
  );
}
