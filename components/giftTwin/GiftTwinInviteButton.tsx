"use client";

import { useAction } from "convex/react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { AgentCollaboratorView } from "@/lib/agentCollaborators/contracts";
import { appOrigin, inviteUrl } from "@/lib/invite";
import { useResultAction } from "@/lib/useResultAction";
import { ErrorText } from "@/components/ui/ErrorText";

interface RecipientInvitation {
  url: string;
  expiresAt: number;
}

/** The recipient invitation stays separate from the room's friend-join link. */
export function RecipientInvitationLink({ url, expiresAt, recipientName }: RecipientInvitation & { recipientName: string }) {
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState(() => Date.now() >= expiresAt);
  useEffect(() => {
    setMessage("");
    setExpired(Date.now() >= expiresAt);
    const timer = setTimeout(() => setExpired(true), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [url, expiresAt]);

  async function copy() {
    if (Date.now() >= expiresAt) return setExpired(true);
    try {
      await navigator.clipboard.writeText(url);
      setMessage(`Link copied. Send it privately to ${recipientName}.`);
    } catch {
      setMessage("Select the link above and copy it manually.");
    }
  }

  async function send() {
    if (Date.now() >= expiresAt) return setExpired(true);
    if (typeof navigator.share !== "function") return copy();
    try {
      await navigator.share({
        title: "Your Gift Twin invitation",
        text: `${recipientName}, connect your Gift Twin to help your friends choose a thoughtful gift. You choose whether to share your messages.`,
        url,
      });
      setMessage("Link shared with your selected app.");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setMessage("Sharing canceled. You can still copy the link.");
      } else {
        await copy();
      }
    }
  }

  return (
    <div className="mt-3 rounded-xl bg-white/60 p-3 text-left">
      <p className="text-[13px] text-dusk/75">Only send this to {recipientName}. They choose whether to connect; this does not join them to the gift room.</p>
      <input aria-label="Recipient invitation link" readOnly value={url} onFocus={(event) => event.target.select()}
        className="mt-3 w-full rounded-lg border border-dusk/15 bg-white p-2 text-sm text-dusk" />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-primary text-[13px]" onClick={send} disabled={expired}>Send link</button>
        <button type="button" className="btn-secondary text-[13px]" onClick={copy} disabled={expired}>Copy recipient link</button>
      </div>
      <p className="mt-2 text-[12px] text-dusk/60">{expired ? "This link expired. Create a new invitation." : `One use · expires at ${new Date(expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}</p>
      <p role="status" className="mt-1 text-[13px] text-dusk/75">{message}</p>
    </div>
  );
}

export function GiftTwinInviteButton({ roomId, recipientName, twin, className }: {
  roomId: Id<"rooms">;
  recipientName: string;
  twin?: AgentCollaboratorView;
  className?: string;
}) {
  const pairing = useResultAction(useAction(api.giftTwin.room.createPairing));
  const [invitation, setInvitation] = useState<RecipientInvitation | null>(null);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  useEffect(() => {
    if (twin?.status === "active") {
      setInvitation(null);
      setOpen(false);
    } else if (twin?.pairingExpiresAt) {
      // Another member may have replaced the single-use invitation.
      setInvitation((current) => current && twin.pairingExpiresAt! > current.expiresAt ? null : current);
    }
  }, [twin?.status, twin?.pairingExpiresAt]);

  async function create() {
    const result = await pairing.run({ roomId });
    if (!result.ok) return;
    setInvitation({
      url: inviteUrl(`/twin#invite=${encodeURIComponent(result.value.pairingCode)}`, appOrigin(window.location.origin)),
      expiresAt: result.value.expiresAt,
    });
    setOpen(true);
  }

  if (twin?.status === "active") {
    return <Link href={`/room/${roomId}/twin`} className={className}>Gift Twin connected</Link>;
  }

  return (
    <div className="flex max-w-[min(300px,calc(100vw-40px))] flex-col items-end">
      <button type="button" className={className} disabled={pairing.pending} aria-expanded={open} aria-controls={panelId}
        onClick={() => invitation && Date.now() < invitation.expiresAt ? setOpen(!open) : void create()}>
        {pairing.pending ? "Creating recipient link…" : "Send Gift Twin link"}
      </button>
      {open && invitation && (
        <section id={panelId} aria-label="Invite the gift recipient" className="paper-card mt-2 w-full rounded-[20px] p-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-[20px] text-dusk">Invite {recipientName}</h2>
            <button type="button" className="text-[12px] text-dusk/60" onClick={() => setOpen(false)}>Hide</button>
          </div>
          <RecipientInvitationLink {...invitation} recipientName={recipientName} />
          <button type="button" className="mt-3 text-[12px] text-dusk/65 underline underline-offset-2" onClick={create} disabled={pairing.pending}>Create a new invitation</button>
        </section>
      )}
      {pairing.error && <div className="paper-card mt-2 rounded-xl p-3"><ErrorText error={pairing.error} /></div>}
    </div>
  );
}
