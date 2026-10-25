"use client";

import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSession } from "@/components/providers/ConvexClientProvider";
import { ErrorText } from "@/components/ui/ErrorText";
import type { AgentCollaboratorView } from "@/lib/agentCollaborators/contracts";
import { useResultAction } from "@/lib/useResultAction";
import { AgentCollaboratorFeed } from "./AgentCollaboratorFeed";

export function GiftTwinStudio({ roomId }: { roomId: string }) {
  const convex = useConvex();
  if (!convex) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <p className="paper-card rounded-[22px] p-6 text-dusk/80">Gift Twin needs a Convex deployment. Set NEXT_PUBLIC_CONVEX_URL and reload.</p>
      </main>
    );
  }
  return <LiveStudio roomId={roomId as Id<"rooms">} />;
}

function LiveStudio({ roomId }: { roomId: Id<"rooms"> }) {
  const session = useSession();
  const ready = session.status === "ready";
  const roomView = useQuery(api.rooms.getRoom, ready ? { roomId } : "skip");
  const feed = useQuery(api.giftTwin.room.getFeed, ready ? { roomId } : "skip");

  if (!ready || roomView === undefined || feed === undefined) return <Shell roomId={roomId}><p className="text-dusk/70">Opening the room…</p></Shell>;
  if (!roomView.ok) return <Shell roomId={roomId}><ErrorText error={roomView.error} /></Shell>;
  if (!feed.ok) return <Shell roomId={roomId}><ErrorText error={feed.error} /></Shell>;

  const { room, me } = roomView.value;
  const twin = feed.value.collaborators.find((c) => c.kind === "gift_twin");
  return (
    <Shell roomId={roomId} title={room.title}>
      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <ConnectCard roomId={roomId} twin={twin} isOrganizer={me.role === "organizer"} recipientName={room.recipientDisplayName} />
        <section className="paper-card rounded-[22px] p-5">
          <h2 className="font-display text-[22px] text-dusk">Collaborators&apos; notes</h2>
          <p className="mb-4 text-[13.5px] text-dusk/65">
            The twin reads the messages the recipient shared and posts gift ideas, then votes up or down on the room&apos;s ideas, including new ones, while its 24-hour vault is open. Unwrap&apos;s gift agent adds what matters to the room.
          </p>
          <AgentCollaboratorFeed feed={feed.value} />
        </section>
      </div>
    </Shell>
  );
}

function Shell({ roomId, title, children }: { roomId: string; title?: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-5 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12.5px] font-semibold uppercase tracking-wide text-dusk/60">Gift Twin · demo</p>
          <h1 className="font-display text-[30px] leading-tight text-dusk">{title ?? "Gift room"}</h1>
        </div>
        <Link href={`/room/${roomId}`} className="text-sm font-medium text-dusk/70 underline underline-offset-4">
          Back to the room
        </Link>
      </header>
      {children}
    </main>
  );
}

function useCountdown(until: number | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  if (!until) return null;
  const left = Math.max(0, until - now);
  return `${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, "0")}`;
}

function vaultLine(twin: AgentCollaboratorView, recipientName: string): string {
  const vault = twin.vault;
  if (!vault) return `Connected, waiting for ${recipientName} to share`;
  switch (vault.status) {
    case "uploading":
      return `Receiving messages (${vault.messageCount} so far)`;
    case "processing":
      return `Reading ${vault.messageCount} messages`;
    case "ready":
      return `Read ${vault.messageCount} messages · voting on new ideas`;
    case "expired":
      return "Messages deleted";
  }
}

function vaultHint(twin: AgentCollaboratorView, recipientName: string): string {
  const vault = twin.vault;
  if (!vault) return `${recipientName} can choose and share messages on their recipient page.`;
  if (vault.status === "ready")
    return `Add ideas to the room and the twin votes on them until ${vault.expiresAt ? new Date(vault.expiresAt).toLocaleString() : "the vault closes"}. Nothing to approve; the gift agent adds what matters.`;
  if (vault.status === "expired") return "The twin's notes and votes stay in the room. It can be shared again to vote on newer ideas.";
  return "The twin's notes appear here as soon as it is done.";
}

function ConnectCard({
  roomId,
  twin,
  isOrganizer,
  recipientName,
}: {
  roomId: Id<"rooms">;
  twin: AgentCollaboratorView | undefined;
  isOrganizer: boolean;
  recipientName: string;
}) {
  const createPairing = useResultAction(useAction(api.giftTwin.room.createPairing));
  const revoke = useResultAction(useMutation(api.giftTwin.room.revokeCollaborator));
  const [code, setCode] = useState<{ value: string; expiresAt: number } | null>(null);
  const [link, setLink] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const countdown = useCountdown(twin?.status === "pending_pairing" ? (code?.expiresAt ?? twin.pairingExpiresAt) : undefined);

  async function issue() {
    const res = await createPairing.run({ roomId });
    if (res.ok) {
      setCode({ value: res.value.pairingCode, expiresAt: res.value.expiresAt });
      setLink(`${window.location.origin}/twin#invite=${encodeURIComponent(res.value.pairingCode)}`);
      setCopyMessage("");
    }
  }

  return (
    <section className="paper-card flex flex-col gap-3 rounded-[22px] p-5">
      <h2 className="font-display text-[22px] text-dusk">{twin ? twin.displayName : `${recipientName}'s Gift Twin`}</h2>

      {!twin && (
        <>
          <p className="text-[14px] text-dusk/75">
            A Gift Twin is an AI agent acting for {recipientName}. With their one-time permission, their Mac uploads the messages they sent to a private
            24-hour vault. The twin joins this room as a collaborator: nobody here can read the messages, only the short notes and votes it posts.
          </p>
          <button type="button" className="btn-primary self-start" onClick={issue} disabled={createPairing.pending}>
            {createPairing.pending ? "Creating a link…" : `Invite ${recipientName}'s Gift Twin`}
          </button>
        </>
      )}

      {twin?.status === "pending_pairing" && (
        <>
          <p className="text-[14px] text-dusk/75">Send this private invitation to {recipientName}. They will read the privacy terms and choose whether to share their messages.</p>
          {code ? (
            <div className="rounded-xl bg-white/70 p-3">
              <p className="text-[12.5px] font-semibold uppercase tracking-wide text-dusk/60">Recipient link · expires in {countdown}</p>
              <input aria-label="Recipient invitation link" readOnly value={link} onFocus={(event) => event.target.select()} className="mt-2 w-full rounded-lg border border-dusk/15 bg-white p-2 text-sm" />
              <button type="button" className="btn-secondary mt-3" onClick={async () => {
                try { await navigator.clipboard.writeText(link); setCopyMessage("Link copied"); }
                catch { setCopyMessage("Select the link above and copy it manually."); }
              }}>Copy recipient link</button>
              <p role="status" className="mt-2 text-sm">{copyMessage}</p>
              <p className="mt-2 text-[12.5px] text-dusk/70">One use only. Only send it to the recipient. Opening it does not join the room or read Messages.</p>
            </div>
          ) : (
            <p className="text-[13px] text-dusk/60">The link was shown once when it was created. Create a new link if you need another; the old one will stop working.</p>
          )}
          <button type="button" className="btn-secondary self-start" onClick={issue} disabled={createPairing.pending}>
            New invitation link
          </button>
        </>
      )}

      {twin?.status === "active" && (
        <>
          <p className="flex items-center gap-2 text-[14px] text-dusk/80">
            <span className={`inline-block size-2.5 rounded-full ${twin.vault?.status === "ready" ? "bg-[#5a9a6e]" : twin.vault?.status === "expired" ? "bg-dusk/30" : "bg-gold"}`} aria-hidden />
            {vaultLine(twin, recipientName)}
            {twin.deviceLabel ? ` · ${twin.deviceLabel}` : ""}
          </p>
          <p className="text-[13.5px] text-dusk/70">{vaultHint(twin, recipientName)}</p>
          {isOrganizer && (
            <button type="button" className="self-start text-[13px] text-[#8c3b2c] underline underline-offset-4" onClick={() => revoke.run({ collaboratorId: twin.id as Id<"agentCollaborators"> })}>
              Disconnect the twin
            </button>
          )}
        </>
      )}

      <ErrorText error={createPairing.error ?? revoke.error} />
    </section>
  );
}
