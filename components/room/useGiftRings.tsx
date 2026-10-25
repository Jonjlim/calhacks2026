"use client";

import { relevantResearchJob, roomResearchJobs, isResearchActive } from "@/lib/room/researchActivity";
import { addToGiftBox } from "@/lib/room/giftBox";

import { QuestionPoll } from "./QuestionPoll";

import { type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { reencodeImage } from "@/lib/live/image";
import type { AvatarId } from "@/components/characters/StorybookAvatar";
import type { RingAction, RingDetail, RingResearch, RingsWorld } from "@/components/world/room/GiftRings";
import s from "@/components/world/room/gift-rings.module.css";
import { MapIcon } from "@/components/world/room/MapIcon";
import type { PledgeWorld } from "@/components/world/room/PledgeRing";
import type { ClueKind, Result } from "@/lib/contracts";
import { GIFT_IDEA_PREFIX, isGiftIdea, layoutRings, OTHER_THEME, RING_RADII, RING_THEMES, ringPoint, type RingDragResult, type RingTheme, type RingZone, themeForKind } from "@/lib/map/rings";
import { giftTwinMap } from "@/lib/map/giftTwin";
import { directionPoint, fadeOf, trendClouds, weaveThreads } from "@/lib/map/directions";
import { emptyTrendNote, isTrendKey, TREND_KEY_PREFIX, trendKey } from "@/lib/map/trendIdeas";
import { formatMinor } from "@/lib/money";
import { avatarFor } from "@/lib/room/avatars";
import { book } from "@/components/book/bookStore";
import { mapView } from "@/components/world/room/mapView";
import { playChoose, playCouncilTick } from "@/components/world/sfx";
import { BoxPanel } from "./BoxPanel";
import { HowWeGotHere } from "./HowWeGotHere";
import { TikTokBoard } from "./TikTokBoard";
import { PASS_REASONS, type PassReason, type RoomActions, type RoomData } from "./types";
import { playSfx } from "@/components/world/sounds";

/** One colour per storybook friend, shared by cursors, pledge arcs, vote chips and faces. */
export const AVATAR_COLOR: Record<AvatarId, string> = { explorer: "#d0675a", kind: "#d98fb8", curious: "#e2ad6b", calm: "#79b391", dreamer: "#8d86d0" };

const BUCKET_TINT: Record<RingTheme, string> = { interest: "#a9cde6", wish: "#f2d27a", moment: "#f3b9c4" };
const COUNCIL_TINTS = ["#a9cde6", "#f2d27a", "#f3b9c4", "#b9d99a", "#cdb9f0"];
const OTHER_TINT = "#d8d2c6";

/** Text this long, or this many lines, is a pasted conversation: read privately instead of shared as one memory. */
const PASTE_CHARS = 280;
const PASTE_LINES = 3;
const looksPasted = (text: string) => text.length > PASTE_CHARS || text.split(/\n/).filter((l) => l.trim()).length >= PASTE_LINES;

/** How long another member's vote keeps its bubble, and how long a still cursor stays on the map. */
const PULSE_MS = 3200;
const CURSOR_MS = 8000;
/** How long woven threads stay before they settle, and the longest the council may reach before giving up. */
const WEAVE_MS = 5200;
const REACH_MAX_MS = 30_000;
/** How long the council's reaction to passes stays in the status line. */
const REACTION_MS = 15_000;
/** A failed search stays on its theme this long, so it isn't mistaken for a quiet success. */
const RESEARCH_FAIL_MS = 10 * 60 * 1000;

/**
 * Builds the gift map for the 3D world from live room data (D19). Every
 * action goes through the existing room actions. Votes on memories and
 * themes are advisory signals; listing votes, selection and approvals keep
 * their own rules.
 */
export function useGiftRings({ data, actions, isOrganizer, active, onPaste, onReveal, revealSeen = false }: {
  data: RoomData;
  actions?: RoomActions;
  isOrganizer: boolean;
  active: boolean;
  onShares?(): void;
  onPaste(): void;
  /** The Great Gift Convergence: the cinematic reveal (`instant: false`), or the finished reveal without it. */
  onReveal?(instant: boolean): void;
  revealSeen?: boolean;
}): { councilThinking: string | null; rings: RingsWorld | null; notice: string | null; error: string | null; openBox(): void; startAdd(what: "memory" | "wish" | "idea"): void; tools: ReactNode; story: ReactNode | null } {
  const { participants, me } = data.view;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // One add box. Its zone decides what it makes: a memory or wish outside, a gift idea in the inner ring.
  const [composer, setComposer] = useState<{ x: number; z: number; zone: "memory" | "gift"; kind: ClueKind; photo?: boolean } | null>(null);
  const composerDraft = useRef("");
  // Photos picked in the add box before they're sent.
  const [sharedPhotoSource, setSharedPhotoSource] = useState<string | null>(null);
  const [photoPick, setPhotoPick] = useState<{ blob: Blob; preview: string; marker?: { x: number; y: number } }[]>([]);
  // “Why?” on one gift: its memories, themes and the gift light up together.
  const [whyListing, setWhyListing] = useState<string | null>(null);
  // The theme whose memories are fanned out to read; the rest rest as face dots.
  const [openTheme, setOpenTheme] = useState<string | null>(null);
  // Where this viewer started a search, so its progress shows on that theme.
  const [researchFrom, setResearchFrom] = useState<string | null>(null);
  const [hiddenPoll, setHiddenPoll] = useState<string | null>(null);
  // When this viewer asked for trends, so the outcome of that lookup (not an older one) reaches the status line.
  const [trendAsked, setTrendAsked] = useState<number | null>(null);
  /** Index of the photo open in the large tap-the-person view, if any. */
  const [marking, setMarking] = useState<number | null>(null);
  /** The node whose pass is waiting for an optional reason. */
  const [passing, setPassing] = useState<string | null>(null);
  /** "How we got here": the whole room's story, or one gift's (its listing id). */
  const [story, setStory] = useState<{ listingId?: string } | null>(null);
  /** The trend cloud whose TikTok inspiration board is open (D23 trial). */
  const [tiktok, setTiktok] = useState<{ trendJobId: string; query: string } | null>(null);
  const closeTiktok = useCallback(() => setTiktok(null), []);
  const closeStory = useCallback(() => setStory(null), []);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  /**
   * The council's weave (D23 trial): "reaching" while it thinks, then "weaving" the directions it
   * decided, for everyone in the room. `fresh` names the directions that just arrived; `since` dates
   * the request, so only this round's refused ideas fray.
   */
  const [weave, setWeave] = useState<{ id: number; phase: "reaching" | "weaving"; since: number; fresh: string[] } | null>(null);
  const seenDirections = useRef<Set<string> | null>(null);
  const lock = useRef(false);
  const lastCursor = useRef({ at: 0, x: 0, z: 0 });

  // Vote bubbles and idle cursors expire on their own.
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  const run = useCallback(async (call: () => Promise<Result<unknown>>, success: string, key = "action") => {
    if (lock.current) return false;
    lock.current = true;
    setPending(key);
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
      setPending(null);
    }
  }, []);

  const allClues = useMemo(() => data.publishedClues.filter((c) => c.status === "active"), [data.publishedClues]);
  // Friends' gift ideas float in the inner ring; everything else is a memory on the outer ring.
  const clues = useMemo(() => allClues.filter((c) => !isGiftIdea(c.text)), [allClues]);
  const ideas = useMemo(() => allClues.filter((c) => isGiftIdea(c.text)), [allClues]);
  const twin = useMemo(() => giftTwinMap(data.agentCollaborators, new Set(ideas.map((idea) => idea.id))), [data.agentCollaborators, ideas]);
  const listingById = useMemo(() => new Map(data.listings.map((l) => [l.id, l])), [data.listings]);
  // The server's order is final: gifts the room pulled in first, then by score (D23 trial).
  const recs = useMemo(() => data.recommendations.filter((r) => listingById.has(r.listingId)), [data.recommendations, listingById]);

  // Direction signals: net pull per memory or theme, the viewer's own vote, and who voted.
  const signalRows = data.mapSignals;
  const signals = useMemo(() => {
    const clue: Record<string, number> = {};
    const theme: Record<string, number> = {};
    const tally: Record<string, { up: number; down: number }> = {};
    const mine: Record<string, number> = {};
    for (const row of signalRows ?? []) {
      const key = `${row.targetKind}:${row.targetId}`;
      // Only memories and themes steer the ring layout; directions and trend clouds fade on their own.
      if (row.targetKind === "clue") clue[row.targetId] = row.up - row.down;
      else if (row.targetKind === "theme") theme[row.targetId] = row.up - row.down;
      tally[key] = { up: row.up, down: row.down };
      const own = row.voters.find((v) => v.participantId === me.id);
      if (own) mine[key] = own.value;
    }
    for (const [id, vote] of Object.entries(data.votes)) tally[`gift:${id}`] = { up: vote.tally.up, down: vote.tally.down };
    return { clue, theme, tally, mine };
  }, [signalRows, me.id, data.votes]);

  const sharpen = data.sharpen ?? null;
  const finalists = useMemo(() => new Set<string>(sharpen?.status === "open" ? sharpen.finalistIds : []), [sharpen]);
  const favored = useMemo(() => new Set<string>(sharpen?.status === "answered" && sharpen.answer !== undefined ? sharpen.options[sharpen.answer]?.listingIds ?? [] : []), [sharpen]);
  const councilThemes = useMemo(() => (data.mapThemes ?? []).map((t) => ({ id: t.id, label: t.label, clueIds: t.clueIds })), [data.mapThemes]);

  const layout = useMemo(
    () => layoutRings(
      clues.map((c) => ({ id: c.id, kind: c.kind })),
      recs.map((r) => ({
        listingId: r.listingId, clueIds: r.publishedClueIds, score: r.score,
        up: data.votes[r.listingId]?.tally.up ?? 0, down: data.votes[r.listingId]?.tally.down ?? 0, resting: false,
        faded: finalists.size > 0 && !finalists.has(r.listingId), favored: favored.has(r.listingId),
      })),
      { themes: councilThemes, signals: { clue: signals.clue, theme: signals.theme } },
    ),
    [clues, recs, data.votes, councilThemes, signals, finalists, favored],
  );
  // Council directions that combine memories (D23 trial), and the trend clouds people can catch into them.
  const directions = useMemo(() => data.directions ?? [], [data.directions]);
  // New directions weave in on every screen, not only for the friend who asked. The first load just remembers what's there.
  useEffect(() => {
    if (!data.directions) return;
    const ids = new Set(data.directions.map((d) => d.id));
    const before = seenDirections.current;
    seenDirections.current = ids;
    if (!before) return;
    const fresh = [...ids].filter((id) => !before.has(id));
    if (!fresh.length) return;
    playChoose();
    // The branches already seeking carry on into the weave: same session, so they attach instead of restarting.
    setWeave((w) => ({ id: w?.id ?? Date.now(), phase: "weaving", since: w?.since ?? Date.now() - 30_000, fresh }));
  }, [data.directions]);
  // A weave settles after a few seconds; a request that never produced directions stops reaching.
  useEffect(() => {
    if (!weave) return;
    const t = setTimeout(() => setWeave(null), weave.phase === "weaving" ? WEAVE_MS : REACH_MAX_MS);
    return () => clearTimeout(t);
  }, [weave]);
  const trendNet = useMemo(() => {
    const net: Record<string, number> = {};
    for (const row of signalRows ?? []) if (row.targetKind === "trend") net[`${TREND_KEY_PREFIX}${row.targetId}`] = row.up - row.down;
    return net;
  }, [signalRows]);
  const usedTrends = useMemo(() => new Set(directions.flatMap((d) => (d.trend ? [trendKey(d.trend.trendJobId, d.trend.query)] : []))), [directions]);
  // A few searches drift through the outer sky; caught ones rest by their memory. Never one sprout per memory.
  const trendIdeas = useMemo(() => {
    const samples = data.trends?.samples ?? (data.trends?.sample ? [data.trends.sample] : []);
    const at = (clueId: string) => layout.clues.find((c) => c.id === clueId) ?? null;
    return trendClouds(samples, trendNet, at, now, usedTrends).flatMap((cloud) => {
      const source = clues.find((c) => c.id === cloud.publishedClueId);
      return source ? [{ ...cloud, source }] : [];
    });
  }, [data.trends?.samples, data.trends?.sample, clues, layout.clues, trendNet, usedTrends, now]);
  const trendByListing = useMemo(() => new Map((data.trends?.listingLinks ?? []).map((l) => [l.listingId, l])), [data.trends?.listingLinks]);

  const focusedGift = selectedKey?.startsWith("gift:") ? layout.gifts.find(g => `gift:${g.listingId}` === selectedKey) : undefined;
  useEffect(() => {
    if (focusedGift) mapView.trackGift(focusedGift.x, focusedGift.z);
    else if (mapView.target.giftFocus === 1) mapView.returnFromGift();
  }, [selectedKey, focusedGift?.x, focusedGift?.z]);

  const openBox = () => setSelectedKey("box");
  // The bar's add buttons: each opens the write box in its own part of the map, and what is written goes into that section.
  const startAdd = (what: "memory" | "wish" | "idea") => {
    if (!actions) return;
    setSelectedKey(null);
    composerDraft.current = "";
    const [x, z] = what === "idea" ? ringPoint(300, RING_RADII.gift - 0.4) : ringPoint(RING_THEMES[what === "wish" ? "wish" : "interest"].angle, RING_RADII.input);
    setComposer({ x, z, zone: what === "idea" ? "gift" : "memory", kind: what === "wish" ? "explicit_wish" : "interest" });
    mapView.focus(x * 0.6, z * 0.6, 0.8);
  };
  if (!active) return { councilThinking: null, rings: null, notice, error, openBox, startAdd, tools: null, story: null };

  const name = (id: string) => (id === me.id ? "You" : participants.find((p) => p.id === id)?.displayName ?? "A friend");
  const avatarOf = (id: string) => avatarFor(participants, id);
  const colorOf = (id: string) => AVATAR_COLOR[avatarOf(id)];
  const selection = data.selection?.status === "active" ? data.selection : null;
  const selectedIds = new Set(selection?.items?.map(item => item.listingId) ?? (selection ? [selection.listingId] : []));
  const revision = data.proposal.revision;
  const approved = revision ? data.proposal.approvals.filter((a) => a.revisionId === revision.id && a.status === "approved").length : 0;
  const priceOf = (listingId: string) => {
    const l = listingById.get(listingId);
    return l?.priceStatus === "observed" && l.priceMinor !== undefined ? formatMinor(l.priceMinor) : "Price unknown";
  };
  const allClueIds = allClues.map((c) => c.id);
  const startSearch = (from: string) => {
    if (!actions) return;
    void run(() => actions.startResearch(allClueIds), "The council is looking for real gifts from these memories.").then((ok) => ok && setResearchFrom(from));
  };
  // With directions (D23 trial), gifts are found per direction; the council's room-wide search is set aside.
  const findGiftsFrom = (from: string, label?: string): RingAction[] => isOrganizer && actions && !actions.proposeDirections
    ? [{ icon: "sprout", label: label ?? (recs.length ? "Find more gifts" : "Find gifts"), more: !label, disabled: !!pending || !allClueIds.length, run: () => startSearch(from) }]
    : [];

  // Theme colours and jars: the three clue groups keep their jar colours; council themes get their own.
  const themeTint = new Map<string, string>();
  const themeJar = new Map<string, RingTheme>();
  layout.themes.forEach((t, i) => {
    themeTint.set(t.id, t.bucket ? BUCKET_TINT[t.bucket] : t.id === OTHER_THEME ? OTHER_TINT : COUNCIL_TINTS[i % COUNCIL_TINTS.length]!);
    const kinds = layout.clues.filter((c) => c.theme === t.id).map((c) => themeForKind(clues.find((x) => x.id === c.id)!.kind));
    const top = (["interest", "wish", "moment"] as const).map((b) => [b, kinds.filter((k) => k === b).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
    themeJar.set(t.id, t.bucket ?? top);
  });
  const themeLabel = (id: string) => layout.themes.find((t) => t.id === id)?.label ?? "";
  const themeOfClue = new Map(layout.clues.map((c) => [c.id, c.theme]));

  // Directions float between the themes and the gifts, at the memories they combine. Passing fades one; half the room passing lets it go.
  const members = Math.max(1, participants.length);
  const directionNodes = directions.flatMap((d, i) => {
    const fade = fadeOf(signals.tally[`direction:${d.id}`], members);
    if (fade === "gone") return [];
    const at = d.clueIds.flatMap((id) => layout.clues.filter((c) => c.id === id));
    const [x, z] = directionPoint(at, i);
    const memories = d.clueIds.flatMap((id) => clues.filter((c) => c.id === id));
    return [{ ...d, x, z, faded: fade === "faded", memories, key: `direction:${d.id}` }];
  });
  const directionOf = (directionId?: string) => (directionId ? directions.find((d) => d.id === directionId) : undefined);

  // “Why?”: a gift, its themes, and the memories its recommendation cites. Everything else dims.
  let highlight: Set<string> | null = null;
  const whyRec = whyListing ? recs.find((r) => r.listingId === whyListing) : undefined;
  if (whyRec) {
    const cited = whyRec.publishedClueIds.filter((id) => themeOfClue.has(id));
    // A gift found through a trend search lights that trend idea too; one found by a direction lights the direction and its memories.
    const trend = trendByListing.get(whyRec.listingId);
    const viaDirection = directionOf(whyRec.foundBy?.directionId);
    const memories = [...new Set([...cited, ...(viaDirection?.clueIds.filter((id) => themeOfClue.has(id)) ?? [])])];
    highlight = new Set([`gift:${whyRec.listingId}`, ...memories.map((id) => `clue:${id}`), ...memories.map((id) => `theme:${themeOfClue.get(id)}`),
      ...(trend ? [trendKey(trend.trendJobId, trend.query)] : []), ...(viaDirection ? [`direction:${viaDirection.id}`] : [])]);
    if (selectedIds.has(whyRec.listingId)) highlight.add("box");
  } else if (selectedKey?.startsWith("direction:")) {
    // Opening a direction lights the memories it combines and the gifts it found.
    const d = directionOf(selectedKey.slice(10));
    if (d) highlight = new Set([selectedKey, ...d.clueIds.map((id) => `clue:${id}`),
      ...recs.filter((r) => r.foundBy?.directionId === d.id).map((r) => `gift:${r.listingId}`)]);
  }
  // Progressive disclosure: choosing a memory, a theme or a gift lights up only what connects to it, and everything else recedes.
  if (!highlight && selectedKey && (selectedKey.startsWith("clue:") || selectedKey.startsWith("theme:") || selectedKey.startsWith("gift:"))) {
    const set = new Set<string>(["box", selectedKey]);
    const addTheme = (id: string) => {
      set.add(`theme:${id}`);
      for (const c of layout.clues) if (c.theme === id) set.add(`clue:${c.id}`);
      for (const g of layout.gifts) if (g.themes.includes(id)) set.add(`gift:${g.listingId}`);
    };
    if (selectedKey.startsWith("clue:")) {
      const theme = themeOfClue.get(selectedKey.slice(5));
      if (theme) {
        set.add(`theme:${theme}`);
        for (const g of layout.gifts) if (g.themes.includes(theme)) set.add(`gift:${g.listingId}`);
      }
    } else if (selectedKey.startsWith("theme:")) {
      addTheme(selectedKey.slice(6));
    } else {
      const listingId = selectedKey.slice(5);
      for (const g of layout.gifts) if (g.listingId === listingId) for (const id of g.themes) set.add(`theme:${id}`);
      for (const id of recs.find((r) => r.listingId === listingId)?.publishedClueIds ?? []) if (themeOfClue.has(id)) set.add(`clue:${id}`);
    }
    highlight = set;
  }

  // Research progress shows where it was started; a search someone else started shows at the present.
  const researchJobs = roomResearchJobs(data);
  const job = relevantResearchJob(researchJobs);
  const research: RingResearch = !job ? null
    : isResearchActive(job) ? "running"
    : job.status === "uncertain" ? "uncertain"
    : (job.status === "failed" || job.status === "stale") && now > 0 && now - job.createdAt < RESEARCH_FAIL_MS ? "failed"
    : null;
  const researchTheme = research && researchFrom && researchFrom !== "box" && layout.themes.some((t) => t.id === researchFrom) ? researchFrom : null;

  const vote = (listingId: string, value: "up" | "down", reason?: PassReason) => {
    if (!actions) return;
    const mine = data.votes[listingId]?.myVote;
    const said = reason ? ` (${PASS_REASONS.find((r) => r.id === reason)!.label.toLowerCase()})` : "";
    void (mine === value && !reason
      ? run(() => actions.clearVote(listingId), "Vote taken back.")
      : run(() => actions.castVote(listingId, value, reason), value === "up" ? "You pulled it closer: it feels right, and it moves up the shortlist."
        : `You passed${said}. If the room lets this direction’s gifts go, the council will suggest something different.`));
  };
  const signal = (targetKind: "clue" | "theme" | "direction", targetId: string, value: 1 | -1, reason?: PassReason) => {
    if (!actions) return;
    const mine = signals.mine[`${targetKind}:${targetId}`];
    const next = mine === value && !reason ? 0 : value;
    void run(() => actions.setDirection(targetKind, targetId, next, reason), next === 0 ? "Vote taken back."
      : next > 0 ? (targetKind === "direction" ? "You pulled this direction in. It shows one more gift." : "You pulled it closer. Gifts in that direction move in too.")
      : targetKind === "direction" ? "You passed on this direction. Once the room lets it go, the council suggests a different one." : "You pushed it away for now. Nothing was deleted.");
  };
  // A pass asks why first (one tap, optional), so the council knows what to avoid next.
  const passFirst = (key: string, mineAlready: boolean, takeBack: () => void): (() => void) => () => {
    if (mineAlready) takeBack();
    else setPassing(key);
  };
  const voteActs = (targetKind: "clue" | "theme" | "direction", targetId: string): RingAction[] => {
    const mine = signals.mine[`${targetKind}:${targetId}`];
    return actions ? [
      { icon: "heart", label: "Feels like her", tone: "yes", on: mine === 1, disabled: !!pending, run: () => signal(targetKind, targetId, 1) },
      { icon: "drift", label: "Not really", tone: "pass", on: mine === -1, disabled: !!pending,
        run: targetKind === "direction" ? passFirst(`direction:${targetId}`, mine === -1, () => signal(targetKind, targetId, -1)) : () => signal(targetKind, targetId, -1) },
    ] : [];
  };
  /** The one-tap reasons shown in place of a node's actions while its pass is being given. */
  const reasonActs = (key: string): RingAction[] => {
    const give = (reason?: PassReason) => {
      setPassing(null);
      if (key.startsWith("gift:")) {
        if (!reason && data.votes[key.slice(5)]?.myVote === "down") return;
        vote(key.slice(5), "down", reason);
      }
      else if (key.startsWith("direction:")) signal("direction", key.slice(10), -1, reason);
    };
    return [
      ...PASS_REASONS.map((r) => ({ icon: "drift" as const, label: r.label, tone: "pass" as const, disabled: !!pending, run: () => give(r.id) })),
      { icon: "check" as const, label: "Just pass", disabled: !!pending, run: () => give() },
      { icon: "undo" as const, label: "Cancel", more: true, run: () => setPassing(null) },
    ];
  };
  const choose = (listingId: string) => {
    if (!actions) return;
    if (isOrganizer && selection && !actions.addGiftToBox) {
      setError("The multi-gift backend update is not available yet. Your existing gift was kept.");
      return;
    }
    void (isOrganizer
      ? run(() => addToGiftBox(actions, selection, listingId), actions.addGiftToBox ? "Added to the box. Your other gifts stay; everyone approves the updated collection." : "Gift selected. Everyone approves this version.").then((ok) => ok && setSelectedKey("box"))
      : run(() => actions.castVote(listingId, "up"), "Your vote is in. The organizer puts the final gift in the box."));
  };

  // “Why this gift?” as the path it actually took: memories → direction → question → search → listing → fit.
  // Every step is stored room data or an observed listing fact; nothing here is generated for display.
  const whyChain = (rec: (typeof recs)[number], listing: NonNullable<ReturnType<typeof listingById.get>>): ReactNode => {
    const origin = rec.foundBy;
    const d = directionOf(origin?.directionId);
    const memoryIds = d ? d.clueIds : origin?.publishedClueId ? [origin.publishedClueId] : [];
    const memoryTexts = memoryIds.flatMap((id) => allClues.filter((c) => c.id === id).map((c) => `“${c.text}”`));
    const pool = data.searchPools?.find((p) => p.jobId === rec.id.slice(0, rec.id.indexOf(":")));
    const asked = d && sharpen?.status === "answered" && sharpen.directionId === d.id && sharpen.answer !== undefined ? sharpen : null;
    const trendSearch = trendByListing.get(rec.listingId);
    const steps: { icon: "memory" | "spark" | "scales" | "sprout" | "open" | "thread" | "trend"; text: ReactNode }[] = [];
    if (memoryTexts.length) steps.push({ icon: "memory", text: <>Memories: {memoryTexts.join(" + ")}</> });
    if (d) steps.push({ icon: "spark", text: <>The council combined them into <b>{d.label}</b>{d.source === "preset" ? " (simple rule, no model)" : ""}. {d.why}{d.trend && <> It builds on the caught trend “{d.trend.query}”.</>}</> });
    if (asked) steps.push({ icon: "scales", text: <>Asked “{asked.question}”. {asked.answeredBy ? name(asked.answeredBy) : "A friend"} answered: {asked.options[asked.answer!]?.label}.</> });
    if (trendSearch && !d) steps.push({ icon: "trend", text: <>From a related Google Trends search, “{trendSearch.query}”. The product itself isn’t claimed to be trending.</> });
    if (origin) steps.push({ icon: "sprout", text: <>Searched “{origin.query}”{pool ? <>: {pool.found} found{pool.removedByClues ? `, ${pool.removedByClues} removed by what friends said she owns or doesn’t want` : ""}{pool.foldedDuplicates ? `, ${pool.foldedDuplicates} repeats folded` : ""}, {pool.shown} shown</> : null}.</> });
    steps.push({ icon: "open", text: <>{listing.sellerName ?? "A seller"} · {priceOf(rec.listingId)} · price seen {new Date(listing.retrievedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</> });
    steps.push({ icon: "thread", text: rec.publishedClueIds.length
      ? <>Its listing names {rec.publishedClueIds.length === 1 ? "a memory" : `${rec.publishedClueIds.length} memories`} directly.</>
      : <>No memory names this product directly; it’s here because of the search above.</> });
    return (
      <ol className={s.chain} aria-label="How the council got to this gift">
        {steps.map((step, i) => <li key={i}><MapIcon name={step.icon} size={13} /><span>{step.text}</span></li>)}
      </ol>
    );
  };

  const actionsFor = (key: string): RingDetail | null => {
    const base = nodeDetail(key);
    if (!base || passing !== key) return base;
    return { caption: <>{base.caption}<small>Why pass? One tap tells the council what to steer away from.</small></>, actions: reasonActs(key) };
  };
  const nodeDetail = (key: string): RingDetail | null => {
    // Once a gift is chosen the box opens its own panel; before that, the present is where the council's tools live.
    if (key === "box") {
      if (selection || !actions) return null;
      return {
        caption: <><b>Nothing in the box yet</b><small>Drag a gift onto the present, or ask the council</small></>,
        actions: councilActs.map((a) => ({ ...a, more: false })),
      };
    }
    if (key.startsWith("theme:")) {
      const id = key.slice(6);
      const t = layout.themes.find((x) => x.id === id);
      if (!t) return null;
      const council = !t.bucket && id !== OTHER_THEME;
      return {
        caption: <><small>{t.count} shared {t.count === 1 ? "memory" : "memories"}{council ? " · grouped by the council" : ""}</small></>,
        actions: [...(id === OTHER_THEME ? [] : voteActs("theme", id)), ...findGiftsFrom(id, "Find gifts here")],
      };
    }
    if (key.startsWith("gift:")) {
      const listingId = key.slice(5);
      const listing = listingById.get(listingId);
      const rec = recs.find((r) => r.listingId === listingId);
      if (!listing) return null;
      const mine = data.votes[listingId]?.myVote;
      const inBox = selectedIds.has(listingId);
      const viaDirection = directionOf(rec?.foundBy?.directionId);
      return {
        caption: <><b>{listing.title}</b><small>{priceOf(listingId)}{listing.source === "manual_fixture" ? " · sample" : ""}{viaDirection ? ` · ${viaDirection.label}` : trendByListing.has(listingId) ? " · via a trend" : ""}{rec?.publishedClueIds.length ? ` · fits ${rec.publishedClueIds.length} ${rec.publishedClueIds.length === 1 ? "memory" : "memories"}` : ""}</small></>,
        note: whyListing === listingId && rec ? whyChain(rec, listing) : undefined,
        actions: actions ? [
          { icon: "present", label: isOrganizer ? (inBox ? "In the box ✓" : !actions.addGiftToBox && selection ? "Backend update needed" : "Add to box") : "Vote for the box", tone: "gold", on: inBox, disabled: !!pending || (isOrganizer && !actions.addGiftToBox && !!selection && !inBox), run: () => inBox ? setSelectedKey("box") : choose(listingId) },
          { icon: "heart", label: "Feels right", tone: "yes", on: mine === "up", disabled: !!pending, run: () => vote(listingId, "up") },
          { icon: "drift", label: "Pass", tone: "pass", on: mine === "down", disabled: !!pending, run: () => vote(listingId, "down") },
          { icon: "thread", label: "Why?", on: whyListing === listingId, run: () => setWhyListing((w) => (w === listingId ? null : listingId)) },

          { icon: "drift", label: "Add a reason for passing", more: true, disabled: !!pending, run: () => setPassing(key) },
          { icon: "home", label: "She already has it", more: true, disabled: !!pending, run: () => void run(() => actions.reactToGift(listingId, "owned"), "Shared with the room: she already owns this. Ideas are being rechecked.") },
          { icon: "coins", label: "Too pricey for me", more: true, disabled: !!pending, run: () => void run(() => actions.reactToGift(listingId, "price"), "Saved for you. Budgets and private limits did not change.") },
          ...(data.trail ? [{ icon: "thread" as const, label: "How we got here", more: true, run: () => setStory({ listingId }) }] : []),
          { icon: "open", label: "Open the listing", more: true, run: () => window.open(listing.sourceUrl, "_blank", "noopener,noreferrer") },
          ...(trendByListing.has(listingId) ? [{ icon: "trend" as const, label: "See the trend", more: true, run: () => window.open(trendByListing.get(listingId)!.sourceUrl, "_blank", "noopener,noreferrer") }] : []),
        ] : [],
      };
    }
    if (isTrendKey(key)) {
      // A trend cloud never searches by itself: catch it for the next directions, or let it drift away.
      const node = trendIdeas.find((t) => t.key === key);
      if (!node) return null;
      const target = key.slice(TREND_KEY_PREFIX.length);
      const mineCaught = signals.mine[`trend:${target}`] === 1;
      return {
        caption: <><b>{node.query}</b><small>{node.signal} · a Google search related to “{node.source.text}”. An idea to explore, not a fact about her.</small>
          <small>{node.caught ? "Caught. The council can weave it into the next directions." : "Drifting by. Catch it if it fits her; it won’t search on its own."}</small></>,
        actions: actions ? [
          { icon: "heart" as const, label: node.caught ? (mineCaught ? "Let go" : "Caught") : "Catch it", tone: "yes" as const, on: node.caught, disabled: !!pending || (node.caught && !mineCaught),
            run: () => void run(() => actions.setDirection("trend", target, mineCaught ? 0 : 1), mineCaught ? "Let go. It drifts back into the sky." : "Caught. Ask the council for directions to weave it in.") },
          { icon: "drift" as const, label: "Let it drift", tone: "pass" as const, disabled: !!pending,
            run: () => void run(() => actions.setDirection("trend", target, -1), "It drifted away for the room. Her memories didn’t change.").then((ok) => ok && setSelectedKey(null)) },
          // Public TikToks for this idea, as inspiration: one capped search, shared with the room for a day.
          ...(actions?.lookTikTok ? [{ icon: "spark" as const, label: "See TikToks", disabled: !!pending,
            run: () => { setTiktok({ trendJobId: node.trendJobId, query: node.query }); void run(() => actions.lookTikTok!(node.trendJobId, node.query), `Looking for public TikToks for “${node.query}”.`); } }] : []),
          { icon: "open" as const, label: "See the source", more: true, run: () => window.open(node.sourceUrl, "_blank", "noopener,noreferrer") },
        ] : [],
      };
    }
    if (key.startsWith("direction:")) {
      const d = directionNodes.find((n) => n.key === key);
      if (!d) return null;
      const found = recs.filter((r) => r.foundBy?.directionId === d.id).length;
      const directionJob = relevantResearchJob(researchJobs.filter((j) => j.directionId === d.id));
      const searching = isResearchActive(directionJob);
      const uncertain = directionJob?.status === "uncertain";
      const asking = sharpen?.status === "open" && sharpen.directionId === d.id;
      return {
        caption: <><b>{d.label}</b><small>{d.why}</small>
          <small>Joins {d.memories.map((m) => `“${m.text}”`).join(" + ")}{d.trend ? ` · with the caught trend “${d.trend.query}”` : ""}</small>
          {asking && <small>The council asked the room one question to sharpen this.</small>}
          {uncertain && <small>The search is awaiting confirmation. Its results are not known yet.</small>}
          {directionJob?.status === "failed" && <small>The search failed. You can try again.</small>}
          {d.stale && <small>Memories changed since. Ask the council again to refresh it.</small>}</>,
        actions: [
          ...(isOrganizer && actions?.researchDirection ? [{ icon: "sprout" as const, label: searching ? "Searching…" : found ? "Search again" : "Find gifts for this", tone: "gold" as const, disabled: !!pending || searching,
            run: () => void run(() => actions.researchDirection!(d.id, allClueIds), `Searching “${d.query}”. A few gifts from it will land on the map.`).then((ok) => ok && setResearchFrom(key)) }] : []),
          ...voteActs("direction", d.id),
        ],
      };
    }
    if (key.startsWith("photo:")) {
      const group = groups.find((g) => g.key === key);
      if (!group) return null;
      const mine = group.uploaderId === me.id;
      const found = mine ? foundFor(group.sourceId) : [];
      const source = mine ? data.evidence.find((e) => e.id === group.sourceId) : undefined;
      const photoStatus = source?.media?.status;
      return {
        caption: mine ? (
          <span className={s.found}>
            <b>Your photo · everyone sees it</b>
            {found.length === 0 ? <span>{group.clueIds.length ? `${group.clueIds.length} shared from it. Nothing left to review.` : photoStatus === "failed" ? "Your photo is shared, but Unwrap couldn’t read it. No guesses were published." : photoStatus === "uploaded" ? "Reading it… what Unwrap guesses appears here, only for you." : "Your photo is shared. No suggestions to review; you can add a memory in your own words."}</span> : (
              <>
                <span>Only you see these guesses until you share them:</span>
                {found.map((c) => (
                  <span key={c.id} className={s.foundRow}>
                    <em>{c.text}{c.confidence < 0.6 ? " · maybe" : ""}</em>
                    {actions && <button type="button" onClick={() => void run(() => actions.publishClue(c.id), "Shared with the room.")}>Share</button>}
                    {actions && <button type="button" className={s.foundNo} aria-label="Discard" onClick={() => void run(() => actions.rejectClue(c.id), "Discarded. Nobody else saw it.")}><MapIcon name="drift" size={13} /></button>}
                  </span>
                ))}
              </>
            )}
          </span>
        ) : <><b>{name(group.uploaderId)}’s photo{group.urls.length > 1 ? "s" : ""}</b>{group.clueIds.length ? <small>{group.clueIds.length} {group.clueIds.length === 1 ? "memory" : "memories"} from it</small> : null}</>,
        actions: actions && mine ? [{
          icon: "trash" as const, label: "Delete for everyone", more: true, disabled: !!pending,
          run: () => void run(async () => {
            for (const id of group.photoIds) {
              const gone = await actions.deletePhoto(id);
              if (!gone.ok) return gone;
            }
            return group.sourceId ? actions.deleteEvidence(group.sourceId) : { ok: true as const, value: null };
          }, "Deleted for everyone, along with anything not yet shared.").then((ok) => ok && setSelectedKey(null)),
        }] : [],
      };
    }
    const idea = ideas.find((c) => `idea:${c.id}` === key);
    if (idea) {
      return {
        caption: <><b>{idea.text.slice(GIFT_IDEA_PREFIX.length)}</b><small>{twin.clueAuthors.get(idea.id) ? `${twin.clueAuthors.get(idea.id)} · AI suggestion` : `${name(idea.publisherId) === "You" ? "Your" : `${name(idea.publisherId)}’s`} gift idea`} · research turns it into real listings</small></>,
        actions: [
          ...findGiftsFrom("box", "Find this gift"),
          ...(actions && idea.publisherId === me.id ? [{ icon: "undo" as const, label: "Take it back", more: true, disabled: !!pending, run: () => void run(() => actions.withdrawClue(idea.id), "Your gift idea was withdrawn.").then((ok) => ok && setSelectedKey(null)) }] : []),
        ],
      };
    }
    const clue = clues.find((c) => `clue:${c.id}` === key);
    if (!clue) return null;
    const twinAuthor = twin.clueAuthors.get(clue.id);
    const theme = themeOfClue.get(clue.id) ?? "";
    const trendSample = (data.trends?.samples ?? []).find((sample) => sample.publishedClueId === clue.id);
    const trendNote = trendSample ? emptyTrendNote(trendSample) : null;
    return {
      caption: <><b>“{clue.text}”</b><small>{twinAuthor ? `${twinAuthor} · AI insight` : `${name(clue.publisherId) === "You" ? "Your" : `${name(clue.publisherId)}’s`} memory`} · {theme ? <>in {themeLabel(theme)}</> : "the council will group it soon"}</small>{trendNote && <small>{trendNote}</small>}</>,
      // Trend discovery runs when directions are requested, not once per memory.
      actions: [
        ...voteActs("clue", clue.id),
        ...findGiftsFrom(theme),
        ...(actions && clue.publisherId === me.id ? [{ icon: "undo" as const, label: "Take it back", more: true, disabled: !!pending, run: () => void run(() => actions.withdrawClue(clue.id), "Your memory was withdrawn from the room.").then((ok) => ok && setSelectedKey(null)) }] : []),
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
        if (!shared.ok) return shared;
        // Saving an idea and starting its search are separate outcomes.
        setComposer(null);
        const id = (shared.value as { _id?: string; id?: string })._id ?? (shared.value as { id?: string }).id;
        if (id && isOrganizer) {
          try {
            const search = await actions.startResearch([...allClueIds, id]);
            if (!search.ok) return { ok: false as const, error: { ...search.error, message: `Your idea was saved, but research did not start: ${search.error.message}` } };
          } catch {
            return { ok: false as const, error: { code: "unknown" as const, message: "Your idea was saved, but the search request could not be confirmed. Check its status before trying again." } };
          }
        }
        return shared;
      }, isOrganizer ? "Gift idea shared. Research requested; watch Scout for progress." : "Gift idea shared with the room.");
      return;
    }
    if (looksPasted(text)) {
      void run(() => actions.importEvidence("Pasted on the map", text), "Reading your paste privately. Review the clues it finds before anything is shared.").then((ok) => { done(ok); if (ok) onPaste(); });
      return;
    }
    void run(() => actions.addManualClue(composer.kind, text), "Shared with the room. The council will fold it into a theme in a moment.").then(done);
    if (composer.kind === "explicit_wish") playSfx("wish");
  };
  const composerNode = composer && actions && (
    <div className={s.write} data-map-token>
      <span className={`${s.cloud} ${s.writeCloud} ${composer.zone === "gift" ? s.ideaCloud : ""}`}>
      <textarea autoFocus defaultValue={composerDraft.current} onChange={(e) => { composerDraft.current = e.currentTarget.value; }} maxLength={8000} aria-label={composer.zone === "gift" ? "A gift idea" : composer.kind === "explicit_wish" ? "A wish" : "A memory"}
        className={composer.zone === "gift" ? s.ideaInput : s.memoryInput}
        placeholder={composer.zone === "gift" ? "A gift idea… a wheel-throwing class" : composer.kind === "explicit_wish" ? "Something she wished for…" : "Something you remember… or paste a whole chat"}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add(e.currentTarget.value); }
          if (e.key === "Escape") setComposer(null);
        }} />
      {composer.zone === "memory" && <button type="button" className={s.mediaButton} onClick={() => setComposer({ ...composer, photo: true })} aria-label="Add photos" title="Add photos"><MapIcon name="camera" size={19} /></button>}
      <i className={s.trail} aria-hidden />
      </span>
      {composer.zone === "memory" && <label className={s.wishOption} title="An explicit wish gets priority in gift searches.">
        <input type="checkbox" checked={composer.kind === "explicit_wish"} onChange={(e) => setComposer({ ...composer, kind: e.currentTarget.checked ? "explicit_wish" : "interest" })} />
        They asked for this <span>Wish</span>
      </label>}
      <p>{composer.zone === "gift" ? "Enter shares the idea · research finds real listings" : "Enter shares it · long pastes are read privately first · Esc cancels"}</p>
    </div>
  );

  // Photos: picked and marked in the add box, then read privately with the same pipeline as the photo panel.
  const pickPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    const next: typeof photoPick = [];
    for (const file of Array.from(files).slice(0, 3)) {
      try {
        const blob = await reencodeImage(file);
        next.push({ blob, preview: URL.createObjectURL(blob) });
      } catch {
        setError("That photo couldn’t be prepared. Try a JPEG or PNG.");
      }
    }
    setPhotoPick(next);
    setMarking(next.length ? 0 : null);
  };
  // Measured on the uncropped image, so the mark lands on the same spot the model sees.
  const markPhoto = (index: number, e: ReactMouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const marker = { x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)) };
    setPhotoPick((items) => items.map((it, i) => (i === index ? { ...it, marker } : it)));
  };
  const readPhotos = () => {
    if (!actions || !photoPick.length) return;
    const picked = photoPick;
    void run(async () => {
      const result = await actions.importPhotos(picked.map(({ blob, marker }) => ({ blob, marker })));
      if (result.ok && result.value && typeof result.value === "object" && "sourceId" in result.value && typeof result.value.sourceId === "string") {
        setSharedPhotoSource(result.value.sourceId);
      }
      return result;
    }, "Photo shared. Review its private suggestions before sharing them as memories.", "photos").then((ok) => {
      if (ok) {
        setComposer(null);
        setPhotoPick([]);
      }
    });
  };
  const nextPhoto = (index: number) => setMarking(index + 1 < photoPick.length ? index + 1 : null);
  const markViewer = (index: number) => {
    const it = photoPick[index]!;
    const last = index + 1 >= photoPick.length;
    return (
      <div className={s.markBackdrop} role="dialog" aria-modal="true" aria-label={`Photo ${index + 1} of ${photoPick.length}`}
        onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") setMarking(null); }}>
        <div className={s.markCard}>
          <header>
            {photoPick.length > 1 && <small>Photo {index + 1} of {photoPick.length}</small>}
            <h2>Tap the person this gift is for</h2>
          </header>
          <div className={s.markPolaroid}>
            <button type="button" className={s.markFrame} onClick={(e) => markPhoto(index, e)} aria-label="Tap the person this gift is for">
              <img src={it.preview} alt="" />
              {it.marker && <i style={{ left: `${it.marker.x * 100}%`, top: `${it.marker.y * 100}%` }} aria-hidden />}
            </button>
            <span>{it.marker ? <>marked <MapIcon name="check" size={16} /></> : "tap the person"}</span>
          </div>
          <p>Your mark only tells Unwrap who to look at. It isn’t face recognition, and only you see it.</p>
          <div className={s.markBtns}>
            {it.marker && <button type="button" onClick={() => setPhotoPick((items) => items.map((p, i) => (i === index ? { blob: p.blob, preview: p.preview } : p)))}>Clear mark</button>}
            <button type="button" onClick={() => { setPhotoPick((items) => items.map((p, i) => (i === index ? { blob: p.blob, preview: p.preview } : p))); nextPhoto(index); }}>Skip · scene only</button>
            <button type="button" className={s.readBtn} disabled={!it.marker} onClick={() => nextPhoto(index)}>{last ? "Done" : "Next photo"}</button>
          </div>
        </div>
      </div>
    );
  };
  const photoComposer = composer?.photo && actions ? (
    <div className={s.write} data-map-token>
      <button type="button" className={s.backToWriting} onClick={() => setComposer({ ...composer, photo: false })}>← Back to writing</button>
      {photoPick.length === 0 ? (
        <label className={s.photoPick}>
          <MapIcon name="camera" size={22} />Choose up to 3 photos
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { void pickPhotos(e.target.files); e.target.value = ""; }} />
        </label>
      ) : (
        <div className={s.photoRow}>
          {photoPick.map((it, i) => (
            <button key={it.preview} type="button" className={s.polaroidPick} onClick={() => setMarking(i)} aria-label={`Photo ${i + 1}: open it to tap the person it’s for`}>
              <img src={it.preview} alt="" />
              <span className={s.pickState}>{it.marker ? <><MapIcon name="check" size={11} /> marked</> : "tap to mark"}</span>
            </button>
          ))}
        </div>
      )}
      <p>{photoPick.length ? "Open each photo and tap her. It’s your mark, not face recognition, and only you see it." : "Everyone in the room will see these photos. Location data is removed."}</p>
      {photoPick.length > 0 && (
        <button type="button" className={s.readBtn} disabled={pending === "photos"} onClick={readPhotos}>{pending === "photos" ? "Sharing…" : `Share ${photoPick.length === 1 ? "it" : "them"} with the room`}</button>
      )}
      {marking !== null && photoPick[marking] && createPortal(markViewer(marking), document.body)}
    </div>
  ) : null;

  // Room photos (D20): everyone sees them. Their uploader also sees what the private read guessed, to review.
  const photoGroups = new Map<string, { key: string; uploaderId: string; sourceId?: string; photoIds: string[]; urls: string[]; clueIds: string[] }>();
  for (const photo of data.roomPhotos ?? []) {
    const groupKey = photo.sourceId ?? photo.id;
    const group = photoGroups.get(groupKey) ?? { key: `photo:${groupKey}`, uploaderId: photo.uploaderId, sourceId: photo.sourceId, photoIds: [], urls: [], clueIds: [] };
    group.photoIds.push(photo.id);
    group.urls.push(photo.url);
    for (const id of photo.clueIds) if (!group.clueIds.includes(id)) group.clueIds.push(id);
    photoGroups.set(groupKey, group);
  }
  const groups = [...photoGroups.values()];
  const foundFor = (sourceId?: string) => (sourceId ? data.myProposedClues.filter((c) => c.sourceId === sourceId && c.status === "proposed") : []);
  const photoNodes = groups.map((g, i) => {
    const [x, z] = ringPoint(205 - i * 24, RING_RADII.input + 1.2);
    const mine = g.uploaderId === me.id;
    const source = mine && g.sourceId ? data.evidence.find((e) => e.id === g.sourceId) : undefined;
    const found = mine ? foundFor(g.sourceId).length : 0;
    return { key: g.key, images: g.urls, author: name(g.uploaderId), mine, found, reading: mine && source?.media?.status === "uploaded" && !found, x, z };
  });
  // Wait for the authoritative subscription before opening the newly shared photo.
  // Photos sit on the outer ring and can otherwise land outside the current view.
  useEffect(() => {
    if (!sharedPhotoSource || !active) return;
    const group = groups.find((g) => g.sourceId === sharedPhotoSource && g.uploaderId === me.id);
    const node = group && photoNodes.find((p) => p.key === group.key);
    if (!node) return;
    setSelectedKey(node.key);
    setOpenTheme(null);
    mapView.focus(node.x, node.z, 0.65);
    setSharedPhotoSource(null);
  }, [sharedPhotoSource, active, groups, photoNodes, me.id]);

  const thumbFor = (clueId: string) => groups.find((g) => g.clueIds.includes(clueId))?.urls[0];

  // The shared yes at the present.
  const live = revision && revision.status !== "infeasible" && revision.status !== "superseded" && revision.payableTotalMinor > 0;
  const pledge: PledgeWorld | null = live ? {
    revisionId: revision.id,
    allApproved: revision.status === "approved_pledged",
    feasible: data.proposal.feasible,
    segments: revision.shares.map((share) => ({
      participantId: share.participantId,
      name: name(share.participantId),
      avatar: avatarOf(share.participantId),
      color: colorOf(share.participantId),
      amountLabel: formatMinor(share.amountMinor),
      fraction: share.amountMinor / revision.payableTotalMinor,
      status: data.proposal.approvals.find((a) => a.revisionId === revision.id && a.participantId === share.participantId)?.status ?? "pending",
    })),
  } : null;
  const boxPanel = (
    <BoxPanel proposal={data.proposal} selection={selection} listing={selection ? listingById.get(selection.listingId) : undefined} participants={participants} me={me}
      isOrganizer={isOrganizer} actions={actions} avatarOf={avatarOf} colorOf={colorOf} why={!!selection && whyListing === selection.listingId}
      // "Why this gift?" lights the path on the map and opens the whole story behind it.
      onWhy={() => { if (selection) { setWhyListing(selection.listingId); setStory({ listingId: selection.listingId }); } }} onClose={() => setSelectedKey(null)}
      onReveal={onReveal ? () => { setSelectedKey(null); onReveal(!isOrganizer); } : undefined} revealLabel={isOrganizer ? (revealSeen ? "Replay reveal" : "Reveal our gift") : "See our gift"} />
  );

  // The sharpen round: one question between the two leading gifts.
  let overlay: ReactNode = null;
  const poll = data.questionPoll?.questionId === sharpen?._id ? data.questionPoll : null;
  if (sharpen && poll && actions?.voteQuestion) {
    if (hiddenPoll !== sharpen._id) overlay = <QuestionPoll question={sharpen} poll={poll} pending={!!pending}
      onVote={option => void run(() => actions.voteQuestion!(sharpen._id, option), option === null ? "Your question vote was withdrawn." : "Your vote is in. The gift shortlist updates for the room.")}
      onFinish={isOrganizer && actions.finishQuestion ? () => void run(() => actions.finishQuestion!(sharpen._id), "The room’s choice is saved. No recipient fact was published.") : undefined}
      onSkip={!poll.open ? () => setHiddenPoll(sharpen._id) : isOrganizer ? () => void run(() => actions.dismissSharpen(sharpen._id), "Question skipped.") : undefined} />;
  } else if (sharpen && sharpen.status === "open") {
    const about = directionOf(sharpen.directionId);
    overlay = (
      <div className={s.ask} data-map-token>
        <small>{about ? `The council asks one question to sharpen “${about.label}”` : "The council asks one question"}</small>
        <p>{sharpen.question}</p>
        <div>
          {sharpen.options.map((o, i) => (
            <button key={i} type="button" disabled={!actions || !!pending} onClick={() => actions && void run(() => actions.answerSharpen(sharpen._id, i),
              o.clue ? `You answered: ${o.label}. It’s shared as your memory; ask for directions again to use it.` : `You voted for ${o.label}. No memory was added.`)}>{o.label}</button>
          ))}
        </div>
        {actions && <button type="button" className={s.askSkip} onClick={() => void run(() => actions.dismissSharpen(sharpen._id), "Question skipped.")}>Skip</button>}
      </div>
    );
  } else if (sharpen && sharpen.status === "answered" && sharpen.answer !== undefined) {
    overlay = (
      <div className={`${s.ask} ${s.askDone}`} data-map-token>
        <small>{sharpen.answeredBy ? name(sharpen.answeredBy) : "A friend"} answered</small>
        <p>{sharpen.options[sharpen.answer]?.label}</p>
        {actions && <button type="button" className={s.askSkip} onClick={() => void run(() => actions.dismissSharpen(sharpen._id), "Back to the whole map.")}>Done</button>}
      </div>
    );
  }

  // The council's tools live at the present: all of them when it's clicked, and the one that fits next right under it.
  const searching = research === "running";
  const sharpenOpen = sharpen?.status === "open";
  const thinking = pending === "directions";
  const proposeDirections = () => {
    if (!actions?.proposeDirections) return;
    setTrendAsked(Date.now());
    playCouncilTick();
    setWeave({ id: Date.now(), phase: "reaching", since: Date.now(), fresh: [] });
    void run(async () => {
      const result = await actions.proposeDirections!();
      if (result.ok && result.value && typeof result.value === "object" && "directions" in result.value && result.value.directions === 0) {
        return { ok: false as const, error: { code: "validation_failed" as const, message: "No new directions were added. Existing searches already cover these ideas, or the map is full. Share another interest or pass on a direction to make room." } };
      }
      return result;
    }, "Gift directions saved. Open one to find gifts.", "directions")
      .then((ok) => { if (!ok) setWeave(null); });
  };
  // The weave's threads. Every one is a real link: memories being weighed, the memories each new
  // direction combines, and the memories a refused idea cited (with the checks' reason).
  const weaveWorld: RingsWorld["weave"] = weaveThreads({
    weave,
    memoryKeys: clues.filter((c) => c.kind === "interest" || c.kind === "explicit_wish").map((c) => `clue:${c.id}`),
    directions: directionNodes,
    trail: data.trail ?? [],
    selectedKey,
  });

  const councilActs: RingAction[] = actions ? [
    ...(actions.proposeDirections ? [{ icon: "spark" as const, label: thinking ? "Combining…" : directions.length ? "New directions" : "Combine into directions", disabled: !!pending || clues.length < 2, run: proposeDirections }] : []),
    // Themes form on their own as memories change (D23 trial); there is no grouping button.
    ...(isOrganizer && !actions.proposeDirections ? [{ icon: "sprout" as const, label: searching ? "Searching…" : recs.length ? "Find more gifts" : "Find gifts", disabled: !!pending || searching || !allClueIds.length, run: () => startSearch("box") }] : []),
    { icon: "scales", label: pending === "sharpen" ? "Thinking…" : "Help us choose", disabled: !!pending || recs.length < 2 || sharpenOpen, run: () => void run(() => actions.sharpen(), "The council has one question for you.", "sharpen") },
    ...(data.trail ? [{ icon: "thread" as const, label: "How we got here", disabled: !data.trail.length, run: () => setStory({}) }] : []),
  ] : [];
  const act = (label: string) => councilActs.find((a) => a.label === label);
  let nextStep: RingsWorld["nextStep"] = null;
  if (actions) {
    if (selection) nextStep = { icon: "present", label: `Review shares · ${approved}/${participants.length} yes`, run: () => setSelectedKey("box") };
    else if (!allClues.length) nextStep = { icon: "cloud", label: "Click the sky to share a memory" };
    else if (clues.length < 2 && actions.proposeDirections) nextStep = { icon: "cloud", label: "Share one more memory, then the council can combine them" };
    else if (!directions.length && actions.proposeDirections) nextStep = { icon: "spark", label: thinking ? "Combining…" : `Combine ${clues.length} memories into gift directions`, disabled: !!pending, run: proposeDirections };
    else if (directions.length && !recs.length && !searching) nextStep = { icon: "sprout", label: isOrganizer ? "Open a direction and find gifts for it" : "The organizer finds gifts for a direction next" };
    else if (!recs.length && isOrganizer && !searching) nextStep = { ...act("Find gifts")!, label: "Find gifts from these memories" };
    else if (!recs.length && !isOrganizer && !searching) nextStep = { icon: "sprout", label: "The organizer finds gifts next" };
    else if (recs.length >= 2 && !sharpenOpen) nextStep = { ...act("Help us choose")!, label: pending === "sharpen" ? "Thinking…" : "Can’t decide? Ask one question" };
  }
  // The same council tools, as buttons for the bar's "More" menu (Ally's layout).
  const tools = councilActs.length ? (
    <>
      {councilActs.map((a) => (
        <button key={a.label} type="button" className={s.tool} disabled={a.disabled} onClick={a.run}>
          <MapIcon name={a.icon} size={15} />{a.label}
        </button>
      ))}
    </>
  ) : null;

  // Other members: their recent votes on memories and themes, and their cursors on the map.
  const pulses: Record<string, { name: string; value: number; color: string }> = {};
  for (const row of signalRows ?? []) {
    for (const voter of row.voters) {
      if (voter.participantId === me.id || now - voter.at > PULSE_MS) continue;
      pulses[`${row.targetKind}:${row.targetId}`] = { name: name(voter.participantId), value: voter.value, color: colorOf(voter.participantId) };
    }
  }
  const cursors = (data.cursors ?? [])
    .filter((c) => c.space === "rings" && now - c.updatedAt < CURSOR_MS)
    .map((c) => ({ key: c.participantId, name: c.displayName, color: colorOf(c.participantId), x: c.x, z: c.y }));

  const rings: RingsWorld = {
    clues: layout.clues.map((c) => {
      const clue = clues.find((x) => x.id === c.id)!;
      return { key: `clue:${c.id}`, text: clue.text, author: twin.clueAuthors.get(clue.id) ?? name(clue.publisherId), agent: twin.clueAuthors.has(clue.id), avatar: avatarOf(clue.publisherId), color: twin.clueAuthors.has(clue.id) ? "#8b72ba" : colorOf(clue.publisherId), theme: c.theme, tint: themeTint.get(c.theme) ?? OTHER_TINT, x: c.x, z: c.z, fromPhoto: clue.sourceKind === "photo", photo: thumbFor(clue.id) };
    }),
    weave: weaveWorld,
    ideas: ideas.map<RingsWorld["ideas"][number]>((idea, i) => {
      // Friends' ideas sit just inside the gift ring, spaced around it, until research turns them into listings.
      const [x, z] = ringPoint(235 + i * 47, RING_RADII.gift - 0.4);
      return { key: `idea:${idea.id}`, text: idea.text.slice(GIFT_IDEA_PREFIX.length), author: twin.clueAuthors.get(idea.id) ?? name(idea.publisherId), agent: twin.clueAuthors.has(idea.id), tag: twin.clueAuthors.has(idea.id) ? `${twin.clueAuthors.get(idea.id)} · AI suggestion` : undefined, avatar: avatarOf(idea.publisherId), x, z };
    }).concat(directionNodes.map((d) => {
      const author = d.memories[0]?.publisherId ?? me.id;
      return { key: d.key, text: d.label, author: name(author), avatar: avatarOf(author), x: d.x, z: d.z,
        tag: d.faded ? "direction · passed" : `direction · joins ${d.clueIds.length} ${d.clueIds.length === 1 ? "wish" : "memories"}`, faded: d.faded, direction: true };
    }), trendIdeas.map((t) => ({
      key: t.key, text: t.query, author: name(t.source.publisherId), avatar: avatarOf(t.source.publisherId), x: t.x, z: t.z,
      tag: t.caught ? "caught trend" : `drifting trend · ${t.signal}`, trend: true,
    }))),
    themes: layout.themes.map((t) => {
      // Up to four faces of the friends who shared into this theme.
      const authors = [...new Set(layout.clues.filter((c) => c.theme === t.id).filter((c) => !twin.clueAuthors.has(c.id)).map((c) => clues.find((x) => x.id === c.id)!.publisherId))].slice(0, 4);
      return {
        key: `theme:${t.id}`, theme: t.id, label: t.label, count: t.count, x: t.x, z: t.z, tint: themeTint.get(t.id) ?? OTHER_TINT, jar: themeJar.get(t.id) ?? "moment",
        faces: authors.map((id) => ({ avatar: avatarOf(id), color: colorOf(id) })),
        research: researchTheme === t.id ? research : null,
      };
    }),
    openTheme: openTheme && layout.themes.some((t) => t.id === openTheme) ? openTheme : null,
    gifts: layout.gifts.map((g, i) => {
      const l = listingById.get(g.listingId)!;
      const up = data.votes[g.listingId]?.tally.up ?? 0;
      const down = data.votes[g.listingId]?.tally.down ?? 0;
      // A pass fades a gift; once half the room has passed and nobody pulled it in, it leaves the map (D23 trial).
      const fade = fadeOf({ up, down }, members);
      const kept = selectedIds.has(g.listingId) || selectedKey === `gift:${g.listingId}` || whyListing === g.listingId;
      return {
        key: `gift:${g.listingId}`, listingId: g.listingId, title: l.title, price: priceOf(g.listingId), imageUrl: l.imageUrl, themes: g.themes, x: g.x, z: g.z, rank: i + 1,
        up, down, fixture: l.source === "manual_fixture",
        finalist: finalists.has(g.listingId), faded: (finalists.size > 0 && !finalists.has(g.listingId)) || fade === "faded",
        // Only the leading few show; the chosen gift, finalists and anything open or explained stay visible.
        // Every gift is on the map unless the room let it go; a crowded map bundles extras (GiftRings).
        hidden: fade === "gone" && !kept,
      };
    }),
    boxResearch: research && !researchTheme ? research : null,
    votes: signals.tally,
    evaluations: twin.evaluations,
    pulses,
    cursors,
    overlay,
    selectedListingId: selection?.listingId,
    selectedListingIds: [...selectedIds],
    pledge,
    boxPanel: selection ? boxPanel : null,
    nextStep,
    boxLabel: selection ? `${selectedIds.size} ${selectedIds.size === 1 ? "gift" : "gifts"} · ${revision && revision.status !== "infeasible" ? formatMinor(revision.payableTotalMinor) : "Review estimate"} · ${approved}/${participants.length} yes` : "Our gift box",
    onOpenBook: (listingId) => book.show({ listingId: listingId ?? null }),
    selectedKey,
    highlight,
    composer: composer && (photoComposer ?? composerNode) ? { x: composer.x, z: composer.z, node: photoComposer ?? composerNode } : null,
    photos: photoNodes,
    onSelect: (key) => {
      setComposer(null);
      setSelectedKey(key);
      if (key !== passing) setPassing(null);
      // A theme fans out its memories; a memory keeps its theme open around it.
      if (key?.startsWith("theme:")) setOpenTheme(key.slice(6));
      else if (key?.startsWith("clue:")) setOpenTheme(themeOfClue.get(key.slice(5)) ?? null);
      else if (key === null && selectedKey?.startsWith("theme:")) setOpenTheme(null);
      else if (key !== null) setOpenTheme(null);
      // “Why?” stays lit while its gift or the box is open.
      if (key !== "box" && key !== `gift:${whyListing}`) setWhyListing(null);
      // Choosing a memory, theme, gift or direction glides the camera to it, keeping the viewer's angle.
      const at = key ? layout.clues.find((c) => `clue:${c.id}` === key) ?? layout.themes.find((t) => `theme:${t.id}` === key) ?? layout.gifts.find((g) => `gift:${g.listingId}` === key) ?? directionNodes.find((d) => d.key === key) ?? photoNodes.find((p) => p.key === key) : undefined;
      if (at && key?.startsWith("gift:")) mapView.focusGift(at.x, at.z);
      else if (at) mapView.focus(at.x, at.z);
      else if (key === null && selectedKey?.startsWith("gift:")) mapView.returnFromGift();
    },
    onEmpty: (point, zone?: RingZone) => {
      setSelectedKey(null);
      setWhyListing(null);
      setOpenTheme(null);
      if (point) composerDraft.current = "";
      setComposer(point && actions ? { x: point[0], z: point[1], zone: zone === "gift" ? "gift" : "memory", kind: "interest" } : null);
    },
    onDrag: (key: string, result: RingDragResult) => {
      if (!result) return;
      if (key.startsWith("gift:")) {
        const listingId = key.slice(5);
        if (result === "box") choose(listingId);
        else vote(listingId, result === "support" ? "up" : "down");
        return;
      }
      const [kind, id] = key.startsWith("theme:") ? (["theme", key.slice(6)] as const) : (["clue", key.slice(5)] as const);
      if (result === "box") return;
      if (kind === "theme" && id === OTHER_THEME) return;
      const value = result === "support" ? 1 : -1;
      if (signals.mine[`${kind}:${id}`] !== value) signal(kind, id, value);
    },
    onPointer: (x, z) => {
      // A few updates a second is plenty for a friend's cursor, and keeps writes cheap.
      const t = performance.now();
      const last = lastCursor.current;
      if (!actions || t - last.at < 150 || Math.hypot(x - last.x, z - last.z) < 0.2) return;
      lastCursor.current = { at: t, x, z };
      void actions.moveCursor(Math.round(x * 100) / 100, Math.round(z * 100) / 100).catch(() => undefined);
    },
    actionsFor,
  };
  // A trend lookup this viewer started: say when it stops, so a failure never reads as "still checking".
  const trendJob = data.trends?.latestJob;
  const trendFailed = trendAsked !== null && trendJob && trendJob.createdAt >= trendAsked - 5000 && (trendJob.status === "failed" || trendJob.status === "stale")
    ? `The trend lookup stopped${trendJob.lastError ? `: ${trendJob.lastError}` : "."} Memories and gifts are unchanged.`
    : null;
  // "How we got here": the decision log, lit along the chosen gift's path when one is open.
  let storyNode: ReactNode | null = null;
  if (story && data.trail) {
    const rec = story.listingId ? recs.find((r) => r.listingId === story.listingId) : undefined;
    const listing = story.listingId ? listingById.get(story.listingId) : undefined;
    const via = directionOf(rec?.foundBy?.directionId);
    // The boxed gift may have left the shown shortlist; its box snapshot still names it.
    const title = listing?.title ?? (selection && selection.listingId === story.listingId ? selection.listingSnapshot.title : undefined);
    storyNode = (
      <HowWeGotHere entries={data.trail} onClose={closeStory}
        {...(rec && listing ? { chain: whyChain(rec, listing) } : {})}
        {...(title ? { giftTitle: title } : {})}
        {...(story.listingId ? { focus: { listingId: story.listingId, ...(via ? { directionId: via.id, clueIds: via.clueIds } : rec ? { clueIds: rec.publishedClueIds } : {}) } } : {})} />
    );
  }
  // The council's reaction to the room's passes reaches everyone's status line as it happens.
  const reaction = (data.trail ?? []).findLast((e) => e.actor === "council" && now - e.at < REACTION_MS
    && (e.text.startsWith("Retired") || e.text.startsWith("Suggested") || e.text.startsWith("Couldn’t find")));
  return { councilThinking: pending === "directions" ? "Combining memories…" : pending === "themes" ? "Grouping memories…" : pending === "sharpen" ? "Thinking of a question…" : null, rings, notice: reaction ? `The council: ${reaction.text}` : notice, error: error ?? trendFailed, openBox, startAdd, tools, story: storyNode };
}
