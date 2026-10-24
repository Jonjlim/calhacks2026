"use client";

import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Panel } from "@/components/ui/Panel";
import { unwrap } from "@/lib/live/result";

const UNKNOWN = "unknown";
const num = (n: number | null | undefined) => (n === null || n === undefined ? UNKNOWN : n.toLocaleString());

function ms(value: number | null): string {
  if (value === null) return UNKNOWN;
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s`;
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="border-t border-plum/10 pt-2 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-plum-soft">
        {title}
        {note && <span className="ml-2 font-normal normal-case text-coral">{note}</span>}
      </h3>
      <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-sm">{children}</dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-plum-soft">{label}</dt>
      <dd className={`text-right ${value.startsWith(UNKNOWN) ? "text-plum-soft italic" : "font-medium"}`}>{value}</dd>
    </>
  );
}

/** Every value comes from recorded rows; anything the backend reports as null shows as unknown. */
export function StatsPanel({ roomId }: { roomId: Id<"rooms"> }) {
  const stats = unwrap(useQuery(api.agents.stats.getRoomStats, { roomId }));
  const title = "How Unwrap worked on this gift";

  if (stats.loading)
    return (
      <Panel title={title}>
        <p className="text-sm text-plum-soft">Loading…</p>
      </Panel>
    );
  if (stats.error || !stats.value)
    return (
      <Panel title={title}>
        <p className="text-sm text-coral">{stats.error?.message ?? "Stats are unavailable."}</p>
      </Panel>
    );

  const s = stats.value;
  const lower = s.model.tokensComplete ? "" : "at least ";
  const tokens = (n: number | null) => (n === null ? UNKNOWN : `${lower}${n.toLocaleString()}`);
  const calls =
    s.model.calls === 0
      ? UNKNOWN
      : s.model.tokensComplete
        ? s.model.calls.toLocaleString()
        : `${s.model.calls.toLocaleString()} (${s.model.reportedCalls.toLocaleString()} reported usage)`;
  const d = s.listings.dropped;

  return (
    <Panel title={title}>
      <div className="flex flex-col gap-3">
        <Group title="Model" note="your own activity only">
          <Row label="Agent tasks" value={num(s.model.jobs)} />
          <Row label="Model calls" value={calls} />
          <Row label="Input tokens" value={tokens(s.model.inputTokens)} />
          <Row label="Output tokens" value={tokens(s.model.outputTokens)} />
          <Row
            label="Cost"
            value={s.model.costUsd === null ? "unknown (no pricing configured)" : `$${s.model.costUsd.toFixed(4)}`}
          />
        </Group>
        <Group title="Speed">
          <Row
            label={`Median question to answer${s.timing.samples > 0 ? ` (${s.timing.samples} answered)` : ""}`}
            value={s.timing.samples === 0 ? UNKNOWN : ms(s.timing.medianAnswerMs)}
          />
        </Group>
        <Group title="Clues">
          <Row label="You proposed" value={num(s.clues.mine.proposed)} />
          <Row label="You published" value={num(s.clues.mine.published)} />
          <Row label="You discarded" value={num(s.clues.mine.discarded)} />
          <Row label="Room: active clues" value={num(s.clues.room.active)} />
          <Row label="Room: withdrawn clues" value={num(s.clues.room.withdrawn)} />
        </Group>
        <Group title="Listings">
          <Row label="Shown" value={num(s.listings.shown)} />
          <Row label="Ruled out by a confirmed clue" value={num(d.excluded_by_clue)} />
          <Row label="No longer available" value={num(d.unavailable)} />
          <Row label="Listing no longer valid" value={num(d.inactive)} />
        </Group>
        <Group title="Recipient agent">
          <Row label="Questions asked" value={num(s.recipient.asked)} />
          <Row label="Answered" value={num(s.recipient.answered)} />
          <Row label="No approved information" value={num(s.recipient.unknown)} />
          <Row label="Refused by permissions" value={num(s.recipient.refused)} />
        </Group>
      </div>
    </Panel>
  );
}
