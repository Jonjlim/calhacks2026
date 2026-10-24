"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { CLUE_KIND_LABELS } from "@/components/clues/labels";
import { api } from "@/convex/_generated/api";
import type { WorldAggregate } from "@/convex/worlds";
import type { ClueKind } from "@/lib/contracts";
import { formatMinor } from "@/lib/money";
import { Panel } from "@/components/ui/Panel";
import { WorldCard } from "./WorldCard";

const unknown = <span className="text-plum-soft italic">unknown</span>;

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] uppercase tracking-wide text-plum-soft">{label}</dt>
      <dd className="text-sm font-medium text-plum">{children}</dd>
    </div>
  );
}

function AggregateStrip({ aggregate }: { aggregate: WorldAggregate }) {
  return (
    <Panel title="Across all shared worlds">
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Worlds">{aggregate.worlds}</Stat>
        <Stat label="Gift chosen">{aggregate.chosen}</Stat>
        <Stat label="Median friends">{aggregate.medianFriends ?? unknown}</Stat>
        <Stat label="Median chosen price">
          {aggregate.medianChosenPriceMinor !== null ? formatMinor(aggregate.medianChosenPriceMinor, "USD") : unknown}
        </Stat>
        <Stat label="Top clue kinds">
          {aggregate.topInputKinds.length
            ? aggregate.topInputKinds.map((k) => `${CLUE_KIND_LABELS[k.kind as ClueKind] ?? k.kind} (${k.count})`).join(", ")
            : unknown}
        </Stat>
        <Stat label="Top occasions">
          {aggregate.topOccasions.length ? aggregate.topOccasions.map((o) => `${o.occasion} (${o.count})`).join(", ") : unknown}
        </Stat>
      </dl>
      {aggregate.samples > 0 && (
        <p className="mt-3 text-xs text-plum-soft">
          {aggregate.samples} of {aggregate.worlds} are labelled samples, not real sessions.
        </p>
      )}
    </Panel>
  );
}

export function WorldsGallery() {
  const convex = useConvex();
  if (!convex) return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
      <Link href="/" className="text-sm text-coral underline">Back to Unwrap</Link>
      <h1 className="text-3xl font-semibold text-plum">Other gift worlds</h1>
      <p role="status" className="text-plum-soft">Shared worlds need a connected backend. No live gift sessions are available in this offline preview.</p>
    </main>
  );
  return <LiveWorldsGallery />;
}

function LiveWorldsGallery() {
  const result = useQuery(api.worlds.listWorlds, {});
  const seed = useMutation(api.worlds.seedSampleWorlds);
  const seeded = useRef(false);
  const empty = result?.ok === true && result.value.worlds.length === 0;

  // A fresh deployment has no worlds; ask once for labelled samples. Refusal is expected outside the demo.
  useEffect(() => {
    if (!empty || seeded.current) return;
    seeded.current = true;
    seed({}).catch(() => undefined);
  }, [empty, seed]);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-2">
        <Link href="/" className="text-sm text-coral underline">
          Back to Unwrap
        </Link>
        <h1 className="text-3xl font-semibold text-plum">Other gift worlds</h1>
        <p className="text-sm text-plum-soft">Shared by organizers. Names and chats are never shown, and budgets appear only as a range.</p>
      </header>

      {result === undefined && <p className="text-plum-soft">Loading shared worlds…</p>}
      {result && !result.ok && (
        <p role="alert" className="text-sm text-coral">
          {result.error.message}
        </p>
      )}
      {result?.ok && (
        <>
          <AggregateStrip aggregate={result.value.aggregate} />
          {result.value.worlds.length === 0 ? (
            <p className="text-plum-soft">No worlds have been shared yet. Organizers can share a finished gift from their room.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {result.value.worlds.map((world) => (
                <WorldCard key={world.id} world={world} />
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
