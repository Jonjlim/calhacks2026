"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { type FormEvent, type InputHTMLAttributes, type ReactNode, useId, useState } from "react";
import type { AppError } from "@/lib/contracts";
import { type LandingActions, type LandingRoomEntry, MOCK_INVITE_TOKEN } from "@/lib/mocks/landing";

type View =
  | { kind: "choose" }
  | { kind: "create" }
  | { kind: "join" }
  | { kind: "entered"; entry: LandingRoomEntry; via: "create" | "join" };

const spring = { type: "spring", stiffness: 420, damping: 26 } as const;
const swap = {
  initial: { opacity: 0, y: 10, filter: "blur(4px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -8, filter: "blur(4px)" },
  transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] },
} as const;

export function CreateJoinPanel({ actions, joinRequest }: { actions: LandingActions; joinRequest: number }) {
  const [view, setView] = useState<View>({ kind: "choose" });
  const [lastJoinRequest, setLastJoinRequest] = useState(joinRequest);
  // The header's "Join a room" link opens the join form.
  if (joinRequest !== lastJoinRequest) {
    setLastJoinRequest(joinRequest);
    setView({ kind: "join" });
  }

  return (
    <div className="relative min-h-[236px]">
      <AnimatePresence mode="wait" initial={false}>
        {view.kind === "choose" && (
          <motion.div key="choose" {...swap} className="flex flex-col items-start gap-3">
            <PrimaryButton onClick={() => setView({ kind: "create" })}>
              Create a gift room
              <Arrow />
            </PrimaryButton>
            <SecondaryButton onClick={() => setView({ kind: "join" })}>Join with a code</SecondaryButton>
            <motion.p
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.6, duration: 1 }}
              className="font-hand absolute top-[34px] left-[308px] flex w-[200px] items-start gap-1.5 text-[22px] leading-[1.05] text-dusk/60"
            >
              <svg width="40" height="30" viewBox="0 0 40 30" fill="none" className="mt-3 shrink-0 rotate-[160deg]">
                <path d="M37 4C31 17 20 25 4 26M10 20.5c-2.4 2.3-4.2 4-6 5.5 2.6.9 5 2.2 7.2 3.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span>
                psst… the present
                <br />
                likes to be tapped
              </span>
            </motion.p>
          </motion.div>
        )}
        {view.kind === "create" && (
          <motion.div key="create" {...swap}>
            <CreateForm actions={actions} onBack={() => setView({ kind: "choose" })} onEntered={(entry) => setView({ kind: "entered", entry, via: "create" })} />
          </motion.div>
        )}
        {view.kind === "join" && (
          <motion.div key="join" {...swap}>
            <JoinForm actions={actions} onBack={() => setView({ kind: "choose" })} onEntered={(entry) => setView({ kind: "entered", entry, via: "join" })} />
          </motion.div>
        )}
        {view.kind === "entered" && (
          <motion.div key="entered" {...swap}>
            <EnteredCard entry={view.entry} via={view.via} onBack={() => setView({ kind: "choose" })} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CreateForm({ actions, onBack, onEntered }: { actions: LandingActions; onBack: () => void; onEntered: (e: LandingRoomEntry) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const res = await actions.createRoom({
      recipientDisplayName: String(data.get("recipientDisplayName") ?? ""),
      occasion: String(data.get("occasion") ?? ""),
      displayName: String(data.get("displayName") ?? ""),
    });
    setPending(false);
    if (res.ok) onEntered(res.value);
    else setError(res.error);
  }

  return (
    <FormCard title="Start a gift room" onBack={onBack} onSubmit={submit} error={error}>
      <Field name="recipientDisplayName" label="Who is the gift for?" placeholder="Maya" autoFocus />
      <Field name="occasion" label="What's the occasion?" placeholder="Her 25th birthday" />
      <Field name="displayName" label="Your name" placeholder="Alex" autoComplete="given-name" />
      <SubmitButton pending={pending} idle="Open the room" busy="Opening…" />
    </FormCard>
  );
}

function JoinForm({ actions, onBack, onEntered }: { actions: LandingActions; onBack: () => void; onEntered: (e: LandingRoomEntry) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const res = await actions.joinRoom({
      inviteToken: String(data.get("inviteToken") ?? ""),
      displayName: String(data.get("displayName") ?? ""),
    });
    setPending(false);
    if (res.ok) onEntered(res.value);
    else setError(res.error);
  }

  return (
    <FormCard title="Join a gift room" onBack={onBack} onSubmit={submit} error={error}>
      <Field name="inviteToken" label="Invite code" placeholder="paste your code" autoFocus autoComplete="off" spellCheck={false} />
      <Field name="displayName" label="Your name" placeholder="Sam" autoComplete="given-name" />
      <p className="text-[12.5px] leading-snug text-dusk/60">
        Preview build — try <code className="rounded bg-dusk/[0.06] px-1 py-0.5 font-mono text-[11.5px] text-dusk/80">{MOCK_INVITE_TOKEN}</code>
      </p>
      <SubmitButton pending={pending} idle="Join the room" busy="Finding it…" />
    </FormCard>
  );
}

function EnteredCard({ entry, via, onBack }: { entry: LandingRoomEntry; via: "create" | "join"; onBack: () => void }) {
  const mock = entry.source === "mock";
  return (
    <div role="status" className="paper-card w-full max-w-[400px] rounded-[22px] p-6">
      {mock && (
        <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-gold/25 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-dusk/80 uppercase">
          <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden />
          Preview mode
        </span>
      )}
      <h2 className="font-display text-[28px] leading-tight text-dusk">{via === "create" ? "Your room is ready to try." : "You found the room."}</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-dusk/70">
        {mock
          ? "Rooms aren't saved yet — the backend isn't connected in this build. You can walk through the demo room instead."
          : "Step inside and start gathering clues with your friends."}
      </p>
      <div className="mt-5 flex items-center gap-4">
        <motion.span whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} transition={spring} className="inline-flex">
          <Link href={`/room/${entry.roomId}`} className="btn-primary">
            {mock ? "Open the demo room" : "Enter the room"}
            <Arrow />
          </Link>
        </motion.span>
        <button type="button" onClick={onBack} className="text-sm font-medium text-dusk/60 underline-offset-4 hover:text-dusk hover:underline">
          Back
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function FormCard({
  title,
  children,
  onBack,
  onSubmit,
  error,
}: {
  title: string;
  children: ReactNode;
  onBack: () => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  error: AppError | null;
}) {
  return (
    <form onSubmit={onSubmit} noValidate className="paper-card flex w-full max-w-[400px] flex-col gap-3.5 rounded-[22px] p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-[26px] leading-none text-dusk">{title}</h2>
        <button type="button" onClick={onBack} className="text-sm font-medium text-dusk/55 underline-offset-4 hover:text-dusk hover:underline">
          Back
        </button>
      </div>
      {children}
      <AnimatePresence>
        {error && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-xl bg-coral-soft/20 px-3 py-2 text-[13.5px] text-[#8c3b2c]"
          >
            {error.message}
          </motion.p>
        )}
      </AnimatePresence>
    </form>
  );
}

function Field({ name, label, ...rest }: { name: string; label: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-semibold tracking-wide text-dusk/70">{label}</span>
      <input
        id={id}
        name={name}
        maxLength={80}
        className="h-11 rounded-xl border border-dusk/15 bg-white/80 px-3.5 text-[15px] text-dusk shadow-[inset_0_1px_2px_rgba(65,52,76,0.06)] outline-none transition placeholder:text-dusk/35 focus:border-dusk/40 focus:bg-white focus:ring-4 focus:ring-lilac/70"
        {...rest}
      />
    </label>
  );
}

function SubmitButton({ pending, idle, busy }: { pending: boolean; idle: string; busy: string }) {
  return (
    <motion.button type="submit" disabled={pending} whileHover={pending ? undefined : { y: -2 }} whileTap={{ scale: 0.97 }} transition={spring} className="btn-primary mt-1 self-start disabled:opacity-70">
      {pending ? busy : idle}
      {!pending && <Arrow />}
    </motion.button>
  );
}

function PrimaryButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <motion.button type="button" onClick={onClick} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} transition={spring} className="btn-primary h-[58px] min-w-[284px] justify-between px-7 text-[17px]">
      {children}
    </motion.button>
  );
}

function SecondaryButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <motion.button type="button" onClick={onClick} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} transition={spring} className="btn-secondary h-[58px] min-w-[284px] px-7 text-[17px]">
      {children}
    </motion.button>
  );
}

function Arrow() {
  return (
    <svg width="22" height="12" viewBox="0 0 22 12" fill="none" aria-hidden className="shrink-0">
      <path d="M1 6.2c6.5-.4 12.8-.3 19 0M15.5 1.2c1.6 1.9 3.1 3.5 4.9 4.9-1.9 1.3-3.4 2.9-4.8 4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
