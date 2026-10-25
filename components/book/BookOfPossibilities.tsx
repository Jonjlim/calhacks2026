"use client";

import { giftIsInBox } from "@/lib/room/giftBox";

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RoomActions, RoomData } from "@/components/room/types";
import { useRings } from "@/components/world/room/ringsStore";
import type { ProductListing, PublishedClue, Recommendation } from "@/lib/contracts";
import { formatMinor } from "@/lib/money";
import { getPriceFreshness } from "@/lib/research/freshness";
import { playChoose, playPencil, playTick, playWash } from "@/components/world/sfx";
import { book, BOOK_OPEN_MS, useBookOpen } from "./bookStore";
import { motifFor } from "./motifs";
import s from "./book.module.css";

/**
 * The Book of Possibilities: every researched gift in one place, so the group
 * can compare and decide without flying island to island. It opens from the
 * enchanted book beside the present: the pages draw themselves in pencil, then
 * watercolor blooms into them, then they become a real, readable catalogue.
 * The catalogue is plain HTML, so text, images and links stay crisp and
 * accessible; the drawing and washes are SVG and CSS around it.
 *
 * Everything on the pages is the room's real data: listings and their sources,
 * recommendations and the memories that back them, the group's saves and passes
 * (the existing "feels right" and "pass for now" votes) and, for the organizer,
 * the existing choose-the-gift action. Nothing here is a purchase.
 */

type Filter = { kind: "all" } | { kind: "saved" } | { kind: "passed" } | { kind: "theme"; id: string; label: string };

interface Item {
  listing: ProductListing;
  rec?: Recommendation;
  myVote?: "up" | "down";
  saved: number;
  themes: { id: string; label: string }[];
  selected: boolean;
}

const PER_PAGE = 6;

/** Pencil strokes that draw the pages, in the order they are drawn. */
const FRAME_X = [600, 755, 910];
const FRAME_Y = [138, 392];
const frame = (x: number, y: number) => `M${x} ${y + 8} Q${x} ${y} ${x + 8} ${y} L${x + 138} ${y + 2} Q${x + 146} ${y + 2} ${x + 146} ${y + 10} L${x + 144} ${y + 236} Q${x + 144} ${y + 244} ${x + 136} ${y + 244} L${x + 8} ${y + 242} Q${x} ${y + 242} ${x} ${y + 234} Z`;
const STROKES: { d: string; delay: number; dur: number; heavy?: boolean }[] = [
  { d: "M30 44 Q30 28 46 28 L560 36 L1074 28 Q1090 28 1090 44 L1090 686 Q1090 702 1074 702 L560 694 L46 702 Q30 702 30 686 Z", delay: 0, dur: 1.1, heavy: true },
  { d: "M560 36 L560 694", delay: 0.5, dur: 0.5 },
  { d: "M60 62 L532 66 L532 664 L60 668 Z", delay: 0.75, dur: 0.8 },
  { d: "M588 66 L1060 62 L1060 668 L588 664 Z", delay: 0.85, dur: 0.8 },
  { d: "M84 152 C200 160 330 144 506 154", delay: 1.25, dur: 0.6 },
  { d: "M70 80 C96 70 114 90 98 104 C86 114 70 104 80 94 M70 80 C64 100 76 120 96 124", delay: 1.4, dur: 0.6 },
  { d: "M1050 80 C1024 70 1006 90 1022 104 C1034 114 1050 104 1040 94 M1050 80 C1056 100 1044 120 1024 124", delay: 1.5, dur: 0.6 },
  { d: "M70 650 C96 660 114 640 98 626 C86 616 70 626 80 636 M70 650 C64 630 76 610 96 606", delay: 1.6, dur: 0.6 },
  { d: "M1050 650 C1024 660 1006 640 1022 626 C1034 616 1050 626 1040 636 M1050 650 C1056 630 1044 610 1024 606", delay: 1.7, dur: 0.6 },
  ...FRAME_Y.flatMap((y, r) => FRAME_X.map((x, c) => ({ d: frame(x, y), delay: 1.75 + (r * 3 + c) * 0.12, dur: 0.55 }))),
];

function useItems(data: RoomData): Item[] {
  const rings = useRings();
  return useMemo(() => {
    const labels = new Map((rings?.themes ?? []).map((t) => [t.theme, t.label]));
    const themesOf = new Map((rings?.gifts ?? []).map((g) => [g.listingId, g.themes.map((id) => ({ id, label: labels.get(id) ?? "" })).filter((t) => t.label)]));
    const recBy = new Map(data.recommendations.map((r) => [r.listingId, r]));
    const items = data.listings
      .filter((l) => l.status !== "invalid" || data.selection?.listingId === l.id)
      .map((listing): Item => ({
        listing,
        rec: recBy.get(listing.id),
        myVote: data.votes[listing.id]?.myVote === "up" ? "up" : data.votes[listing.id]?.myVote === "down" ? "down" : undefined,
        saved: data.votes[listing.id]?.tally.up ?? 0,
        themes: themesOf.get(listing.id) ?? [],
        selected: giftIsInBox(data.selection, listing.id),
      }));
    return items.sort((a, b) => (b.rec?.score ?? -1) - (a.rec?.score ?? -1));
  }, [data.listings, data.recommendations, data.votes, data.selection, rings]);
}

const priceOf = (l: ProductListing) => (l.priceStatus === "observed" && l.priceMinor !== undefined ? formatMinor(l.priceMinor, l.currency) : "Price unknown");
const isGoogle = (url: string) => {
  try {
    return /(^|\.)google\./.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

function Photo({ listing, className }: { listing: ProductListing; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [listing.imageUrl]);
  return listing.imageUrl && !failed ? (
    <img src={listing.imageUrl} alt={listing.title} className={className} loading="lazy" onError={() => setFailed(true)} />
  ) : (
    <span className={`${s.noPhoto} ${className ?? ""}`}>
      <svg aria-hidden width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="9" width="17" height="11" rx="1.5" /><path d="M3 9h18V6H3zM12 6v14" /></svg>
      <small>Photo unavailable</small>
    </span>
  );
}

export function BookOfPossibilities({ data, actions, isOrganizer, onChoose }: { data: RoomData; actions?: RoomActions; isOrganizer: boolean; onChoose(listingId: string): Promise<{ ok: true } | { ok: false; message: string }> }) {
  const open = useBookOpen();
  const [shown, setShown] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // The pages take over once the 3D book has lifted and opened.
  useEffect(() => {
    if (!open) {
      setLeaving(true);
      const t = setTimeout(() => {
        setShown(false);
        setLeaving(false);
      }, 260);
      return () => clearTimeout(t);
    }
    setLeaving(false);
    const t = setTimeout(() => setShown(true), BOOK_OPEN_MS - 150);
    return () => clearTimeout(t);
  }, [open]);
  if (!shown) return null;
  return <Pages data={data} actions={actions} isOrganizer={isOrganizer} onChoose={onChoose} leaving={leaving} />;
}

function Pages({ data, actions, isOrganizer, onChoose, leaving }: { data: RoomData; actions?: RoomActions; isOrganizer: boolean; onChoose(listingId: string): Promise<{ ok: true } | { ok: false; message: string }>; leaving: boolean }) {
  const items = useItems(data);
  const first = !book.seen;
  const [ready, setReady] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<string | null>(book.listingId);
  const [busy, setBusy] = useState<string | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const k = first ? 1 : 0.38;
  // Illustrations follow what was being explored: the theme in focus when the book was opened.
  const rings = useRings();
  const motif = useMemo(() => {
    const key = rings?.selectedKey ?? "";
    const themeId = key.startsWith("theme:") ? key.slice(6) : key.startsWith("clue:") ? rings?.clues.find((c) => c.key === key)?.theme : key.startsWith("gift:") ? rings?.gifts.find((g) => g.key === key)?.themes[0] : undefined;
    return motifFor(book.theme ?? rings?.themes.find((t) => t.theme === themeId)?.label);
    // Chosen once, when the pages open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drawing, then painting, then reading: about three and a half seconds the first time, a third of that after.
  useEffect(() => {
    const t = setTimeout(() => {
      setReady(true);
      book.markSeen();
    }, 3500 * k);
    // Graphite while it draws, a soft wash as the color blooms.
    playPencil(2.6 * k);
    const wash = setTimeout(playWash, 2100 * k);
    return () => {
      clearTimeout(t);
      clearTimeout(wash);
    };
  }, [k]);
  const instant = skipped || (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (instant) {
      setReady(true);
      book.markSeen();
    }
  }, [instant]);
  useEffect(() => {
    dialog.current?.focus({ preventScroll: true });
  }, []);

  const close = useCallback(() => book.hide(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (!ready) setSkipped(true);
      else if (detail) setDetail(null);
      else close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ready, detail, close]);

  const counts = { saved: items.filter((i) => i.myVote === "up").length, passed: items.filter((i) => i.myVote === "down").length };
  const themeChips = useMemo(() => {
    const seen = new Map<string, string>();
    for (const i of items) for (const t of i.themes) seen.set(t.id, t.label);
    return [...seen].map(([id, label]) => ({ id, label }));
  }, [items]);
  const visible = items.filter((i) => (filter.kind === "all" ? i.myVote !== "down" : filter.kind === "saved" ? i.myVote === "up" : filter.kind === "passed" ? i.myVote === "down" : i.themes.some((t) => t.id === filter.id) && i.myVote !== "down"));
  const pages = Math.max(1, Math.ceil(visible.length / PER_PAGE));
  const current = Math.min(page, pages - 1);
  const pageItems = visible.slice(current * PER_PAGE, current * PER_PAGE + PER_PAGE);
  const open = detail ? items.find((i) => i.listing.id === detail) : undefined;

  const vote = async (id: string, value: "up" | "down", mine?: "up" | "down") => {
    if (!actions) return;
    setError(null);
    setBusy(id);
    try {
      const res = mine === value ? await actions.clearVote(id) : await actions.castVote(id, value);
      if (!res.ok) setError(res.error.message);
      else playTick(mine !== value && value === "up");
    } catch {
      setError("That didn’t go through. Check the connection and try again.");
    } finally {
      setBusy(null);
    }
  };
  const choose = async (id: string) => {
    setError(null);
    setBusy(id);
    const res = await onChoose(id);
    setBusy(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    // The chosen gift's page lifts, then the book folds shut and the reveal takes over.
    playChoose();
    setLifted(id);
    setTimeout(() => book.hide(), 950);
  };

  const showDetail = (id: string) => {
    setDetail(id);
    setError(null);
  };

  const cls = `${s.stage} ${leaving ? s.out : ""} ${instant ? s.instant : ""}`;
  const speed = { ["--k" as string]: k } as CSSProperties;
  return (
    <div className={cls} style={speed}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-label="Book of Possibilities" tabIndex={-1} className={`${s.book} ${open ? s.detailMode : ""}`}>
        {/* The pages: pencil first, then watercolor. */}
        <svg className={s.ink} viewBox="0 0 1120 730" aria-hidden>
          <defs>
            <filter id="bookWash" x="-10%" y="-10%" width="120%" height="120%">
              <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7" result="n" />
              <feDisplacementMap in="SourceGraphic" in2="n" scale="9" />
            </filter>
          </defs>
          <g className={s.washes} filter="url(#bookWash)">
            <g transform="translate(70 424)">
              {motif.washes.map((w, i) => (
                <path key={i} d={w.d} fill={w.color} className={`${s.wash} ${s.frameDecor}`} style={{ ["--delay" as string]: `${2.1 + i * 0.35}s` }} />
              ))}
            </g>
            {FRAME_Y.flatMap((y, r) => FRAME_X.map((x, c) => (
              <rect key={`${r}${c}`} x={x + 6} y={y + 6} width={134} height={230} rx={9} fill={["#f6d9c6", "#e2e6c9", "#e7dcf2"][(r * 3 + c) % 3]} className={`${s.wash} ${s.frameDecor}`} style={{ ["--delay" as string]: `${2.3 + (r * 3 + c) * 0.12}s` }} />
            )))}
          </g>
          <g className={s.pencil}>
            {STROKES.map((st, i) => (
              <path key={i} d={st.d} pathLength={1} className={`${s.stroke} ${st.heavy ? s.heavy : ""} ${i >= 9 ? s.frameDecor : ""}`} style={{ ["--d" as string]: `${st.dur}s`, ["--delay" as string]: `${st.delay}s` }} />
            ))}
            <g transform="translate(70 424)">
              {motif.lines.map((d, i) => (
                <path key={i} d={d} pathLength={1} className={`${s.stroke} ${s.frameDecor}`} style={{ ["--d" as string]: "0.9s", ["--delay" as string]: `${1.7 + i * 0.22}s` }} />
              ))}
            </g>
          </g>
        </svg>
        <div className={s.paperWash} aria-hidden />

        {/* The catalogue is real HTML, so it stays crisp and readable. It comes up as the paint dries. */}
        <div className={`${s.content} ${ready ? s.ready : ""}`} aria-hidden={!ready}>
          <header className={s.left}>
            <p className={s.eyebrow}>Our shared gift hunt</p>
            <h2 className={s.title}>Book of Possibilities</h2>
            <p className={s.lede}>{items.length ? `${items.length} researched ${items.length === 1 ? "gift" : "gifts"}${counts.saved ? ` · ${counts.saved} saved` : ""}${counts.passed ? ` · ${counts.passed} passed on` : ""}` : "Nothing has been researched yet."}</p>
            <div className={s.filters} role="group" aria-label="Filter the gifts">
              {([["all", "All gifts"], ["saved", `Saved${counts.saved ? ` (${counts.saved})` : ""}`], ["passed", `Passed on${counts.passed ? ` (${counts.passed})` : ""}`]] as const).map(([kind, label]) => (
                <button key={kind} type="button" aria-pressed={filter.kind === kind} className={s.chip} onClick={() => { setFilter({ kind }); setPage(0); setDetail(null); }}>{label}</button>
              ))}
              {themeChips.map((t) => (
                <button key={t.id} type="button" aria-pressed={filter.kind === "theme" && filter.id === t.id} className={s.chip} onClick={() => { setFilter({ kind: "theme", id: t.id, label: t.label }); setPage(0); setDetail(null); }}>{t.label}</button>
              ))}
            </div>
            {open && (
              <div className={`${s.bigPhoto} ${lifted === open.listing.id ? s.lift : ""}`}>
                <Photo listing={open.listing} className={s.bigImg} />
                <p className={s.bigPrice}>{priceOf(open.listing)}<small> observed item price</small></p>
              </div>
            )}
          </header>

          <section className={s.right} aria-label={open ? "Gift details" : "Gifts"}>
            {error && <p role="alert" className={s.error}>{error}</p>}
            {!open ? (
              <>
                {visible.length === 0 ? (
                  <p className={s.empty}>{filter.kind === "saved" ? "Nothing saved yet. Save a gift you like and it will wait here." : filter.kind === "passed" ? "Nothing passed on. Gifts you pass on can be brought back from here." : items.length ? "No gifts here." : "When the council has researched gifts, they will appear on these pages."}</p>
                ) : (
                  <ul key={`${filter.kind}:${current}`} className={`${s.grid} ${s.turn}`}>
                    {pageItems.map((i) => (
                      <li key={i.listing.id}>
                        <button type="button" className={`${s.card} ${i.myVote === "down" ? s.passed : ""} ${i.selected ? s.chosen : ""} ${lifted === i.listing.id ? s.lift : ""}`} onClick={() => showDetail(i.listing.id)} aria-label={`${i.listing.title}, ${priceOf(i.listing)}${i.myVote === "up" ? ", saved" : i.myVote === "down" ? ", passed on" : ""}${i.selected ? ", chosen as our gift" : ""}`}>
                          <span className={s.thumb}><Photo listing={i.listing} className={s.img} /></span>
                          <b className={s.name}>{i.listing.title}</b>
                          <span className={s.price}>{priceOf(i.listing)}{i.listing.source === "manual_fixture" ? " · sample" : ""}</span>
                          {i.myVote === "up" && <i className={s.ribbon} aria-hidden>Saved</i>}
                          {i.selected && <i className={`${s.ribbon} ${s.gold}`} aria-hidden>Our gift</i>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {pages > 1 && (
                  <nav className={s.pager} aria-label="Pages of gifts">
                    <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Previous page">Back</button>
                    <span>{current + 1} of {pages}</span>
                    <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} aria-label="Next page">Next</button>
                  </nav>
                )}
              </>
            ) : (
              <Detail item={open} clues={data.publishedClues} isOrganizer={isOrganizer} busy={busy === open.listing.id} canAct={!!actions} onBack={() => setDetail(null)} onVote={(v) => vote(open.listing.id, v, open.myVote)} onChoose={() => choose(open.listing.id)} />
            )}
          </section>
        </div>

        <div className={s.corner}>
          {!ready && <button type="button" className={s.skip} onClick={() => setSkipped(true)}>Skip drawing</button>}
          <button type="button" className={s.close} onClick={close} aria-label="Close the book">Close</button>
        </div>
      </div>
    </div>
  );
}

function Detail({ item, clues, isOrganizer, busy, canAct, onBack, onVote, onChoose }: { item: Item; clues: PublishedClue[]; isOrganizer: boolean; busy: boolean; canAct: boolean; onBack(): void; onVote(v: "up" | "down"): void; onChoose(): void }) {
  const { listing, rec } = item;
  const why = (rec?.publishedClueIds ?? []).map((id) => clues.find((c) => c.id === id)).filter((c): c is PublishedClue => !!c && c.status === "active");
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  const freshness = now ? getPriceFreshness(listing, now) : null;
  return (
    <article className={`${s.detail} ${s.turn}`}>
      <button type="button" className={s.back} onClick={onBack}>All gifts</button>
      <h3 className={s.dTitle}>{listing.title}</h3>
      <p className={s.dPrice}>
        <strong>{priceOf(listing)}</strong>
        <span> · observed item price · {listing.currency}</span>
      </p>
      <p className={s.fine}>
        Shipping and tax: {listing.shippingStatus === "observed" && listing.shippingMinor !== undefined ? `${formatMinor(listing.shippingMinor, listing.currency)} shipping observed; tax unknown` : "unknown"}.
        {listing.sellerName ? ` Seller: ${listing.sellerName}.` : ""} Observed {new Date(listing.retrievedAt).toLocaleString()}
        {freshness?.needsRefresh ? ` · ${freshness.label}` : ""}.
        {listing.source === "manual_fixture" ? " Sample data, not a live listing." : ""}
      </p>
      {listing.status === "invalid" && <p role="alert" className={s.error}>This listing is marked unavailable. Check the source before relying on it.</p>}
      <div className={s.why}>
        <h4>Why this gift</h4>
        <p>{rec?.explanation ?? "The council gave no written reason for this one."}</p>
        {item.themes.length > 0 && <p className={s.themesLine}>In: {item.themes.map((t) => t.label).join(", ")}</p>}
        {why.length > 0 && (
          <ul>
            {why.slice(0, 4).map((c) => <li key={c.id}>“{c.text}”</li>)}
          </ul>
        )}
      </div>
      <div className={s.actions}>
        {canAct && (
          <>
            <button type="button" className={`${s.act} ${item.myVote === "up" ? s.on : ""}`} aria-pressed={item.myVote === "up"} disabled={busy} onClick={() => onVote("up")}>{item.myVote === "up" ? "Saved" : "Save for later"}</button>
            <button type="button" className={`${s.act} ${item.myVote === "down" ? s.on : ""}`} aria-pressed={item.myVote === "down"} disabled={busy} onClick={() => onVote("down")}>{item.myVote === "down" ? "Passed on. Bring it back" : "Not interested"}</button>
          </>
        )}
        {listing.sourceUrl ? (
          <a className={s.act} href={listing.sourceUrl} target="_blank" rel="noopener noreferrer">{isGoogle(listing.sourceUrl) ? "View source listing (Google Shopping)" : "View product"}</a>
        ) : (
          <span className={s.fine}>No source link was saved.</span>
        )}
        {isOrganizer && canAct && (
          <button type="button" className={`${s.act} ${s.primary}`} disabled={busy || item.selected} onClick={onChoose}>{item.selected ? "Already in our gift box" : busy ? "Choosing…" : "Add to our gift box"}</button>
        )}
      </div>
      <p className={s.fine}>Choosing a gift is not buying it. Nothing is charged; the group agrees shares next.</p>
    </article>
  );
}
