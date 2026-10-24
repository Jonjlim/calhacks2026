import { CLUE_KIND_LABELS } from "@/components/clues/labels";
import type { PublicWorld } from "@/convex/worlds";
import type { ClueKind } from "@/lib/contracts";
import { formatMinor } from "@/lib/money";

const BAND_LABELS: Record<PublicWorld["budgetBand"], string> = {
  under_25: "Under $25",
  "25_50": "$25–50",
  "50_100": "$50–100",
  "100_plus": "$100+",
  unknown: "Budget not shared",
};

function Tag({ children, tone }: { children: string; tone: "plum" | "coral" }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone === "coral" ? "bg-coral/15 text-coral" : "bg-plum/10 text-plum"}`}>
      {children}
    </span>
  );
}

export function WorldCard({ world }: { world: PublicWorld }) {
  const outcome = world.outcome;
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-plum/10 bg-white/70 p-5 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-plum">{world.occasion}</h3>
          <p className="text-sm text-plum-soft">For {world.recipientAlias}</p>
        </div>
        <div className="flex gap-1.5">
          {world.isSample && <Tag tone="coral">Sample</Tag>}
          {world.mine && <Tag tone="plum">Yours</Tag>}
        </div>
      </header>

      <p className="text-xs text-plum-soft">
        {BAND_LABELS[world.budgetBand]} · {world.friends} {world.friends === 1 ? "friend" : "friends"}
      </p>

      {world.inputs.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {world.inputs.map((input) => (
            <li key={input.kind} className="rounded-full border border-plum/15 px-2 py-0.5 text-[11px] text-plum">
              {CLUE_KIND_LABELS[input.kind as ClueKind] ?? input.kind} · {input.count}
            </li>
          ))}
        </ul>
      )}

      {world.highlights.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm italic text-plum-soft">
          {world.highlights.map((line) => (
            <li key={line}>“{line}”</li>
          ))}
        </ul>
      )}

      <div className="mt-auto border-t border-plum/10 pt-3 text-sm">
        {world.state === "chosen" && outcome ? (
          <>
            <p className="font-medium text-plum">{outcome.title}</p>
            <p className="flex items-center gap-2 text-xs text-plum-soft">
              {outcome.priceStatus === "observed" && outcome.priceMinor !== undefined
                ? formatMinor(outcome.priceMinor, "USD")
                : "Price unknown"}
              {outcome.source === "manual_fixture" && <Tag tone="coral">fixture</Tag>}
            </p>
          </>
        ) : (
          <p className="text-plum-soft">Still exploring</p>
        )}
      </div>
    </article>
  );
}
