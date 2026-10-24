"use client";

import "@xyflow/react/dist/style.css";
import {
  Background,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useViewport,
  ViewportPortal,
} from "@xyflow/react";
import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { type DragEvent, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SPIRIT_LOOKS } from "@/components/characters/spiritVariants";
import { useSession } from "@/components/providers/ConvexClientProvider";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ClueKind } from "@/lib/contracts";
import { withId } from "@/lib/client";
import { formatMinor } from "@/lib/money";
import { avatarFor } from "@/lib/room/avatars";

/**
 * The shared gift map. Memories are seeds, agents grow idea branches off them,
 * research lands real products with photos and prices, and the gift box sits in
 * the middle. Everything here is real room state; the canvas only adds layout,
 * live cursors, and gestures that call the existing room mutations.
 */

const KIND_EMOJI: Record<ClueKind, string> = { interest: "💛", explicit_wish: "🌠", uncertain: "📸", ownership: "🧺", exclusion: "🚫", timing: "⏰" };
const VIBES: Record<string, string[]> = {
  cozy: ["cozy", "warm", "soft", "knit", "blanket", "tea", "slipper", "candle", "home"],
  handmade: ["hand", "craft", "ceramic", "pottery", "clay", "class", "workshop", "kit", "sculpt", "wheel"],
  outdoorsy: ["hike", "hiking", "trail", "camp", "outdoor", "park", "summit", "mountain"],
  experiences: ["class", "workshop", "session", "lesson", "card", "ticket", "tour"],
  practical: ["tool", "set", "kit", "gear", "bag", "organizer"],
  playful: ["game", "toy", "puzzle", "fun", "glitter"],
};
const BOX_RADIUS = 150;
/** Matches convex/map.ts: a friend who stops moving fades out after this long. */
const CURSOR_TTL_MS = 8_000;

type SeedData = { kind: ClueKind; text: string; color: string; who: string; growing: boolean; onGrow: () => void };
type SproutData = { emoji: string; label: string; clue: string; color: string; onPlant: () => void };
type ProductData = { title: string; price: string; imageUrl?: string; fixture: boolean; dimmed: boolean; pulled: boolean; why: string[] };
type BoxData = { recipient: string; chosen?: { title: string; priceMinor?: number }; budgetMinor?: number; hot: boolean };

function SeedNode({ data }: NodeProps<Node<SeedData>>) {
  return (
    <div className="group relative max-w-[220px] rounded-[18px] bg-[#fff7e6] px-3.5 py-2.5 text-dusk shadow-[0_10px_24px_-14px_rgba(40,24,40,0.7)]" style={{ boxShadow: `0 0 0 3px ${data.color}, 0 10px 24px -14px rgba(40,24,40,0.7)` }}>
      <Handle type="target" position={Position.Top} className="opacity-0!" />
      <Handle type="source" position={Position.Bottom} className="opacity-0!" />
      <p className="text-[10.5px] font-bold tracking-wider uppercase" style={{ color: data.color }}>{KIND_EMOJI[data.kind]} {data.who}</p>
      <p className="text-[13.5px] leading-snug">{data.text}</p>
      <button className="nodrag mt-1.5 rounded-full bg-dusk px-2.5 py-1 text-[11.5px] font-semibold text-paper disabled:opacity-60" disabled={data.growing} onClick={data.onGrow}>
        {data.growing ? "Growing…" : "🌱 Grow ideas"}
      </button>
    </div>
  );
}

function SproutNode({ data }: NodeProps<Node<SproutData>>) {
  return (
    <motion.div initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 16 }}
      title={data.clue} className="flex w-[118px] flex-col items-center gap-1 rounded-[16px] border-2 border-dashed bg-white/85 px-2 py-2 text-center text-dusk" style={{ borderColor: data.color }}>
      <Handle type="target" position={Position.Top} className="opacity-0!" />
      <span className="text-[28px] leading-none">{data.emoji}</span>
      <span className="text-[12px] leading-tight font-semibold">{data.label}</span>
      <button className="nodrag rounded-full bg-gold px-2 py-0.5 text-[11px] font-semibold text-dusk" onClick={data.onPlant}>Plant it</button>
    </motion.div>
  );
}

function ProductNode({ data }: NodeProps<Node<ProductData>>) {
  return (
    <motion.div animate={{ opacity: data.dimmed ? 0.35 : 1, scale: data.pulled ? 1.06 : 1, filter: data.dimmed ? "grayscale(1)" : "grayscale(0)" }}
      className={`w-[150px] overflow-hidden rounded-[16px] bg-[#fffdf8] text-dusk shadow-[0_14px_28px_-14px_rgba(40,24,40,0.75)] ${data.pulled ? "ring-3 ring-gold" : ""}`}>
      <Handle type="source" position={Position.Top} className="opacity-0!" />
      {data.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.imageUrl} alt="" className="h-[84px] w-full object-cover" />
      ) : (
        <div className="grid h-[84px] place-items-center bg-dusk/8 text-[11px] text-dusk/55">no photo from source</div>
      )}
      <div className="px-2.5 py-2">
        <p className="line-clamp-2 text-[12.5px] leading-snug font-semibold">{data.title}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-dusk/70">{data.price}{data.fixture && <span className="rounded bg-coral/15 px-1 text-[10px] text-coral">fixture</span>}</p>
        {data.why.length > 0 && <p className="mt-1 line-clamp-2 text-[10.5px] text-dusk/55">Because: {data.why.join(" · ")}</p>}
      </div>
    </motion.div>
  );
}

function BoxNode({ data }: NodeProps<Node<BoxData>>) {
  const price = data.chosen?.priceMinor;
  const tilt = price !== undefined && data.budgetMinor ? Math.max(-14, Math.min(14, ((price - data.budgetMinor) / data.budgetMinor) * 30)) : 0;
  return (
    <div className={`grid h-[230px] w-[230px] place-items-center rounded-full transition ${data.hot ? "bg-gold/35" : "bg-paper/30"}`}>
      <Handle type="target" position={Position.Top} className="opacity-0!" />
      <div className="flex flex-col items-center gap-1 text-center">
        <span className="text-[72px] leading-none drop-shadow">🎁</span>
        <p className="font-display text-[20px] leading-tight text-dusk">{data.recipient}&rsquo;s gift</p>
        {data.chosen ? (
          <>
            <p className="max-w-[180px] text-[12px] text-dusk/75">{data.chosen.title}</p>
            {data.budgetMinor !== undefined && price !== undefined && (
              <div className="mt-1 flex flex-col items-center">
                <motion.div animate={{ rotate: tilt }} className="h-1.5 w-28 rounded-full" style={{ background: price > data.budgetMinor ? "#ef6f5e" : "#7bb37a" }} />
                <p className="mt-1 text-[11px] text-dusk/65">{formatMinor(price)} of {formatMinor(data.budgetMinor)} budget</p>
              </div>
            )}
          </>
        ) : (
          <p className="text-[12px] text-dusk/60">Drag a gift in here</p>
        )}
      </div>
    </div>
  );
}

const nodeTypes = { seed: SeedNode, sprout: SproutNode, product: ProductNode, box: BoxNode };

/** Deterministic layout: box in the middle, memories on a ring, ideas outside their memory, products between box and the memories they cite. */
function layout(seedIds: string[]) {
  const ring = Math.max(560, seedIds.length * 80);
  const seedPos = new Map<string, { x: number; y: number; a: number }>();
  seedIds.forEach((id, i) => {
    const a = (i / Math.max(1, seedIds.length)) * Math.PI * 2 - Math.PI / 2;
    seedPos.set(id, { x: Math.cos(a) * ring, y: Math.sin(a) * ring, a });
  });
  return { ring, seedPos };
}

export function GiftDiagram({ roomId }: { roomId: string }) {
  const session = useSession();
  if (session.status === "error") return <Centered>We couldn&apos;t connect to Unwrap. <button className="underline" onClick={session.retry}>Try again</button></Centered>;
  if (session.status !== "ready") return <Centered>Opening the map…</Centered>;
  return (
    <ReactFlowProvider>
      <Canvas roomId={roomId as Id<"rooms">} />
    </ReactFlowProvider>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="grid min-h-dvh place-items-center bg-paper text-dusk">{children}</main>;
}

function Canvas({ roomId }: { roomId: Id<"rooms"> }) {
  const flow = useReactFlow();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(t);
  }, []);

  const roomRes = useQuery(api.rooms.getRoom, { roomId });
  const cluesRes = useQuery(api.clues.listPublishedClues, { roomId });
  const recsRes = useQuery(api.research.research.listRecommendations, { roomId });
  const mapRes = useQuery(api.map.getMapState, { roomId });
  const cursorsRes = useQuery(api.map.listCursors, { roomId });
  const selectionRes = useQuery(api.proposals.getSelection, { roomId });
  const activityRes = useQuery(api.agents.buyer.listActivity, { roomId });

  const moveCursor = useMutation(api.map.moveCursor);
  const moveNode = useMutation(api.map.moveNode);
  const plant = useMutation(api.map.plantSprout);
  const addClue = useMutation(api.clues.upsertManualPreference);
  const setFeedback = useMutation(api.map.setFeedback);
  const undoFeedback = useMutation(api.map.undoFeedback);
  const selectGift = useMutation(api.proposals.selectGift);
  const castVote = useMutation(api.votes.castVote);
  const startResearch = useMutation(api.research.research.startResearch);
  const seedDemo = useMutation(api.demo.seedFixturePool);
  const grow = useAction(api.map.growSeed);

  const [growing, setGrowing] = useState<Set<string>>(new Set());
  const [dimmed, setDimmed] = useState<Set<string>>(new Set());
  const [vibe, setVibe] = useState<{ word: string; x: number; y: number } | null>(null);
  const [hotBox, setHotBox] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; text: string; tone?: "error" }[]>([]);
  const say = useCallback((text: string, tone?: "error") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const room = roomRes?.ok ? roomRes.value : null;
  const participants = room?.participants ?? [];
  const colorOf = useCallback((participantId?: string) => SPIRIT_LOOKS[avatarFor(participants, participantId ?? "")].cloak, [participants]);
  const nameOf = useCallback((participantId?: string) => participants.find((p) => p.id === participantId)?.displayName ?? "a friend", [participants]);

  const clues = useMemo(() => (cluesRes?.ok ? cluesRes.value.filter((c) => c.status === "active").sort((a, b) => a.publishedAt - b.publishedAt).map(withId) : []), [cluesRes]);
  const recs = recsRes?.ok ? recsRes.value : { recommendations: [], listings: [] };
  const map = mapRes?.ok ? mapRes.value : { positions: [], sprouts: [], feedback: [] };
  const saved = useMemo(() => new Map(map.positions.map((p) => [p.nodeKey, p])), [map.positions]);
  const selection = selectionRes?.ok ? selectionRes.value : null;

  // Seed the toast feed with the agents' real "Dropped … because …" trace as it arrives.
  const seenEvents = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!activityRes?.ok) return;
    const events = activityRes.value.events;
    if (seenEvents.current === null) {
      seenEvents.current = new Set(events.map((e) => e.id));
      return;
    }
    for (const e of events) {
      if (seenEvents.current.has(e.id)) continue;
      seenEvents.current.add(e.id);
      if (e.summary.startsWith("Dropped") || e.kind === "failed" || e.kind === "handoff") say(e.summary, e.kind === "failed" ? "error" : undefined);
    }
  }, [activityRes, say]);

  const { nodes, edges } = useMemo(() => {
    const { seedPos } = layout(clues.map((c) => c.id));
    const at = (key: string, fallback: { x: number; y: number }) => {
      const p = saved.get(key);
      return p ? { x: p.x, y: p.y } : fallback;
    };
    const ns: Node[] = [];
    const es: Edge[] = [];
    ns.push({
      id: "box:main", type: "box", position: at("box:main", { x: -115, y: -115 }), draggable: false,
      data: { recipient: room?.room.recipientDisplayName ?? "", budgetMinor: room?.room.budgetMinor, hot: hotBox, chosen: selection ? { title: selection.listingSnapshot.title, priceMinor: selection.listingSnapshot.priceMinor } : undefined } satisfies BoxData,
    });
    for (const c of clues) {
      const p = seedPos.get(c.id)!;
      ns.push({
        id: `seed:${c.id}`, type: "seed", position: at(`seed:${c.id}`, { x: p.x - 100, y: p.y - 40 }),
        data: {
          kind: c.kind, text: c.text, color: colorOf(c.publisherId), who: nameOf(c.publisherId), growing: growing.has(c.id),
          onGrow: async () => {
            setGrowing((s) => new Set(s).add(c.id));
            const res = await grow({ clueId: c.id as Id<"publishedClues"> }).catch(() => null);
            setGrowing((s) => { const n = new Set(s); n.delete(c.id); return n; });
            if (!res || !res.ok) say(res?.ok === false ? res.error.message : "The agent couldn't grow ideas just now.", "error");
            else say(res.value.grown ? `Scout grew ${res.value.grown} ideas off “${c.text.slice(0, 40)}”` : "No new ideas for that one yet.");
          },
        } satisfies SeedData,
      });
    }
    const sproutsBySeed = new Map<string, typeof map.sprouts>();
    for (const s of map.sprouts) sproutsBySeed.set(s.seedClueId, [...(sproutsBySeed.get(s.seedClueId) ?? []), s]);
    for (const [seedId, list] of sproutsBySeed) {
      const p = seedPos.get(seedId);
      if (!p) continue;
      const color = colorOf(clues.find((c) => c.id === seedId)?.publisherId);
      list.forEach((s, i) => {
        const spread = (i - (list.length - 1) / 2) * 0.32;
        const a = p.a + spread;
        const r = Math.hypot(p.x, p.y) + 210 + (i % 2) * 60;
        ns.push({
          id: `sprout:${s._id}`, type: "sprout", position: at(`sprout:${s._id}`, { x: Math.cos(a) * r - 59, y: Math.sin(a) * r - 45 }),
          data: {
            emoji: s.emoji, label: s.label, clue: s.clue, color,
            onPlant: async () => {
              const res = await plant({ sproutId: s._id }).catch(() => null);
              if (!res || !res.ok) say(res?.ok === false ? res.error.message : "Couldn't plant that idea.", "error");
              else say(`Planted “${s.label}”. It's a memory now.`);
            },
          } satisfies SproutData,
        });
        es.push({ id: `e-sprout:${s._id}`, source: `seed:${seedId}`, target: `sprout:${s._id}`, style: { stroke: color, strokeDasharray: "5 5", strokeWidth: 1.5 } });
      });
    }
    const vibeWords = vibe ? VIBES[vibe.word] ?? [vibe.word] : [];
    const shown = recs.recommendations.filter((r) => recs.listings.some((x) => x.id === r.listingId));
    shown.forEach((r, i) => {
      const l = recs.listings.find((x) => x.id === r.listingId)!;
      // Products sit on their own ring around the box, turned toward the memory they cite most.
      const anchor = seedPos.get(r.publishedClueIds[0] ?? "");
      const a = (i / Math.max(1, shown.length)) * Math.PI * 2 + (anchor ? Math.atan2(anchor.y, anchor.x) * 0.15 : 0);
      const pr = 300 + (i % 2) * 40;
      const base = { x: Math.cos(a) * pr - 75, y: Math.sin(a) * pr - 75 };
      const text = l.title.toLowerCase();
      const pulled = !!vibe && vibeWords.some((w) => text.includes(w));
      // Vibe pull: matching products move toward the vibe word, others drift outward. Layout only.
      const pos = vibe ? (pulled ? { x: base.x + (vibe.x - base.x) * 0.6, y: base.y + (vibe.y - base.y) * 0.6 } : { x: base.x * 1.35, y: base.y * 1.35 }) : at(`product:${l.id}`, base);
      ns.push({
        id: `product:${l.id}`, type: "product", position: pos,
        data: {
          title: l.title, imageUrl: l.imageUrl, fixture: l.source === "manual_fixture", dimmed: dimmed.has(l.id), pulled,
          price: l.priceStatus === "observed" && l.priceMinor !== undefined ? formatMinor(l.priceMinor) : "Price unknown",
          why: r.publishedClueIds.map((id) => clues.find((c) => c.id === id)?.text).filter((t): t is string => !!t).map((t) => t.slice(0, 28)),
        } satisfies ProductData,
      });
      for (const cid of r.publishedClueIds.slice(0, 2)) es.push({ id: `e-${l.id}-${cid}`, source: `product:${l.id}`, target: `seed:${cid}`, style: { stroke: "#d9b66f", strokeWidth: 1.4, opacity: 0.8 } });
    });
    return { nodes: ns, edges: es };
  }, [clues, saved, map.sprouts, recs, room, selection, hotBox, growing, dimmed, vibe, colorOf, nameOf, grow, plant, say]);

  // React Flow owns in-flight drags and measurements; room state replaces everything else.
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const dragging = useRef<string | null>(null);
  useEffect(() => {
    setRfNodes((prev) => nodes.map((n) => {
      const old = prev.find((p) => p.id === n.id);
      if (!old) return n;
      return { ...old, ...n, position: dragging.current === n.id ? old.position : n.position, measured: old.measured };
    }));
  }, [nodes, setRfNodes]);

  // Re-frame the map when memories or gifts arrive, not on every small change.
  const shape = `${clues.length}:${recs.recommendations.length}:${map.sprouts.length > 0}`;
  useEffect(() => {
    const t = setTimeout(() => void flow.fitView({ padding: 0.12, duration: 600 }), 250);
    return () => clearTimeout(t);
  }, [shape, flow]);

  // Live cursors: send our position at most ~8 times a second.
  const lastSent = useRef(0);
  const onMove = useCallback((e: MouseEvent) => {
    const t = performance.now();
    if (t - lastSent.current < 120) return;
    lastSent.current = t;
    const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    void moveCursor({ roomId, x: Math.round(p.x), y: Math.round(p.y) }).catch(() => undefined);
  }, [flow, moveCursor, roomId]);

  const nearBox = (p: { x: number; y: number }) => Math.hypot(p.x, p.y) < BOX_RADIUS;
  const isOrganizer = room?.me.role === "organizer";

  const onNodeDrag = useCallback((_: unknown, node: Node) => {
    dragging.current = node.id;
    if (node.type === "product") setHotBox(nearBox({ x: node.position.x + 75, y: node.position.y + 70 }));
  }, []);
  const onNodeDragStop = useCallback(async (_: unknown, node: Node) => {
    dragging.current = null;
    setHotBox(false);
    const center = { x: node.position.x + 75, y: node.position.y + 70 };
    if (node.type === "product" && nearBox(center)) {
      const listingId = node.id.slice("product:".length) as Id<"productListings">;
      const title = (node.data as ProductData).title;
      if (isOrganizer) {
        const res = await selectGift({ roomId, listingId }).catch(() => null);
        say(res?.ok ? `“${title}” is in the box. Friends can approve the shares now.` : (res?.ok === false ? res.error.message : "Couldn't put that in the box."), res?.ok ? undefined : "error");
      } else {
        const res = await castVote({ roomId, listingId, value: "up" }).catch(() => null);
        say(res?.ok ? `You voted for “${title}”. The organizer puts the final gift in the box.` : "Couldn't record that vote.", res?.ok ? undefined : "error");
      }
      return;
    }
    void moveNode({ roomId, nodeKey: node.id, x: Math.round(node.position.x), y: Math.round(node.position.y) }).catch(() => say("Could not save that position.", "error"));
  }, [isOrganizer, moveNode, roomId, say, selectGift, castVote]);

  // Cards and vibe words are dragged from the tray onto the canvas.
  const onDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/unwrap");
    if (!raw) return;
    let item: { type: "card"; card: "has" | "pricey" } | { type: "vibe"; word: string };
    try { item = JSON.parse(raw); } catch { return; }
    if (!item || (item.type !== "vibe" && item.type !== "card")) return;
    const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    if (item.type === "vibe") {
      setVibe({ word: item.word, x: p.x, y: p.y });
      say(`Showing a ${item.word} direction. Layout only; no preference was published.`);
      return;
    }
    const target = flow.getNodes().filter((n) => n.type === "product").find((n) => {
      const w = n.measured?.width ?? 150;
      const h = n.measured?.height ?? 150;
      return p.x >= n.position.x - 20 && p.x <= n.position.x + w + 20 && p.y >= n.position.y - 20 && p.y <= n.position.y + h + 20;
    });
    if (!target) return say("Drop the card right on a gift.", "error");
    const listingId = target.id.slice("product:".length);
    const title = (target.data as ProductData).title;
    setDimmed((s) => new Set(s).add(listingId));
    const res = await setFeedback({ roomId, listingId: listingId as Id<"productListings">, kind: item.card === "has" ? "owned" : "price" }).catch(() => null);
    if (!res?.ok) {
      setDimmed((s) => { const n = new Set(s); n.delete(listingId); return n; });
      return say(res?.ok === false ? res.error.message : "Couldn't add that card.", "error");
    }
    say(item.card === "has" ? `Keeper: noted, they already have “${title}”. Looking at what's left…` : `Keeper: “${title}” is too pricey. Looking at what's left…`);
  }, [flow, setFeedback, roomId, say]);

  const findGifts = async () => {
    const res = await startResearch({ roomId, publishedClueIds: clues.map((c) => c.id as Id<"publishedClues">), idempotencyKey: `map-${Date.now()}` }).catch(() => null);
    say(res?.ok ? "Scout went looking for real gifts. They'll land on the map." : (res?.ok === false ? res.error.message : "Couldn't start the search."), res?.ok ? undefined : "error");
  };
  const loadSamples = async () => {
    const res = await seedDemo({ roomId }).catch(() => null);
    say(res?.ok ? `Added ${res.value.listings} sample gifts (marked “fixture”).` : (res?.ok === false ? res.error.message : "Couldn't add samples."), res?.ok ? undefined : "error");
  };

  if (roomRes && !roomRes.ok) return <Centered>{roomRes.error.message} <Link className="ml-2 underline" href="/">Back to Unwrap</Link></Centered>;
  if (!room) return <Centered>Opening the map…</Centered>;
  const cursors = cursorsRes?.ok ? cursorsRes.value.filter((c) => c.space === "diagram" && now - c.updatedAt < CURSOR_TTL_MS) : [];

  return (
    <main className="fixed inset-0 bg-[radial-gradient(circle_at_50%_45%,#fbf3e2,#efe2cc_70%,#e4d3b8)] text-dusk" onMouseMove={onMove}>
      <ReactFlow nodes={rfNodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onNodeDrag={onNodeDrag} onNodeDragStop={onNodeDragStop}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }} onDrop={onDrop}
        fitView fitViewOptions={{ padding: 0.25 }} minZoom={0.25} maxZoom={1.8} proOptions={{ hideAttribution: true }}>
        <Background color="#c9b391" gap={28} size={1.4} />
        <ViewportPortal>
          {vibe && (
            <div className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold/90 px-4 py-2 font-display text-[22px] text-dusk shadow-lg" style={{ left: vibe.x, top: vibe.y }}>✨ {vibe.word}</div>
          )}
        </ViewportPortal>
      </ReactFlow>
      <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
        {cursors.map((c) => <Cursor key={c.participantId} x={c.x} y={c.y} name={c.displayName} color={colorOf(c.participantId)} />)}
      </div>

      {/* Header */}
      <div className="pointer-events-auto absolute top-4 left-4 flex items-center gap-3 rounded-[18px] bg-paper/95 px-4 py-2.5 shadow-md">
        <Link href={`/room/${roomId}`} className="text-[13px] text-dusk/60 hover:text-dusk">← Room</Link>
        <span className="h-6 w-px bg-dusk/15" />
        <p className="font-display text-[20px] leading-none">Gift map for {room.room.recipientDisplayName}</p>
        <span className="flex -space-x-1.5">
          {participants.map((p) => <span key={p.id} title={p.displayName} className="h-6 w-6 rounded-full border-2 border-paper" style={{ background: colorOf(p.id) }} />)}
        </span>
      </div>
      <div className="pointer-events-auto absolute top-4 right-4 flex gap-2">
        <button className="rounded-full bg-dusk px-4 py-2 text-[13.5px] font-semibold text-paper shadow disabled:opacity-50" disabled={!clues.length} onClick={findGifts}>🔎 Find real gifts</button>
        <button className="rounded-full bg-paper/95 px-4 py-2 text-[13.5px] shadow" onClick={loadSamples}>Load sample gifts</button>
      </div>

      {/* Tray: constraint cards and vibe words */}
      <aside className="pointer-events-auto absolute bottom-4 left-4 flex w-[250px] flex-col gap-3 rounded-[20px] bg-paper/95 p-3.5 shadow-lg">
        <p className="text-[11px] font-bold tracking-wider text-dusk/55 uppercase">Drag onto a gift</p>
        <div className="flex gap-2">
          <TrayItem payload={{ type: "card", card: "has" }} className="bg-[#e6f0e2]">🧺 Already has it</TrayItem>
          <TrayItem payload={{ type: "card", card: "pricey" }} className="bg-[#fbe2dc]">💸 Too pricey</TrayItem>
        </div>
        <p className="text-[11px] font-bold tracking-wider text-dusk/55 uppercase">Drop a vibe on the map</p>
        <div className="flex flex-wrap gap-1.5">
          {Object.keys(VIBES).map((w) => <TrayItem key={w} payload={{ type: "vibe", word: w }} className={vibe?.word === w ? "bg-gold" : "bg-white"}>{w}</TrayItem>)}
          {vibe && <button className="text-[12px] text-dusk/60 underline" onClick={() => setVibe(null)}>clear</button>}
        </div>
        <p className="text-[11px] leading-snug text-dusk/55">Tap 🌱 on a memory to grow ideas. Drag a gift into the box{isOrganizer ? " to choose it" : " to vote for it"}.</p>
        {map.feedback.filter(f => f.participantId === room.me.id).slice(0, 3).map(f => <button key={f.id} className="text-left text-xs underline" onClick={async () => { const result = await undoFeedback({ feedbackId: f.id }); if (result.ok) { setDimmed(old => { const next = new Set(old); next.delete(f.listing._id); return next; }); say("Your reaction was undone."); } else say(result.error.message, "error"); }}>Undo {f.kind === "owned" ? "ownership" : "price reaction"}: {f.listing.title.slice(0, 25)}</button>)}
      </aside>

      {/* Agent feed */}
      <div className="pointer-events-none absolute right-4 bottom-4 flex w-[340px] flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.p key={t.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
              className={`rounded-2xl px-3.5 py-2 text-[13px] shadow-md ${t.tone === "error" ? "bg-[#fbe2dc] text-[#8c3b2c]" : "bg-paper/95"}`}>{t.text}</motion.p>
          ))}
        </AnimatePresence>
      </div>

      {!clues.length && (
        <div className="pointer-events-auto absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-[140px] rounded-2xl bg-paper/95 px-4 py-3 text-center text-[14px] shadow">
          No memories yet. Add a few in the <Link className="underline" href={`/room/${roomId}`}>tower</Link> and they appear here as seeds.
        </div>
      )}
    </main>
  );
}

function TrayItem({ payload, className, children }: { payload: object; className: string; children: React.ReactNode }) {
  return (
    <span draggable onDragStart={(e) => { e.dataTransfer.setData("application/unwrap", JSON.stringify(payload)); e.dataTransfer.effectAllowed = "move"; }}
      className={`cursor-grab rounded-full px-3 py-1.5 text-[12.5px] font-semibold shadow-sm select-none active:cursor-grabbing ${className}`}>
      {children}
    </span>
  );
}

/** Another friend's pointer, drawn in screen space above the cards so it is never hidden. */
function Cursor({ x, y, name, color }: { x: number; y: number; name: string; color: string }) {
  const viewport = useViewport();
  const sx = x * viewport.zoom + viewport.x;
  const sy = y * viewport.zoom + viewport.y;
  return (
    <motion.div className="absolute top-0 left-0" animate={{ x: sx, y: sy }} transition={{ type: "spring", stiffness: 350, damping: 32 }}>
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden><path d="M3 2l7 19 2.5-7.5L20 11z" fill={color} stroke="#fff" strokeWidth="1.5" /></svg>
      <span className="absolute top-4 left-4 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white shadow" style={{ background: color }}>{name}</span>
    </motion.div>
  );
}
