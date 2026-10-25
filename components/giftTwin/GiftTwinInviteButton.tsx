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
      <input aria-label="Recipient invitation link" readOnly value={url} onFocus={(event) => event.target.select()} className="sr-only" tabIndex={-1} />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-primary text-[13px]" onClick={send} disabled={expired}>Send link</button>
        <button type="button" className="btn-secondary text-[13px]" onClick={copy} disabled={expired}>Copy link</button>
      </div>
      <p className="mt-2 text-[12px] text-dusk/60">{expired ? "This link expired. Create a new invitation." : `One use · expires at ${new Date(expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}</p>
      <p role="status" className="mt-1 text-[13px] text-dusk/75">{message}</p>
    </div>
  );
}

export function GiftTwinInviteButton({ roomId, recipientName, twin, className, placement = "inline" }: {
  roomId: Id<"rooms">;
  /** `top-center`: a button at the top middle of the screen, and a page that opens in the middle. */
  placement?: "inline" | "top-center";
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

  if (placement === "top-center") {
    return (
      <>
        <button type="button" disabled={pairing.pending} aria-expanded={open} aria-controls={panelId}
          className="paper-card pointer-events-auto absolute top-5 left-1/2 z-30 -translate-x-1/2 rounded-full px-5 py-2.5 text-[14px] font-semibold text-dusk shadow-sm transition hover:-translate-y-0.5"
          onClick={() => invitation && Date.now() < invitation.expiresAt ? setOpen(!open) : void create()}>
          {pairing.pending ? "Getting the link ready…" : `Invite ${recipientName}’s gift twin`}
        </button>
        {open && invitation && (
          <div className="pointer-events-auto fixed inset-0 z-[58] grid place-items-center bg-[rgb(60,40,70,0.28)] p-5 backdrop-blur-[2px]" onClick={() => setOpen(false)}>
            <section id={panelId} role="dialog" aria-modal="true" aria-label={`Invite ${recipientName}’s gift twin`} onClick={(e) => e.stopPropagation()}
              className="w-[min(480px,100%)] rounded-[28px] bg-[linear-gradient(180deg,#fcf6e6,#f6ebd0)] p-7 shadow-[0_34px_70px_-30px_rgba(60,36,30,0.7),0_0_0_1.5px_#c79a6a]">
              <p className="text-[11px] font-bold tracking-[0.14em] text-coral uppercase">Stuck?</p>
              <h2 className="mt-1.5 font-display text-[32px] leading-[1.05] text-dusk">Invite {recipientName}’s gift twin</h2>
              <p className="mt-3 text-[14.5px] leading-snug text-dusk/80">
                A gift twin is a bot that knows all about {recipientName}: what they like, what they have, what they would never wear. It helps your group choose.
              </p>
              <p className="mt-2 text-[14.5px] leading-snug text-dusk/80">
                You are <b>not</b> inviting {recipientName}. You are inviting the twin that knows them. Give this link <b>only to {recipientName}</b>. If they accept, their gift twin joins the collaboration.
              </p>
              <RecipientInvitationLink {...invitation} recipientName={recipientName} />
              <div className="mt-4 flex items-center justify-between">
                <button type="button" className="text-[12px] text-dusk/65 underline underline-offset-2" onClick={create} disabled={pairing.pending}>Make a new link</button>
                <button type="button" className="btn-secondary h-10 px-5 text-[13.5px]" onClick={() => setOpen(false)}>Close</button>
              </div>
            </section>
          </div>
        )}
        {pairing.error && <div className="paper-card pointer-events-auto absolute top-20 left-1/2 z-30 -translate-x-1/2 rounded-xl p-3"><ErrorText error={pairing.error} onDismiss={pairing.clearError} /></div>}
      </>
    );
  }

  return (
    <div className="flex max-w-[min(300px,calc(100vw-40px))] flex-col items-end">
      <button type="button" className={className} disabled={pairing.pending} aria-expanded={open} aria-controls={panelId}
        onClick={() => invitation && Date.now() < invitation.expiresAt ? setOpen(!open) : void create()}>
        {pairing.pending ? "Creating recipient link…" : `Invite ${recipientName}’s gift twin`}
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
      {pairing.error && <div className="paper-card mt-2 rounded-xl p-3"><ErrorText error={pairing.error} onDismiss={pairing.clearError} /></div>}
    </div>
  );
}
