"use client";

import type { QuestionPollView } from "@/lib/contracts";
import s from "@/components/world/room/gift-rings.module.css";

/** All members can change their answer. Finishing is an explicit organizer action. */
export function QuestionPoll({ question, poll, pending, onVote, onFinish, onSkip }: {
  question: { question: string; options: { label: string }[] };
  poll: QuestionPollView;
  pending: boolean;
  onVote(option: number | null): void;
  onFinish?(): void;
  onSkip?(): void;
}) {
  const disabled = pending || !poll.open || poll.stale;
  return <div className={s.ask} data-map-token aria-label="Room question vote">
    <small>{poll.open ? "Everyone has a vote · change yours anytime" : "The room’s choice"}</small>
    <p>{question.question}</p>
    <div className={s.askOptions}>
      {question.options.map((option, i) => <button key={i} type="button" aria-pressed={poll.myOption === i}
        disabled={disabled} onClick={() => onVote(poll.myOption === i ? null : i)}>
        {option.label} · {poll.counts[i] ?? 0}{poll.myOption === i ? " · your vote ✓" : ""}
      </button>)}
    </div>
    <small role="status" aria-live="polite">{poll.votedCount} of {poll.memberCount} voted.
      {poll.stale ? " Memories changed. Ask a fresh question." : poll.tied ? " Tied — keep voting or skip."
        : poll.leader !== null ? ` ${question.options[poll.leader]?.label} leads.` : " Choose an answer to steer the gifts."}
    </small>
    <small>Votes steer the shortlist. They don’t publish a fact about the recipient.</small>
    {poll.open && onFinish && <button type="button" className={s.askSkip} disabled={pending || !poll.canFinish} onClick={onFinish}>Continue with the room’s choice</button>}
    {onSkip && <button type="button" className={s.askSkip} disabled={pending} onClick={onSkip}>{poll.open ? "Skip question" : "Back to the map"}</button>}
  </div>;
}
