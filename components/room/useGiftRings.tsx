"use client";

import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import type { RingAction, RingsWorld } from "@/components/world/room/GiftRings";
import s from "@/components/world/room/gift-rings.module.css";
import type { ClueKind, Result } from "@/lib/contracts";
import { GIFT_IDEA_PREFIX, isGiftIdea, layoutRings, RING_RADII, RING_THEMES, ringPoint, type RingDragResult, type RingTheme, type RingZone, themeForKind } from "@/lib/map/rings";
import { isTrendKey, layoutTrendIdeas, TREND_KEY_PREFIX } from "@/lib/map/trendIdeas";
import { formatMinor } from "@/lib/money";
import { avatarFor } from "@/lib/room/avatars";
import type { RoomActions, RoomData } from "./types";

/**
 * Builds the gift map for the 3D world from live room data (D19). Every
 * action goes through the existing room actions; dragging only casts or
 * clears listing votes, or asks the organizer's existing selection to run.
 */
/** Text this long, or this many lines, is a pasted conversation: read privately instead of shared as one memory. */
const PASTE_CHARS = 280;
const PASTE_LINES = 3;
const looksPasted = (text: string) => text.length > PASTE_CHARS || text.split(/\n/).filter((l) => l.trim()).length >= PASTE_LINES;

export function useGiftRings({ data, actions, isOrganizer, active, onShares, onPaste }: {
  data: RoomData;
  actions?: RoomActions;
  isOrganizer: boolean;
  active: boolean;
  onShares(): void;
  onPaste(): void;
}): { rings: RingsWorld | null; notice: string | null; error: string | null } {
  const { participants, me } = data.view;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // One add box. Its zone decides what it makes: a memory or wish outside, a gift idea in the inner ring.
  const [composer, setComposer] = useState<{ x: number; z: number; zone: "memory" | "gift"; kind: ClueKind } | null>(null);
  const [why, setWhy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Passing a trend only hides it for this viewer; shared passes wait for MAP-012 direction signals.
  const [passedTrends, setPassedTrends] = useState<Set<string>>(() => new Set());
  const lock = useRef(false);

  const run = useCallback(async (call: () => Promise<Result<unknown>>, success: string) => {
    if (lock.current) return false;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await call();
      if (!result.ok) {
        setError(result.error.message);
        return false;
      }
      setNotice(success);
      return true;
    } catch {
      setError("That didn’t go through. Check the connection and try again.");
      return false;
    } finally {
      lock.current = false;
      setPending(false);
    }
  }, []);

  const allClues = useMemo(() => data.publishedClues.filter((c) => c.status === "active"), [data.publishedClues]);
  // Friends' gift ideas float in the inner ring; everything else is a memory on the outer ring.
  const clues = useMemo(() => allClues.filter((c) => !isGiftIdea(c.text)), [allClues]);
  const ideas = useMemo(() => allClues.filter((c) => isGiftIdea(c.text)), [allClues]);
  const listingById = useMemo(() => new Map(data.listings.map((l) => [l.id, l])), [data.listings]);
  const recs = useMemo(() => [...data.recommendations].filter((r) => listingById.has(r.listingId)).sort((a, b) => b.score - a.score), [data.recommendations, listingById]);
  const layout = useMemo(
    () => layoutRings(
      clues.map((c) => ({ id: c.id, kind: c.kind })),
      recs.map((r) => ({ listingId: r.listingId, clueIds: r.publishedClueIds, score: r.score, up: data.votes[r.listingId]?.tally.up ?? 0, down: data.votes[r.listingId]?.tally.down ?? 0, resting: false })),
    ),
    [clues, recs, data.votes],
  );
  const trendSample = data.trends?.sample ?? null;
  const trendSource = trendSample ? clues.find((c) => c.id === trendSample.publishedClueId) ?? null : null;
  const trendIdeas = useMemo(() => {
    if (!trendSample || !trendSource) return [];
    const at = layout.clues.find((c) => c.id === trendSource.id) ?? null;
    return layoutTrendIdeas(trendSample.suggestions, at, passedTrends);
  }, [trendSample, trendSource, layout.clues, passedTrends]);
  const trendByListing = useMemo(() => new Map((data.trends?.listingLinks ?? []).map((l) => [l.listingId, l])), [data.trends?.listingLinks]);

  if (!active) return { rings: null, notice, error };

  const name = (id: string) => (id === me.id ? "You" : participants.find((p) => p.id === id)?.displayName ?? "A friend");
  const selection = data.selection?.status === "active" ? data.selection : null;
  const revision = data.proposal.revision;
  const approved = revision ? data.proposal.approvals.filter((a) => a.revisionId === revision.id && a.status === "approved").length : 0;
  const priceOf = (listingId: string) => {
    const l = listingById.get(listingId);
    return l?.priceStatus === "observed" && l.priceMinor !== undefined ? formatMinor(l.priceMinor) : "Price unknown";
  };
  const allClueIds = allClues.map((c) => c.id);
  const findGifts: RingAction | null = isOrganizer && actions
    ? { icon: "🌱", label: recs.length ? "Find more gifts" : "Find gifts", tone: "gold", disabled: pending || !allClueIds.length, run: () => void run(() => actions.startResearch(allClueIds), "The council is looking for real gifts from these memories.") }
    : null;

  // “Why this?”: the chosen gift, its themes, and the clues its recommendation cites.
  let highlight: Set<string> | null = null;
  if (why && selection) {
    const rec = recs.find((r) => r.listingId === selection.listingId);
    const cited = (rec?.publishedClueIds ?? []).filter((id) => clues.some((c) => c.id === id));
    const trend = trendByListing.get(selection.listingId);
    highlight = new Set(["box", `gift:${selection.listingId}`, ...cited.map((id) => `clue:${id}`), ...cited.map((id) => `theme:${themeForKind(clues.find((c) => c.id === id)!.kind)}`), ...(trend ? [TREND_KEY_PREFIX + trend.query] : [])]);
  }

  const vote = (listingId: string, value: "up" | "down") => {
    if (!actions) return;
    const mine = data.votes[listingId]?.myVote;
    void (mine === value
      ? run(() => actions.clearVote(listingId), "Vote taken back.")
      : run(() => actions.castVote(listingId, value), value === "up" ? "You pulled it closer: it feels right." : "You pushed it away for now. Nothing was deleted."));
  };
  const choose = (listingId: string) => {
    if (!actions) return;
    void (isOrganizer
      ? run(() => actions.selectGift(listingId), "It’s in the box. Everyone approves this exact version.").then((ok) => ok && setSelectedKey("box"))
      : run(() => actions.castVote(listingId, "up"), "Your vote is in. The organizer puts the final gift in the box."));
  };

  const actionsFor = (key: string): { caption: ReactNode; actions: RingAction[] } | null => {
    if (key === "box") {
      if (!selection) return { caption: isOrganizer ? "Drag a gift onto the present to choose it." : "The organizer puts one gift here. Vote by pulling gifts closer.", actions: [] };
      return {
        caption: <><b>{selection.listingSnapshot.title}</b> · {priceOf(selection.listingId)} · {approved}/{participants.length} approved</>,
        actions: [
          { icon: "🧾", label: "Shares & approvals", tone: "gold", run: onShares },
          { icon: "✨", label: why ? "Hide the path" : "Why this?", on: why, run: () => setWhy((w) => !w) },
          ...(isOrganizer && actions ? [{ icon: "↩", label: "Take it out", disabled: pending, run: () => void run(() => actions.clearSelection(), "The box is empty again. Approvals for the old version no longer count.") }] : []),
        ],
      };
    }
    if (key.startsWith("theme:")) {
      const theme = key.slice(6) as RingTheme;
      const count = layout.themes.find((t) => t.id === theme)?.count ?? 0;
      return { caption: <><b>{RING_THEMES[theme].label}</b> · {count} shared {count === 1 ? "memory" : "memories"}</>, actions: findGifts ? [findGifts] : [] };
    }
    if (key.startsWith("gift:")) {
      const listingId = key.slice(5);
      const listing = listingById.get(listingId);
      const rec = recs.find((r) => r.listingId === listingId);
      if (!listing) return null;
      const mine = data.votes[listingId]?.myVote;
      return {
        caption: <><b>{listing.title}</b> · {priceOf(listingId)}{listing.source === "manual_fixture" ? " · sample" : ""}<br />{rec?.explanation}{trendByListing.has(listingId) && <><br />Found while researching “{trendByListing.get(listingId)!.query}”, a related Google Trends search. The product itself isn’t claimed to be trending.</>}</>,
        actions: actions ? [
          { icon: "♥", label: "Feels right", tone: "yes", on: mine === "up", disabled: pending, run: () => vote(listingId, "up") },
          { icon: "✕", label: "Pass for now", tone: "pass", on: mine === "down", disabled: pending, run: () => vote(listingId, "down") },
          { icon: "🎁", label: isOrganizer ? (selection?.listingId === listingId ? "In the box" : "Put in the box") : "Vote for the box", tone: "gold", on: selection?.listingId === listingId, disabled: pending, run: () => choose(listingId) },
          { icon: "🏠", label: "She has it", disabled: pending, run: () => void run(() => actions.reactToGift(listingId, "owned"), "Shared with the room: she already owns this. Ideas are being rechecked.") },
          { icon: "💸", label: "Too pricey for me", disabled: pending, run: () => void run(() => actions.reactToGift(listingId, "price"), "Saved for you. Budgets and private limits did not change.") },
          { icon: "↗", label: "Open the listing", run: () => window.open(listing.sourceUrl, "_blank", "noopener,noreferrer") },
          ...(trendByListing.has(listingId) ? [{ icon: "📈", label: "See the trend", run: () => window.open(trendByListing.get(listingId)!.sourceUrl, "_blank", "noopener,noreferrer") }] : []),
        ] : [],
      };
    }
    if (isTrendKey(key)) {
      const node = trendIdeas.find((t) => t.key === key);
      if (!node || !trendSample || !trendSource) return null;
      const jobId = trendSample.jobId;
      return {
        caption: <><b>{node.query}</b> · {node.signal}<br />A Google Trends search related to “{trendSource.text}”. An idea to explore, not a fact about her.</>,
        actions: [
          ...(actions?.researchTrend ? [{ icon: "🌱", label: "Research this direction", tone: "gold" as const, disabled: pending, run: () => void run(() => actions.researchTrend!(jobId, node.query, allClueIds), `Looking for real gifts for “${node.query}”.`) }] : []),
          { icon: "↗", label: "See the source", run: () => window.open(node.sourceUrl, "_blank", "noopener,noreferrer") },
          { icon: "✕", label: "Doesn’t fit", tone: "pass" as const, run: () => { setPassedTrends((p) => new Set(p).add(node.query)); setSelectedKey(null); setNotice("Hidden for you. Her memories didn’t change."); } },
        ],
      };
    }
    const idea = ideas.find((c) => `idea:${c.id}` === key);
    if (idea) {
      return {
        caption: <><b>{idea.text.slice(GIFT_IDEA_PREFIX.length)}</b><br />{name(idea.publisherId) === "You" ? "Your" : `${name(idea.publisherId)}’s`} gift idea · research turns it into real listings</>,
        actions: [
          ...(findGifts ? [{ ...findGifts, label: "Find this gift" }] : []),
          ...(actions && idea.publisherId === me.id ? [{ icon: "↩", label: "Take it back", disabled: pending, run: () => void run(() => actions.withdrawClue(idea.id), "Your gift idea was withdrawn.").then((ok) => ok && setSelectedKey(null)) }] : []),
        ],
      };
    }
    const clue = clues.find((c) => `clue:${c.id}` === key);
    if (!clue) return null;
    const theme = RING_THEMES[themeForKind(clue.kind)].label;
    return {
      caption: <>{name(clue.publisherId) === "You" ? "Your" : `${name(clue.publisherId)}’s`} memory · in {theme}</>,
      actions: [
        ...(findGifts ? [findGifts] : []),
        ...(actions?.findTrends && (clue.kind === "interest" || clue.kind === "explicit_wish") ? [{ icon: "📈", label: "Look for trends", disabled: pending, run: () => void run(() => actions.findTrends!(clue.id), "Checking Google Trends for related searches. Ideas will sprout here.") }] : []),
        ...(actions && clue.publisherId === me.id ? [{ icon: "↩", label: "Take it back", disabled: pending, run: () => void run(() => actions.withdrawClue(clue.id), "Your memory was withdrawn from the room.").then((ok) => ok && setSelectedKey(null)) }] : []),
      ],
    };
  };

  // The text box is uncontrolled: its value reaches the 3D labels a frame late, so React must not overwrite it.
  const add = (raw: string) => {
    const text = raw.trim();
    if (!composer || !text || !actions) return;
    const done = (ok: boolean) => { if (ok) setComposer(null); };
    if (composer.zone === "gift") {
      void run(async () => {
        const shared = await actions.addManualClue("interest", GIFT_IDEA_PREFIX + text);
        const id = shared.ok ? (shared.value as { _id?: string; id?: string })._id ?? (shared.value as { id?: string }).id : undefined;
        // The idea is saved either way; a busy council just means research starts on the next "Find gifts".
        if (id && isOrganizer) void actions.startResearch([...allClueIds, id]).catch(() => undefined);
        return shared;
      }, isOrganizer ? "Gift idea shared. The council is looking for real listings." : "Gift idea shared with the room.").then(done);
      return;
    }
    if (looksPasted(text)) {
      void run(() => actions.importEvidence("Pasted on the map", text), "Reading your paste privately. Review the clues it finds before anything is shared.").then((ok) => { done(ok); if (ok) onPaste(); });
      return;
    }
    void run(() => actions.addManualClue(composer.kind, text), `Shared with the room, in ${RING_THEMES[themeForKind(composer.kind)].label}.`).then(done);
  };
  const composerNode = composer && actions && (
    <div className={s.write} data-map-token>
      {composer.zone === "memory" && (
        <div className={s.kinds} role="radiogroup" aria-label="What is it?">
          {([["interest", "💭 Memory"], ["explicit_wish", "🎁 Wish"]] as const).map(([kind, label]) => (
            <button key={kind} type="button" role="radio" aria-checked={composer.kind === kind} onClick={() => setComposer({ ...composer, kind })}>{label}</button>
          ))}
          <button type="button" onClick={() => { setComposer(null); onPaste(); }} aria-label="Add a photo or screenshot privately">📷 Photo</button>
        </div>
      )}
      <textarea autoFocus defaultValue="" maxLength={8000} aria-label={composer.zone === "gift" ? "A gift idea" : composer.kind === "explicit_wish" ? "A wish" : "A memory"}
        className={composer.zone === "gift" ? s.ideaInput : undefined}
        placeholder={composer.zone === "gift" ? "A gift idea… a wheel-throwing class" : composer.kind === "explicit_wish" ? "Something she wished for…" : "Something you remember… or paste a whole chat"}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add(e.currentTarget.value); }
          if (e.key === "Escape") setComposer(null);
        }} />
      <p>{composer.zone === "gift" ? "Enter shares the idea · research finds real listings" : "Enter shares it · long pastes are read privately first · Esc cancels"}</p>
    </div>
  );

  const rings: RingsWorld = {
    clues: layout.clues.map((c) => {
      const clue = clues.find((x) => x.id === c.id)!;
      return { key: `clue:${c.id}`, text: clue.text, author: name(clue.publisherId), avatar: avatarFor(participants, clue.publisherId), theme: c.theme, x: c.x, z: c.z };
    }),
    ideas: ideas.map((idea, i) => {
      // Friends' ideas sit just inside the gift ring, spaced around it, until research turns them into listings.
      const [x, z] = ringPoint(235 + i * 47, RING_RADII.gift - 0.4);
      return { key: `idea:${idea.id}`, text: idea.text.slice(GIFT_IDEA_PREFIX.length), author: name(idea.publisherId), avatar: avatarFor(participants, idea.publisherId), x, z };
    }).concat(trendSource ? trendIdeas.map((t) => ({ key: t.key, text: t.query, author: name(trendSource.publisherId), avatar: avatarFor(participants, trendSource.publisherId), x: t.x, z: t.z, tag: `trend · ${t.signal}` })) : []),
    themes: layout.themes.map((t) => ({ key: `theme:${t.id}`, theme: t.id, label: RING_THEMES[t.id].label, count: t.count, x: t.x, z: t.z })),
    gifts: layout.gifts.map((g, i) => {
      const l = listingById.get(g.listingId)!;
      return { key: `gift:${g.listingId}`, listingId: g.listingId, title: l.title, price: priceOf(g.listingId), imageUrl: l.imageUrl, themes: g.themes, x: g.x, z: g.z, rank: i + 1, up: data.votes[g.listingId]?.tally.up ?? 0, down: data.votes[g.listingId]?.tally.down ?? 0, fixture: l.source === "manual_fixture" };
    }),
    selectedListingId: selection?.listingId,
    boxLabel: selection ? `${priceOf(selection.listingId)} · ${approved}/${participants.length} yes` : "Our gift box",
    selectedKey,
    highlight,
    composer: composer && composerNode ? { x: composer.x, z: composer.z, node: composerNode } : null,
    onSelect: (key) => {
      setComposer(null);
      setSelectedKey(key);
      if (key !== "box") setWhy(false);
    },
    onEmpty: (point, zone?: RingZone) => {
      setSelectedKey(null);
      setWhy(false);
      setComposer(point && actions ? { x: point[0], z: point[1], zone: zone === "gift" ? "gift" : "memory", kind: "interest" } : null);
    },
    onDrag: (key: string, result: RingDragResult) => {
      if (!result) return;
      if (!key.startsWith("gift:")) {
        setNotice("Votes on memories and themes are coming next. You can pull gifts in or push them away today.");
        return;
      }
      const listingId = key.slice(5);
      if (result === "box") choose(listingId);
      else vote(listingId, result === "support" ? "up" : "down");
    },
    actionsFor,
  };
  return { rings, notice, error };
}
