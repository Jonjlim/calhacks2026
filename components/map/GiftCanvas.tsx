"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ProductListing, Result } from "@/lib/contracts";
import { newRequestKey, withId } from "@/lib/client";
import { formatMinor } from "@/lib/money";
import { avatarFor, portraitUrl } from "@/lib/room/avatars";
import { matchesVibe, pageItems, treePoint, VIBES } from "@/lib/map/tree";
import { useSession } from "@/components/providers/ConvexClientProvider";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { ProductCard } from "@/components/products/ProductCard";
import { ProposalPanel } from "@/components/proposal/ProposalPanel";
import type { TreeNode } from "./treeTypes";
import s from "./memory-tree.module.css";

const Scene = dynamic(() => import("./MemoryTreeScene"), { ssr: false, loading: () => <p className={s.loading}>The little world is arriving…</p> });
const Diagram = dynamic(() => import("./GiftDiagram").then(m => m.GiftDiagram), { ssr: false });
const ROOM_ID = /^[a-z0-9]{20,40}$/;

export function GiftCanvas({ roomId }: { roomId: string }) {
  const session = useSession();
  const [arrange, setArrange] = useState(false);
  if (!ROOM_ID.test(roomId)) return <MapMessage text="That link does not point to a gift room." />;
  if (session.status === "offline") return <MapMessage text="Connect a Convex backend to open a live memory tree." />;
  if (session.status === "error") return <MapMessage text="We couldn't connect to Unwrap." retry={session.retry} />;
  if (session.status !== "ready") return <MapMessage text="Opening the memory tree…" />;
  if (arrange) return <><Diagram roomId={roomId} /><button className={s.returnToTree} onClick={() => setArrange(false)}>← Back to sky tree</button></>;
  return <ErrorBoundary fallback={<MapMessage text="The map could not load. Your room is still available; check that its latest map functions are deployed." />}><MemoryTree roomId={roomId as Id<"rooms">} onArrange={() => setArrange(true)} /></ErrorBoundary>;
}
function MapMessage({ text, retry }: { text: string; retry?: () => void }) {
  return <main className={s.message}><h1>{text}</h1>{retry && <button onClick={retry}>Try again</button>}<Link href="/">Back to Unwrap</Link></main>;
}
function MemoryTree({ roomId, onArrange }: { roomId: Id<"rooms">; onArrange(): void }) {
  const roomRes = useQuery(api.rooms.getRoom, { roomId });
  const clueRes = useQuery(api.clues.listPublishedClues, { roomId });
  const recsRes = useQuery(api.research.research.listRecommendations, { roomId });
  const mapRes = useQuery(api.map.getMapState, { roomId });
  const selectionRes = useQuery(api.proposals.getSelection, { roomId });
  const proposalRes = useQuery(api.proposals.getProposal, { roomId });
  const activityRes = useQuery(api.agents.buyer.listActivity, { roomId });
  const jobsRes = useQuery(api.jobs.listRoomJobs, { roomId });
  const cursorsRes = useQuery(api.map.listCursors, { roomId });
  const grow = useAction(api.map.growSeed);
  const plant = useMutation(api.map.plantSprout);
  const edit = useMutation(api.map.editMemory);
  const setFeedback = useMutation(api.map.setFeedback);
  const undoFeedback = useMutation(api.map.undoFeedback);
  const startResearch = useMutation(api.research.research.startResearch);
  const select = useMutation(api.proposals.selectGift);
  const vote = useMutation(api.votes.castVote);
  const addClue = useMutation(api.clues.upsertManualPreference);
  const seedDemo = useMutation(api.demo.seedFixturePool);
  const moveCursor = useMutation(api.map.moveCursor);
  const setLimit = useMutation(api.proposals.setContributionLimit);
  const approve = useMutation(api.proposals.approveRevision);
  const withdrawApproval = useMutation(api.proposals.withdrawApproval);
  const clearSelection = useMutation(api.proposals.clearSelection);
  const reducedMotion = useReducedMotion() ?? false;
  const [listView, setListView] = useState(false);
  const [smallScreen, setSmallScreen] = useState(true);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 800px)");
    const update = () => setSmallScreen(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const [focus, setFocus] = useState("box:main");
  const [memoryPage, setMemoryPage] = useState(0);
  const [productPage, setProductPage] = useState(0);
  const [vibe, setVibe] = useState<string | null>(null);
  const [armed, setArmed] = useState<"owned" | "price" | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [growing, setGrowing] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("Visit a little friend to follow their memory.");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editBase, setEditBase] = useState("");
  const [confirmIdea, setConfirmIdea] = useState(false);
  const [now, setNow] = useState(0);
  const lastPointer = useRef(0);
  const actionLock = useRef(false);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 2000); return () => clearInterval(t); }, []);
  useEffect(() => { setConfirmIdea(false); }, [focus]);

  const room = roomRes?.ok ? roomRes.value : null;
  const clues = useMemo(() => clueRes?.ok ? clueRes.value.filter(c => c.status === "active").map(withId) : [], [clueRes]);
  const recommendations = recsRes?.ok ? recsRes.value.recommendations : [];
  const liveListings = recsRes?.ok ? recsRes.value.listings : [];
  const feedback = mapRes?.ok ? mapRes.value.feedback : [];
  const sprouts = mapRes?.ok ? mapRes.value.sprouts : [];
  const listings = useMemo(() => {
    const rows = new Map<string, ProductListing>(liveListings.map(l => [l.id, l]));
    for (const reaction of feedback) if (!rows.has(reaction.listing._id)) rows.set(reaction.listing._id, withId(reaction.listing));
    return [...rows.values()];
  }, [liveListings, feedback]);
  const me = room?.me;
  const participants = room?.participants ?? [];
  const ownerName = (id: string) => participants.find(p => p.id === id)?.displayName ?? "A friend";
  const clue = clues.find(c => `seed:${c.id}` === focus);
  const product = listings.find(l => `product:${l.id}` === focus);
  const sprout = sprouts.find(i => `sprout:${i._id}` === focus);
  const focusedSeed = clue?.id ?? sprout?.seedClueId;
  const ownFeedback = product ? feedback.filter(f => f.listing._id === product.id && f.participantId === me?.id) : [];
  const job = jobsRes?.ok ? jobsRes.value.researchJobs[0] : null;
  const researching = job?.status === "pending" || job?.status === "running";
  const selection = selectionRes?.ok && selectionRes.value ? withId(selectionRes.value) : null;
  const proposal = proposalRes?.ok ? proposalRes.value : null;
  const approved = proposal?.revision?.status === "approved_pledged";
  const busy = pending !== null;
  const recentEvent = activityRes?.ok ? activityRes.value.events.at(-1)?.summary : undefined;
  const visibleClues = pageItems(clues, memoryPage);
  const visibleProducts = pageItems(listings, productPage);
  const visibleSprouts = sprouts.filter(i => i.seedClueId === focusedSeed).slice(0, 2);
  const nodes: TreeNode[] = [
    ...visibleClues.map((c, i): TreeNode => ({ key: `seed:${c.id}`, kind: "memory", title: c.text, byline: `${ownerName(c.publisherId)} remembers`, detail: growing.has(c.id) ? "Growing ideas…" : "Visit this memory ↗", avatar: avatarFor(participants, c.publisherId), position: treePoint("memory", i), active: focus === `seed:${c.id}`, busy: growing.has(c.id) })),
    ...visibleProducts.map((l, i): TreeNode => {
      const reactions = feedback.filter(f => f.listing._id === l.id);
      const owned = reactions.some(f => f.kind === "owned");
      const pricey = reactions.some(f => f.kind === "price" && f.participantId === me?.id);
      const rec = recommendations.find(r => r.listingId === l.id);
      const publisher = clues.find(c => c.id === rec?.publishedClueIds[0])?.publisherId;
      return { key: `product:${l.id}`, kind: "product", title: l.title, byline: owned ? "Already owns · inspect to undo" : pricey ? "Too pricey for you" : l.source === "manual_fixture" ? "Sample gift · fixture" : "Observed product", detail: l.priceStatus === "observed" && l.priceMinor !== undefined ? `${formatMinor(l.priceMinor)} · observed item price` : "Price unknown", avatar: avatarFor(participants, publisher ?? ""), position: treePoint("product", i, matchesVibe(l.title, vibe)), dimmed: owned || pricey, active: focus === `product:${l.id}`, pulled: matchesVibe(l.title, vibe) };
    }),
    ...visibleSprouts.map((i, index): TreeNode => ({ key: `sprout:${i._id}`, kind: "sprout", title: i.label, byline: i.source === "agent" ? "Agent idea · unconfirmed" : "Preset idea · unconfirmed", detail: "Inspect before publishing", avatar: "dreamer", parentKey: `seed:${i.seedClueId}`, position: treePoint("sprout", index), active: focus === `sprout:${i._id}` })),
  ];

  async function perform(key: string, action: () => Promise<Result<unknown>>, success: string) {
    if (actionLock.current) return false;
    actionLock.current = true;
    setPending(key); setError(null);
    try { const result = await action(); if (!result.ok) { setError(result.error.message); return false; } setNotice(success); return true; }
    catch { setError("This action could not finish. Check the connection and try again."); return false; }
    finally { setPending(null); actionLock.current = false; }
  }
  const reactToGift = (id: string, kind: "owned" | "price") => {
    setArmed(null);
    void perform(`feedback:${id}`, () => setFeedback({ roomId, listingId: id as Id<"productListings">, kind }), kind === "owned" ? "Ownership confirmed for the room. Cached ideas are being rechecked; no new paid search was started." : "Price reaction saved for you. Room budgets and private limits are unchanged.");
  };
  const pick = (key: string) => {
    if (armed && key.startsWith("product:")) { reactToGift(key.slice(8), armed); return; }
    setFocus(key); setError(null);
    const memory = clues.find(c => `seed:${c.id}` === key);
    if (memory) { setDraft(memory.text); setEditBase(memory.text); }
  };
  const choose = (id: string) => {
    setFocus(`product:${id}`);
    void perform("choose", () => me?.role === "organizer" ? select({ roomId, listingId: id as Id<"productListings"> }) : vote({ roomId, listingId: id as Id<"productListings">, value: "up" }), me?.role === "organizer" ? "Gift selected. The live proposal reflects this exact revision." : "Your vote is saved. The organizer confirms the final gift.");
  };
  const growMemory = async (id: Id<"publishedClues">) => {
    if (growing.has(id)) return;
    setGrowing(v => new Set(v).add(id)); setError(null);
    try { const result = await grow({ clueId: id }); if (!result.ok) setError(result.error.message); else setNotice(result.value.grown ? `${result.value.grown} ${result.value.source === "agent" ? "agent" : "preset"} ideas grew. Review them before sharing as facts.` : "No new branches for this memory yet."); }
    catch { setError("The agent couldn't grow this branch. Your memory is still saved."); }
    finally { setGrowing(v => { const n = new Set(v); n.delete(id); return n; }); }
  };
  const onPointer = useCallback((event: MouseEvent<HTMLElement>) => {
    const time = performance.now(); if (time - lastPointer.current < 160) return;
    lastPointer.current = time; const bounds = event.currentTarget.getBoundingClientRect();
    void moveCursor({ roomId, x: Math.round((event.clientX - bounds.left) / bounds.width * 1000), y: Math.round((event.clientY - bounds.top) / bounds.height * 1000), space: "sky" }).catch(() => undefined);
  }, [moveCursor, roomId]);

  if (roomRes && !roomRes.ok) return <MapMessage text={roomRes.error.message} />;
  if (!room || !clueRes || !recsRes || !mapRes || !selectionRes || !proposalRes) return <MapMessage text="Gathering this room’s memories…" />;
  const failed = [clueRes, recsRes, mapRes, selectionRes, proposalRes].find(r => !r.ok);
  if (failed && !failed.ok) return <MapMessage text={failed.error.message} />;
  const cursors = cursorsRes?.ok ? cursorsRes.value.filter(c => c.space === "sky" && now - c.updatedAt < 8000) : [];
  const proposeActions = {
    setLimit: (amountMinor: number) => setLimit({ roomId, amountMinor }),
    approve: (id: string) => approve({ revisionId: id as Id<"proposalRevisions"> }),
    withdrawApproval: (id: string) => withdrawApproval({ revisionId: id as Id<"proposalRevisions"> }),
    clearSelection: () => clearSelection({ roomId }),
  };
  const list = <div className={s.accessibleList} aria-label="All visible islands">{nodes.map(n => <button key={n.key} onClick={() => pick(n.key)}><span>{n.byline}</span><strong>{n.title}</strong><small>{n.detail}</small></button>)}</div>;
  return <main className={s.shell}>
    <header className={s.header}><Link href={`/room/${roomId}`}>← Room</Link><span className={s.wordmark}>unwrap.</span><div><strong>{room.room.recipientDisplayName}’s memory tree</strong><small>{room.room.occasion}</small></div><div className={s.friends}>{participants.slice(0, 5).map(p => <img key={p.id} src={portraitUrl(avatarFor(participants, p.id))} alt={p.displayName} title={p.displayName} />)}</div><span className={s.budget}>{room.room.budgetMinor !== undefined ? `${formatMinor(room.room.budgetMinor)} room budget` : "Room budget not set"}</span><button onClick={onArrange}>Arrange nodes ↗</button></header>
    <div className={s.heading}><div><p className={s.eyebrow}>LITTLE FRIENDS. REAL MEMORIES. THOUGHTFUL GIFTS.</p><h1>Every memory grows a little world.</h1><p>Visit a friend, explore an idea, and choose together.</p></div><button className={s.primary} disabled={busy || researching || !clues.length} onClick={() => void perform("search", () => startResearch({ roomId, publishedClueIds: clues.map(c => c.id as Id<"publishedClues">), idempotencyKey: newRequestKey() }), "Research requested. Products appear when the source returns verified listings.")}>{researching ? "Scout is researching…" : "Find real gifts ↗"}</button></div>
    <div className={s.workspace}>
      <section className={s.world} aria-label="Shared memory tree" onMouseMove={onPointer}>
        <div className={s.worldToolbar}><span>Memories {clues.length ? Math.min(memoryPage * 3 + 1, clues.length) : 0}–{Math.min((memoryPage + 1) * 3, clues.length)} of {clues.length}</span><button disabled={clues.length <= 3} onClick={() => setMemoryPage(v => (v + 1) % Math.ceil(clues.length / 3))}>Next memories ↻</button><span>Gifts {listings.length ? Math.min(productPage * 3 + 1, listings.length) : 0}–{Math.min((productPage + 1) * 3, listings.length)} of {listings.length}</span><button disabled={listings.length <= 3} onClick={() => setProductPage(v => (v + 1) % Math.ceil(listings.length / 3))}>Next gifts ↻</button><button onClick={() => setListView(v => !v)}>{listView ? "Show islands" : "Use list"}</button></div>
        <div className={s.scene}>{!smallScreen && (listView ? list : <ErrorBoundary fallback={list}><Scene nodes={nodes} recipient={room.room.recipientDisplayName} giftTitle={selection?.listingSnapshot.title} giftDetail={selection?.listingSnapshot.priceMinor !== undefined ? `${formatMinor(selection.listingSnapshot.priceMinor)} observed item price · inspect shares` : undefined} approved={approved} reducedMotion={reducedMotion} onPick={pick} onChoose={choose} onConstraint={reactToGift} /></ErrorBoundary>)}</div>
        <div className={s.mobileList}>{list}</div>
        {!clues.length && <div className={s.empty}><h2>A little world starts with a memory.</h2><p>Add a shared note here, or bring conversations and photos into the room.</p><Link href={`/room/${roomId}/phone`}>Share memories from your phone ↗</Link></div>}
        <p className={s.worldHint}>Touch an island to explore · drag the sky to look around · drag a product label to the gift island</p>
        <div className={s.cursorLayer} aria-hidden>{cursors.map(c => <span key={c.participantId} className={s.cursor} style={{ left: `${c.x / 10}%`, top: `${c.y / 10}%` }}>↖ {c.displayName}</span>)}</div>
      </section>
      <aside className={s.inspector} aria-label="Island details">
        {error && <p role="alert" className={s.error}>{error}</p>}
        {clue ? <section><p className={s.eyebrow}>{ownerName(clue.publisherId)}’S MEMORY</p><h2>{clue.text}</h2><p className={s.muted}>Published {clue.sourceKind === "manual" ? "by a friend" : "from reviewed evidence"}. Only its publisher can edit or withdraw it.</p><button className={s.primary} disabled={growing.has(clue.id)} onClick={() => void growMemory(clue.id as Id<"publishedClues">)}>{growing.has(clue.id) ? "Growing…" : "Grow idea branches ↗"}</button>
          {sprouts.filter(i => i.seedClueId === clue.id).map(i => <button className={s.suggestion} key={i._id} onClick={() => pick(`sprout:${i._id}`)}><span>{i.source === "agent" ? "Agent suggestion" : "Preset suggestion"} · not confirmed</span><strong>{i.label}</strong></button>)}
          {clue.publisherId === me?.id && clue.sourceKind === "manual" && <form className={s.form} onSubmit={e => { e.preventDefault(); void perform("edit", () => edit({ clueId: clue.id as Id<"publishedClues">, expectedText: editBase, text: draft }), "Memory updated. Its old suggestions were cleared; cached gifts are rechecked.").then(saved => { if (saved) setEditBase(draft.trim()); }); }}><label htmlFor="edit-tree-memory">Edit your shared memory</label><textarea id="edit-tree-memory" value={draft} onChange={e => setDraft(e.target.value)} maxLength={280} /><button disabled={busy || !draft.trim()}>Save memory</button></form>}
        </section> : product ? <section><p className={s.eyebrow}>FOLLOW THE THREAD</p><ProductCard listing={product} /><p className={s.muted}>{recommendations.find(r => r.listingId === product.id)?.explanation ?? "A friend left feedback on this previously observed option."}</p><ul className={s.evidence}>{recommendations.find(r => r.listingId === product.id)?.publishedClueIds.map(id => <li key={id}>{clues.find(c => c.id === id)?.text}</li>)}</ul>
          <div className={s.actions}><button disabled={busy} onClick={() => reactToGift(product.id, "owned")}>Confirm: already owns this</button><button disabled={busy} onClick={() => reactToGift(product.id, "price")}>Too pricey for me</button><button className={s.primary} disabled={busy || feedback.some(f => f.listing._id === product.id && f.kind === "owned")} onClick={() => choose(product.id)}>{me?.role === "organizer" ? "Put in gift box ↗" : "Vote for this gift ↗"}</button></div><p className={s.small}>Ownership is shared with the room. Price feedback never changes a budget or private contribution limit.</p>
          {feedback.filter(f => f.listing._id === product.id).map(f => <div className={s.reaction} key={f.id}><span>{ownerName(f.participantId)}: {f.kind === "owned" ? "already owns" : "too pricey for me"}</span>{f.participantId === me?.id && <button disabled={busy} onClick={() => void perform("undo", () => undoFeedback({ feedbackId: f.id }), "Your reaction was undone. Other friends’ feedback stays intact.")}>Undo</button>}</div>)}
        </section> : sprout ? <section><p className={s.eyebrow}>{sprout.source === "agent" ? "AGENT IDEA" : "PRESET IDEA"} · NOT A FACT YET</p><h2>{sprout.label}</h2><p>{sprout.clue}</p><label className={s.confirm}><input type="checkbox" checked={confirmIdea} onChange={e => setConfirmIdea(e.target.checked)} />I know this is true about {room.room.recipientDisplayName} and want to share it.</label><button className={s.primary} disabled={busy || !confirmIdea} onClick={() => void perform("plant", () => plant({ sproutId: sprout._id }), "Confirmed and shared as your memory. The room’s cached gifts are being rechecked.")}>Confirm and publish memory</button></section> : <section><p className={s.eyebrow}>ONE GIFT. ONE SHARED YES.</p><h2>{selection ? "A little world, coming together." : "Follow a friend’s memory."}</h2><p className={s.muted}>Pick an island to grow ideas, inspect real product evidence, or review this gift’s shares.</p>{proposal && <ProposalPanel proposal={proposal} participants={participants} me={room.me} selection={selection} isOrganizer={me?.role === "organizer"} actions={proposeActions} />}</section>}
        <section className={s.steering}><p className={s.eyebrow}>GIVE THE TREE A LITTLE DIRECTION</p><div className={s.vibes}>{Object.keys(VIBES).map(word => <button key={word} aria-pressed={vibe === word} onClick={() => setVibe(vibe === word ? null : word)}>{word}</button>)}</div><p className={s.small}>A local visual guide. Nothing is published by moving ideas.</p>{vibe && <button disabled={busy} onClick={() => void perform("vibe", () => addClue({ roomId, kind: "interest", text: `Prefers a ${vibe} gift.` }), "You confirmed and shared this preference with the room.")}>Confirm “{vibe}” as a shared preference</button>}
          <div className={s.actions}>{(["owned", "price"] as const).map(kind => <button key={kind} draggable aria-pressed={armed === kind} onDragStart={e => e.dataTransfer.setData("application/unwrap-constraint", kind)} onClick={() => setArmed(armed === kind ? null : kind)}>{kind === "owned" ? "Already has it ↘" : "Too pricey for me ↘"}</button>)}</div>{armed && <p role="status" className={s.small}>Choose a gift island to apply the reaction.</p>}
        </section>
        <form className={s.form} onSubmit={e => { e.preventDefault(); const form = e.currentTarget; const data = new FormData(form); void perform("memory", () => addClue({ roomId, kind: "interest", text: String(data.get("memory") ?? "") }), "Memory shared with the room.").then(saved => { if (saved) form.reset(); }); }}><label htmlFor="new-tree-memory">A little thing you remember</label><textarea id="new-tree-memory" name="memory" required maxLength={280} placeholder="Something only a friend would know…" /><button disabled={busy}>Share with the room</button></form>
        <details className={s.samples}><summary>Demo tools</summary><p>Clearly labelled fixtures, never live search results.</p><button disabled={busy} onClick={() => void perform("samples", () => seedDemo({ roomId }), "Sample products added. They are labelled fixtures.")}>Load sample gifts</button></details>
      </aside>
    </div>
    <footer className={s.notebook}><img src="/avatars/portraits/calm.png" alt="" /><div><span className={s.eyebrow}>THE COUNCIL’S NOTEBOOK</span><p role="status">{pending ? "Saving your action…" : notice}</p>{recentEvent && <small>{recentEvent}</small>}{job && ["failed", "uncertain"].includes(job.status) && <p className={s.error}>Research {job.status}: {job.lastError ?? "Check the existing provider run before retrying."}</p>}</div><Link href={`/room/${roomId}`}>Review room & shares ↗</Link></footer>
  </main>;
}
