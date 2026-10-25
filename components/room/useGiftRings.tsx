"use client";

import { type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { reencodeImage } from "@/lib/live/image";
import type { AvatarId } from "@/components/characters/StorybookAvatar";
import type { RingAction, RingsWorld } from "@/components/world/room/GiftRings";
import s from "@/components/world/room/gift-rings.module.css";
import type { PledgeWorld } from "@/components/world/room/PledgeRing";
import type { ClueKind, Result } from "@/lib/contracts";
import { GIFT_IDEA_PREFIX, isGiftIdea, layoutRings, OTHER_THEME, RING_RADII, RING_THEMES, ringPoint, type RingDragResult, type RingTheme, type RingZone, themeForKind } from "@/lib/map/rings";
import { formatMinor } from "@/lib/money";
import { avatarFor } from "@/lib/room/avatars";
import { BoxPanel } from "./BoxPanel";
import type { RoomActions, RoomData } from "./types";

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

/**
 * Builds the gift map for the 3D world from live room data (D19). Every
 * action goes through the existing room actions. Votes on memories and
 * themes are advisory signals; listing votes, selection and approvals keep
 * their own rules.
 */
export function useGiftRings({ data, actions, isOrganizer, active, onPaste }: {
  data: RoomData;
  actions?: RoomActions;
  isOrganizer: boolean;
  active: boolean;
  onShares?(): void;
  onPaste(): void;
}): { rings: RingsWorld | null; notice: string | null; error: string | null; openBox(): void; tools: ReactNode } {
  const { participants, me } = data.view;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // One add box. Its zone decides what it makes: a memory or wish outside, a gift idea in the inner ring.
  const [composer, setComposer] = useState<{ x: number; z: number; zone: "memory" | "gift"; kind: ClueKind; photo?: boolean } | null>(null);
  // Photos picked in the add box before they're sent.
  const [photoPick, setPhotoPick] = useState<{ blob: Blob; preview: string; marker?: { x: number; y: number } }[]>([]);
  const [why, setWhy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [now, setNow] = useState(0);
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
  const listingById = useMemo(() => new Map(data.listings.map((l) => [l.id, l])), [data.listings]);
  const recs = useMemo(() => [...data.recommendations].filter((r) => listingById.has(r.listingId)).sort((a, b) => b.score - a.score), [data.recommendations, listingById]);

  // Direction signals: net pull per memory or theme, the viewer's own vote, and who voted.
  const signalRows = data.mapSignals;
  const signals = useMemo(() => {
    const clue: Record<string, number> = {};
    const theme: Record<string, number> = {};
    const tally: Record<string, { up: number; down: number }> = {};
    const mine: Record<string, number> = {};
    for (const row of signalRows ?? []) {
      const key = `${row.targetKind}:${row.targetId}`;
      (row.targetKind === "clue" ? clue : theme)[row.targetId] = row.up - row.down;
      tally[key] = { up: row.up, down: row.down };
      const own = row.voters.find((v) => v.participantId === me.id);
      if (own) mine[key] = own.value;
    }
    return { clue, theme, tally, mine };
  }, [signalRows, me.id]);

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

  const openBox = () => setSelectedKey("box");
  if (!active) return { rings: null, notice, error, openBox, tools: null };

  const name = (id: string) => (id === me.id ? "You" : participants.find((p) => p.id === id)?.displayName ?? "A friend");
  const avatarOf = (id: string) => avatarFor(participants, id);
  const colorOf = (id: string) => AVATAR_COLOR[avatarOf(id)];
  const selection = data.selection?.status === "active" ? data.selection : null;
  const revision = data.proposal.revision;
  const approved = revision ? data.proposal.approvals.filter((a) => a.revisionId === revision.id && a.status === "approved").length : 0;
  const priceOf = (listingId: string) => {
    const l = listingById.get(listingId);
    return l?.priceStatus === "observed" && l.priceMinor !== undefined ? formatMinor(l.priceMinor) : "Price unknown";
  };
  const allClueIds = allClues.map((c) => c.id);
  const findGifts: RingAction | null = isOrganizer && actions
    ? { icon: "🌱", label: recs.length ? "Find more gifts" : "Find gifts", tone: "gold", disabled: !!pending || !allClueIds.length, run: () => void run(() => actions.startResearch(allClueIds), "The council is looking for real gifts from these memories.") }
    : null;

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

  // “Why this?”: the chosen gift, its themes, and the clues its recommendation cites.
  let highlight: Set<string> | null = null;
  if (why && selection) {
    const rec = recs.find((r) => r.listingId === selection.listingId);
    const cited = (rec?.publishedClueIds ?? []).filter((id) => themeOfClue.has(id));
    highlight = new Set(["box", `gift:${selection.listingId}`, ...cited.map((id) => `clue:${id}`), ...cited.map((id) => `theme:${themeOfClue.get(id)}`)]);
  }

  const vote = (listingId: string, value: "up" | "down") => {
    if (!actions) return;
    const mine = data.votes[listingId]?.myVote;
    void (mine === value
      ? run(() => actions.clearVote(listingId), "Vote taken back.")
      : run(() => actions.castVote(listingId, value), value === "up" ? "You pulled it closer: it feels right." : "You pushed it away for now. Nothing was deleted."));
  };
  const signal = (targetKind: "clue" | "theme", targetId: string, value: 1 | -1) => {
    if (!actions) return;
    const mine = signals.mine[`${targetKind}:${targetId}`];
    const next = mine === value ? 0 : value;
    void run(() => actions.setDirection(targetKind, targetId, next), next === 0 ? "Vote taken back." : next > 0 ? "You pulled it closer. Gifts in that direction move in too." : "You pushed it away for now. Nothing was deleted.");
  };
  const voteActs = (targetKind: "clue" | "theme", targetId: string): RingAction[] => {
    const mine = signals.mine[`${targetKind}:${targetId}`];
    return actions ? [
      { icon: "♥", label: "Feels like her", tone: "yes", on: mine === 1, disabled: !!pending, run: () => signal(targetKind, targetId, 1) },
      { icon: "✕", label: "Not really", tone: "pass", on: mine === -1, disabled: !!pending, run: () => signal(targetKind, targetId, -1) },
    ] : [];
  };
  const choose = (listingId: string) => {
    if (!actions) return;
    void (isOrganizer
      ? run(() => actions.selectGift(listingId), "It’s in the box. Everyone approves this exact version.").then((ok) => ok && setSelectedKey("box"))
      : run(() => actions.castVote(listingId, "up"), "Your vote is in. The organizer puts the final gift in the box."));
  };

  const actionsFor = (key: string): { caption: ReactNode; actions: RingAction[] } | null => {
    // The box opens its own panel beside the present; no bloom row here.
    if (key === "box") return null;
    if (key.startsWith("theme:")) {
      const id = key.slice(6);
      const t = layout.themes.find((x) => x.id === id);
      if (!t) return null;
      const council = !t.bucket && id !== OTHER_THEME;
      return {
        caption: <><b>{t.label}</b> · {t.count} shared {t.count === 1 ? "memory" : "memories"}{council ? " · grouped by the council" : ""}</>,
        actions: [...(id === OTHER_THEME ? [] : voteActs("theme", id)), ...(findGifts ? [findGifts] : [])],
      };
    }
    if (key.startsWith("gift:")) {
      const listingId = key.slice(5);
      const listing = listingById.get(listingId);
      const rec = recs.find((r) => r.listingId === listingId);
      if (!listing) return null;
      const mine = data.votes[listingId]?.myVote;
      return {
        caption: <><b>{listing.title}</b> · {priceOf(listingId)}{listing.source === "manual_fixture" ? " · sample" : ""}<br />{rec?.explanation}</>,
        actions: actions ? [
          { icon: "♥", label: "Feels right", tone: "yes", on: mine === "up", disabled: !!pending, run: () => vote(listingId, "up") },
          { icon: "✕", label: "Pass for now", tone: "pass", on: mine === "down", disabled: !!pending, run: () => vote(listingId, "down") },
          { icon: "🎁", label: isOrganizer ? (selection?.listingId === listingId ? "In the box" : "Put in the box") : "Vote for the box", tone: "gold", on: selection?.listingId === listingId, disabled: !!pending, run: () => choose(listingId) },
          { icon: "🏠", label: "She has it", disabled: !!pending, run: () => void run(() => actions.reactToGift(listingId, "owned"), "Shared with the room: she already owns this. Ideas are being rechecked.") },
          { icon: "💸", label: "Too pricey for me", disabled: !!pending, run: () => void run(() => actions.reactToGift(listingId, "price"), "Saved for you. Budgets and private limits did not change.") },
          { icon: "↗", label: "Open the listing", run: () => window.open(listing.sourceUrl, "_blank", "noopener,noreferrer") },
        ] : [],
      };
    }
    if (key.startsWith("photo:")) {
      const group = groups.find((g) => g.key === key);
      if (!group) return null;
      const mine = group.uploaderId === me.id;
      const found = mine ? foundFor(group.sourceId) : [];
      return {
        caption: mine ? (
          <span className={s.found}>
            <b>Your photo · everyone sees it</b>
            {found.length === 0 ? <span>{group.clueIds.length ? `${group.clueIds.length} shared from it. Nothing left to review.` : "Reading it… what Unwrap guesses appears here, only for you."}</span> : (
              <>
                <span>Only you see these guesses until you share them:</span>
                {found.map((c) => (
                  <span key={c.id} className={s.foundRow}>
                    <em>{c.text}{c.confidence < 0.6 ? " · maybe" : ""}</em>
                    {actions && <button type="button" onClick={() => void run(() => actions.publishClue(c.id), "Shared with the room.")}>Share</button>}
                    {actions && <button type="button" className={s.foundNo} onClick={() => void run(() => actions.rejectClue(c.id), "Discarded. Nobody else saw it.")}>✕</button>}
                  </span>
                ))}
              </>
            )}
          </span>
        ) : <><b>{name(group.uploaderId)}’s photo{group.urls.length > 1 ? "s" : ""}</b>{group.clueIds.length ? ` · ${group.clueIds.length} ${group.clueIds.length === 1 ? "memory" : "memories"} from it` : ""}</>,
        actions: actions && mine ? [{
          icon: "🗑", label: "Delete for everyone", disabled: !!pending,
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
        caption: <><b>{idea.text.slice(GIFT_IDEA_PREFIX.length)}</b><br />{name(idea.publisherId) === "You" ? "Your" : `${name(idea.publisherId)}’s`} gift idea · research turns it into real listings</>,
        actions: [
          ...(findGifts ? [{ ...findGifts, label: "Find this gift" }] : []),
          ...(actions && idea.publisherId === me.id ? [{ icon: "↩", label: "Take it back", disabled: !!pending, run: () => void run(() => actions.withdrawClue(idea.id), "Your gift idea was withdrawn.").then((ok) => ok && setSelectedKey(null)) }] : []),
        ],
      };
    }
    const clue = clues.find((c) => `clue:${c.id}` === key);
    if (!clue) return null;
    return {
      caption: <>{name(clue.publisherId) === "You" ? "Your" : `${name(clue.publisherId)}’s`} memory · in {themeLabel(themeOfClue.get(clue.id) ?? "")}</>,
      actions: [
        ...voteActs("clue", clue.id),
        ...(findGifts ? [findGifts] : []),
        ...(actions && clue.publisherId === me.id ? [{ icon: "↩", label: "Take it back", disabled: !!pending, run: () => void run(() => actions.withdrawClue(clue.id), "Your memory was withdrawn from the room.").then((ok) => ok && setSelectedKey(null)) }] : []),
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
          <button type="button" role="radio" aria-checked={false} onClick={() => setComposer({ ...composer, photo: true })} aria-label="Add photos privately">📷 Photo</button>
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
  };
  const markPhoto = (index: number, e: ReactMouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const marker = { x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)) };
    setPhotoPick((items) => items.map((it, i) => (i === index ? { ...it, marker } : it)));
  };
  const readPhotos = () => {
    if (!actions || !photoPick.length) return;
    const picked = photoPick;
    void run(() => actions.importPhotos(picked.map(({ blob, marker }) => ({ blob, marker }))), "Shared with the room. Unwrap is reading them; only you see what it guesses until you share it.", "photos").then((ok) => {
      if (ok) {
        setComposer(null);
        setPhotoPick([]);
      }
    });
  };
  const photoComposer = composer?.photo && actions ? (
    <div className={s.write} data-map-token>
      <div className={s.kinds} role="radiogroup" aria-label="What is it?">
        {([["interest", "💭 Memory"], ["explicit_wish", "🎁 Wish"]] as const).map(([kind, label]) => (
          <button key={kind} type="button" role="radio" aria-checked={false} onClick={() => setComposer({ ...composer, kind, photo: false })}>{label}</button>
        ))}
        <button type="button" role="radio" aria-checked>📷 Photo</button>
      </div>
      {photoPick.length === 0 ? (
        <label className={s.photoPick}>
          <span aria-hidden>📷</span>Choose up to 3 photos
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { void pickPhotos(e.target.files); e.target.value = ""; }} />
        </label>
      ) : (
        <div className={s.photoRow}>
          {photoPick.map((it, i) => (
            <button key={it.preview} type="button" className={s.polaroidPick} onClick={(e) => markPhoto(i, e)} aria-label={`Photo ${i + 1}: tap the person it’s for`}>
              <img src={it.preview} alt="" />
              {it.marker && <i style={{ left: `${it.marker.x * 100}%`, top: `${it.marker.y * 100}%` }} aria-hidden />}
            </button>
          ))}
        </div>
      )}
      <p>{photoPick.length ? "Tap her in each photo. It’s your mark, not face recognition, and only you see it." : "Everyone in the room will see these photos. Location data is removed."}</p>
      {photoPick.length > 0 && (
        <button type="button" className={s.readBtn} disabled={pending === "photos"} onClick={readPhotos}>{pending === "photos" ? "Sharing…" : `Share ${photoPick.length === 1 ? "it" : "them"} with the room`}</button>
      )}
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
      isOrganizer={isOrganizer} actions={actions} avatarOf={avatarOf} colorOf={colorOf} why={why} onWhy={() => setWhy((w) => !w)} onClose={() => setSelectedKey(null)} />
  );

  // The sharpen round: one question between the two leading gifts.
  let overlay: ReactNode = null;
  if (sharpen && sharpen.status === "open") {
    overlay = (
      <div className={s.ask} data-map-token>
        <small>The council asks one question{sharpen.source === "preset" ? "" : ""}</small>
        <p>{sharpen.question}</p>
        <div>
          {sharpen.options.map((o, i) => (
            <button key={i} type="button" disabled={!actions || !!pending} onClick={() => actions && void run(() => actions.answerSharpen(sharpen._id, i), `You answered: ${o.label}. It’s shared as your memory, and the gifts re-rank.`)}>{o.label}</button>
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

  // Map-level tools: let the council group memories into themes, and sharpen the two leading gifts.
  const tools = actions ? (
    <>
      <button type="button" className={s.tool} disabled={!!pending || clues.length < 3} title={clues.length < 3 ? "Share at least 3 memories first" : "The council groups memories into themes"}
        onClick={() => void run(() => actions.suggestThemes(), "The council grouped the memories into themes.", "themes")}>
        {pending === "themes" ? "Grouping…" : councilThemes.length ? "✨ Regroup themes" : "✨ Group into themes"}
      </button>
      <button type="button" className={s.tool} disabled={!!pending || recs.length < 2} title={recs.length < 2 ? "Find at least two gifts first" : "One question to split the two leading gifts"}
        onClick={() => void run(() => actions.sharpen(), "The council has one question for you.", "sharpen")}>
        {pending === "sharpen" ? "Thinking…" : "🎯 Sharpen"}
      </button>
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
      return { key: `clue:${c.id}`, text: clue.text, author: name(clue.publisherId), avatar: avatarOf(clue.publisherId), theme: c.theme, tint: themeTint.get(c.theme) ?? OTHER_TINT, x: c.x, z: c.z, fromPhoto: clue.sourceKind === "photo", photo: thumbFor(clue.id) };
    }),
    ideas: ideas.map((idea, i) => {
      // Friends' ideas sit just inside the gift ring, spaced around it, until research turns them into listings.
      const [x, z] = ringPoint(235 + i * 47, RING_RADII.gift - 0.4);
      return { key: `idea:${idea.id}`, text: idea.text.slice(GIFT_IDEA_PREFIX.length), author: name(idea.publisherId), avatar: avatarOf(idea.publisherId), x, z };
    }),
    themes: layout.themes.map((t) => ({ key: `theme:${t.id}`, theme: t.id, label: t.label, count: t.count, x: t.x, z: t.z, tint: themeTint.get(t.id) ?? OTHER_TINT, jar: themeJar.get(t.id) ?? "moment" })),
    gifts: layout.gifts.map((g, i) => {
      const l = listingById.get(g.listingId)!;
      return {
        key: `gift:${g.listingId}`, listingId: g.listingId, title: l.title, price: priceOf(g.listingId), imageUrl: l.imageUrl, themes: g.themes, x: g.x, z: g.z, rank: i + 1,
        up: data.votes[g.listingId]?.tally.up ?? 0, down: data.votes[g.listingId]?.tally.down ?? 0, fixture: l.source === "manual_fixture",
        finalist: finalists.has(g.listingId), faded: finalists.size > 0 && !finalists.has(g.listingId),
      };
    }),
    votes: signals.tally,
    pulses,
    cursors,
    overlay,
    selectedListingId: selection?.listingId,
    pledge,
    boxPanel,
    boxLabel: selection ? `${priceOf(selection.listingId)} · ${approved}/${participants.length} yes` : "Our gift box",
    selectedKey,
    highlight,
    composer: composer && (photoComposer ?? composerNode) ? { x: composer.x, z: composer.z, node: photoComposer ?? composerNode } : null,
    photos: photoNodes,
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
  return { rings, notice, error, openBox, tools };
}
