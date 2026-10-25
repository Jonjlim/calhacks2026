"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { fanOut } from "@/components/world/room/GiftRings";
import { mapView } from "@/components/world/room/mapView";
import { guideMemories, initialGuideStep, sharedGuideTheme, CONNECT_HOLD_MS, MOSS_QUESTIONS, mossWritingCue, type GuideStep } from "@/lib/room/guide";
import { avatarFor, portraitUrl } from "@/lib/room/avatars";
import { matchCaption, nudgeLine, type MossNudgeView } from "@/lib/room/mossRecall";
import { callContextText } from "@/lib/room/mossVoice";
import type { RoomActions, RoomData } from "./types";
import { useMossNarrator } from "./useMossNarrator";
import { useMossVoice, type MossLine } from "./useMossVoice";
import type { useGiftRings } from "./useGiftRings";
import s from "./room-guide.module.css";

const LIVE_CUE_MS = 4500;

/** Local guidance observes Convex state; it never publishes, votes, selects or approves for a member. */
export function useRoomGuide({ data, map, enabled, paused, nudge, warm, sound = false }: {
  data: RoomData; map: ReturnType<typeof useGiftRings>; enabled: boolean; paused: boolean;
  /** Room sound is on: Moss may read her lines aloud (browser voice) when no call is live. */
  sound?: boolean;
  /** Moss recall (MAP-024). Optional: without it the nudge keeps its written prompts. */
  nudge?: RoomActions["mossNudge"]; warm?: RoomActions["mossWarm"];
}) {
  const { room, me, participants } = data.view;
  const key = `unwrap:room-guide:v2:${room.id}:${me.id}`;
  const reduced = useReducedMotion() ?? false;
  const [step, setStep] = useState<GuideStep | null>(null);
  const [ready, setReady] = useState(false);
  const [peerId, setPeerId] = useState<string | null>(null);
  const [liveCue, setLiveCue] = useState(false);
  const [question, setQuestion] = useState(0);
  const [helped, setHelped] = useState(false);
  const [bornMemoryId, setBornMemoryId] = useState<string | null>(null);
  // What Moss recalled for the current question; shown to this member only, never saved.
  const [recall, setRecall] = useState<{ question: number; state: "loading" | "done"; view: MossNudgeView | null } | null>(null);
  const warmed = useRef(false);
  const known = useRef(new Set<string>());
  const latest = useRef({ data, map });
  latest.current = { data, map };
  const memories = guideMemories(data.publishedClues);
  const own = memories.filter((c) => c.publisherId === me.id);
  const ownMemory = own.find((c) => c.id === bornMemoryId) ?? own[0];
  const ownKey = ownMemory ? `clue:${ownMemory.id}` : null;
  const peer = memories.find((c) => c.id === peerId);
  const shared = peer ? sharedGuideTheme(new Set(own.map((c) => c.id)), peer.id, data.mapThemes ?? []) : null;
  const peerName = participants.find((p) => p.id === peer?.publisherId)?.displayName ?? "A friend";
  const composing = !!map.rings?.composer;
  const currentQuestion = MOSS_QUESTIONS[question] ?? MOSS_QUESTIONS[0];

  function remember(value: "started" | "done") {
    try { localStorage.setItem(key, value); } catch { /* Guidance works with storage disabled. */ }
  }
  function seatOf(nodeKey: string) {
    const rings = latest.current.map.rings;
    const clue = rings?.clues.find((c) => c.key === nodeKey);
    const theme = clue ? rings?.themes.find((t) => t.theme === clue.theme) : undefined;
    const seat = rings && theme && clue ? fanOut(theme, rings.clues.filter((c) => c.theme === clue.theme).map((c) => c.key)).get(clue.key) : null;
    return seat ?? (clue ? [clue.x, clue.z] as const : null);
  }
  function canMoveCamera() {
    return !paused && !latest.current.map.rings?.composer && !mapView.locked && !mapView.dragging;
  }
  function finish() {
    remember("done");
    setStep(null);
    setLiveCue(false);
    // Never close a draft or change room state when guidance is dismissed.
    if (step && !composing && !mapView.locked) mapView.reset(reduced);
  }
  function begin(mode: "text" | "photo", prompt?: string, help = false) {
    remember("started");
    map.beginMemory(mode, prompt);
    setHelped(help);
    setStep(help ? "help" : "compose");
    if (help) mapView.focus(0, 0, 1.1, { yaw: -0.28, pitch: 0.1 });
    else approachSeed();
  }
  function approachSeed() {
    mapView.focus(latest.current.map.rings?.composer?.x ?? 12, latest.current.map.rings?.composer?.z ?? 11, 0.3, { yaw: -0.55, pitch: -0.5 });
  }
  /** Frame both memories (and their theme, when the council has formed one) in one shot. */
  function frameConnection() {
    if (!canMoveCamera() || !peer) return;
    const a = ownKey ? seatOf(ownKey) : null, b = seatOf(`clue:${peer.id}`);
    const theme = shared ? latest.current.map.rings?.themes.find((t) => t.key === `theme:${shared.id}` || t.theme === shared.label) : undefined;
    const points = [a, b, theme ? [theme.x, theme.z] as const : null].filter((p): p is readonly [number, number] => !!p);
    if (!points.length) return;
    const x = points.reduce((n, p) => n + p[0], 0) / points.length, z = points.reduce((n, p) => n + p[1], 0) / points.length;
    const span = Math.max(...points.map((p) => Math.hypot(p[0] - x, p[1] - z)));
    if (shared) latest.current.map.showConnection(shared.id);
    mapView.focus(x, z, Math.min(1.1, 0.75 + span * 0.04), { yaw: 0.12, pitch: -0.1 });
  }

  useEffect(() => {
    if (!enabled) return;
    const snapshot = latest.current.data;
    const visible = guideMemories(snapshot.publishedClues);
    known.current = new Set(visible.map((c) => c.id));
    let saved: string | null = null;
    try { saved = localStorage.getItem(key); } catch { /* Optional presentation storage. */ }
    const first = initialGuideStep(saved, visible.some((c) => c.publisherId === snapshot.view.me.id));
    setStep(first === "welcome" ? "arrival" : first);
    setPeerId(null);
    setLiveCue(false);
    setReady(true);
    return () => { setReady(false); if (!mapView.locked && !mapView.dragging) mapView.reset(); };
  }, [enabled, key]);

  // Load Moss's model once while the guide is on screen, so the first nudge is quick.
  useEffect(() => {
    if (!enabled || !ready || !warm || warmed.current) return;
    warmed.current = true;
    void warm().catch(() => undefined);
  }, [enabled, ready, warm]);

  // "I don't know": Moss searches friends' published memories for the chosen question.
  useEffect(() => {
    if (step !== "help" || !nudge) return;
    let live = true;
    setRecall({ question, state: "loading", view: null });
    nudge(question)
      .then((r) => { if (live) setRecall({ question, state: "done", view: r.ok ? r.value : null }); })
      .catch(() => { if (live) setRecall({ question, state: "done", view: null }); });
    return () => { live = false; };
  }, [step, question, nudge, data.publishedClues.length]);

  // Only the subscription confirming a published memory advances guidance; a failed save keeps the composer open.
  useEffect(() => {
    if (!ready || !enabled) return;
    const visible = guideMemories(data.publishedClues);
    const additions = visible.filter((c) => !known.current.has(c.id));
    for (const c of visible) known.current.add(c.id);
    const mine = additions.find((c) => c.publisherId === me.id);
    if (mine && (step === "arrival" || step === "welcome" || step === "compose" || step === "help")) {
      remember("started");
      setBornMemoryId(mine.id);
      setStep("saved");
    }
    const friend = additions.find((c) => c.publisherId !== me.id);
    if (friend && !peerId && step !== "connect") setPeerId(friend.id);
  }, [data.publishedClues, enabled, ready, me.id, step, peerId]);

  // Arrival is an authored establishing shot, pull-back, then an approach to the first island.
  useEffect(() => {
    if (!ready || !enabled || paused || step !== "arrival") return;
    if (reduced) { setStep("welcome"); approachSeed(); return; }
    const interaction = mapView.interaction;
    mapView.focus(0, 0, 0.33, { yaw: 0.5, pitch: -0.45 });
    const wide = setTimeout(() => {
      if (mapView.interaction === interaction && !mapView.locked) mapView.focus(0, 0, 1.17, { yaw: -0.28, pitch: 0.1 });
    }, 650);
    const approach = setTimeout(() => {
      if (mapView.interaction === interaction && !mapView.locked && !mapView.dragging) approachSeed();
      setStep("welcome");
    }, 2450);
    return () => { clearTimeout(wide); clearTimeout(approach); };
  }, [ready, enabled, paused, step, reduced]);

  // Celebrate the published island, then hand the shared map back. The room keeps running from here.
  useEffect(() => {
    if (step !== "saved" || composing || paused || !ownKey) return;
    const seat = seatOf(ownKey);
    if (seat && canMoveCamera()) mapView.focus(seat[0], seat[1], 0.55, { yaw: 0.18 });
    const interaction = mapView.interaction;
    const timer = setTimeout(() => {
      if (interaction === mapView.interaction && !mapView.locked && !mapView.dragging) mapView.reset(reduced);
      setStep("live");
      setLiveCue(true);
    }, reduced ? 0 : 2200);
    return () => clearTimeout(timer);
  }, [step, composing, paused, ownKey, reduced]);

  useEffect(() => {
    if (!liveCue) return;
    const timer = setTimeout(() => setLiveCue(false), LIVE_CUE_MS);
    return () => clearTimeout(timer);
  }, [liveCue]);

  // The one pause: a friend's memory lands. It waits behind drafts, drawers and the reveal.
  useEffect(() => {
    if (step !== "live" || !peer || paused || composing || mapView.locked) return;
    setLiveCue(false);
    setStep("connect");
  }, [step, peer?.id, paused, composing]);

  useEffect(() => {
    if (step !== "connect" || paused) return;
    frameConnection();
    const timer = setTimeout(finish, reduced ? CONNECT_HOLD_MS * 1.5 : CONNECT_HOLD_MS);
    return () => clearTimeout(timer);
  }, [step, paused, shared?.id]);

  // Moss stands still beside the island being explained; draft text never enters this model.
  useEffect(() => {
    const live = step === "live" || step === "connect";
    if (!ready || !enabled || paused || !step || (step === "live" && !liveCue)) { map.setGuideScene(null); return; }
    const seed = !live && step !== "saved";
    const at = step === "connect" && peer ? seatOf(`clue:${peer.id}`) : ownKey ? seatOf(ownKey) : null;
    map.setGuideScene({ x: seed ? 12 : at?.[0] ?? 0, z: seed ? 11 : at?.[1] ?? 0, seed, avatar: avatarFor(participants, me.id),
      mode: step === "help" ? "thinking" : step === "compose" ? "writing" : step === "welcome" ? "welcome" : "exploring" });
    return () => map.setGuideScene(null);
  }, [ready, enabled, paused, step, liveCue, ownKey, peer?.id, map.setGuideScene, me.id]);

  const seedStep = !!step && ["arrival", "welcome", "help", "compose", "saved"].includes(step);
  const visible = ready && enabled && !paused && (
    (seedStep && (!composing || step === "compose" || step === "help")) || step === "connect" || (step === "live" && liveCue));
  const cinematic = visible && (seedStep || step === "connect");
  // Moss voice (MAP-026): a live call with the hosted Moss agent, only from an explicit tap.
  const call = useMossVoice({
    roomId: room.id,
    active: ready && enabled && !paused && visible,
    contextText: () => callContextText({
      recipient: room.recipientDisplayName,
      me: me.displayName || "a friend",
      memories: guideMemories(latest.current.data.publishedClues).map((c) => ({ author: participants.find((p) => p.id === c.publisherId)?.displayName ?? "A friend", text: c.text })).reverse(),
    }),
  });
  useMossNarrator(sound && !call.live, room.id);
  function talk() {
    if (!composing) begin("text");
    void call.start();
  }
  function useWords() {
    if (!call.myWords) return;
    map.fillDraft(call.myWords);
    if (step !== "compose" && step !== "help") setStep("compose");
  }
  const callPanel = call.state !== "idle" && <MossCall call={call} onUse={useWords} recipient={room.recipientDisplayName} />;
  const editor = (step === "compose" || step === "help") && composing ? map.rings?.composer?.node : null;
  let title = "Start with a little thing.";
  let text = `This little island is yours. Let’s give it a memory of ${room.recipientDisplayName}.`;
  let controls = <div className={s.choices}>
    <button onClick={() => begin("text")}><span>01</span><b>Type a thought<small>A hobby, a wish, a little habit</small></b><i>↗</i></button>
    <button onClick={() => begin("photo")}><span>02</span><b>Drop a photo<small>Find the clues in a real moment</small></b><i>↗</i></button>
    <button onClick={() => begin("text", currentQuestion.prompt, true)}><span>03</span><b>I don’t know<small>Moss, give me a little nudge</small></b><i>↗</i></button>
    {call.available && <button onClick={talk} className={s.talkChoice}><span>04</span><b>Talk to Moss<small>Say it out loud, she’ll help you find the words</small></b><i>↗</i></button>}
  </div>;
  if (step === "arrival") {
    title = `Welcome to ${room.recipientDisplayName}’s world.`;
    text = "Let’s find one little thing that makes them, them.";
    controls = <></>;
  } else if (step === "help") {
    title = currentQuestion.title;
    const recalled = recall?.question === question && recall.state === "done" ? recall.view : null;
    text = map.draftLength ? mossWritingCue(map.draftLength, true)
      : recalled ? nudgeLine(recalled)
      : "Nothing coming to mind? Let’s take a step back. Think of a real moment together.";
    controls = <><div className={s.questionTabs}>{MOSS_QUESTIONS.map((q, i) => <button key={q.label} aria-pressed={question === i} onClick={() => { setQuestion(i); map.beginMemory("text", q.prompt); }}>{q.label}</button>)}</div>
      {call.available && !call.live && <button onClick={talk}>Talk it through with Moss</button>}
      <button onClick={() => { setStep("compose"); approachSeed(); }}>Bring me back to my island ↗</button></>;
  } else if (step === "compose") {
    title = helped ? currentQuestion.title : "What comes to mind?";
    text = map.rings?.composer?.photo ? "A photo can hold a little story. You’ll review its clues before publishing them." : mossWritingCue(map.draftLength, helped);
    controls = composing ? <><button onClick={() => { setHelped(true); map.beginMemory("text", currentQuestion.prompt); setStep("help"); mapView.focus(0, 0, 1.1, { yaw: -0.28, pitch: 0.1 }); }}>Moss, I’m a little stuck</button>{call.available && !call.live && <button onClick={talk}>Talk to Moss</button>}</> : <><button onClick={() => begin("text")}>Write a memory</button><button onClick={() => begin("photo")}>Add a photo</button></>;
  } else if (step === "saved") {
    title = "A little memory. A new possibility.";
    text = "There it is. Your memory has a place in this world.";
    controls = <></>;
  } else if (step === "live") {
    title = "";
    text = "You’re in. Keep exploring. I’ll step in when a friend adds something.";
    controls = <></>;
  } else if (step === "connect") {
    title = `${peerName} just added a memory`;
    text = shared
      ? `It connects to yours through “${shared.label}”. Connected memories grow themes, and every theme opens up more real gifts.`
      : "Every memory can connect. When the council finds what yours share, they branch into a theme, and each theme opens up more real gifts.";
    controls = <><button onClick={finish}>Keep going</button>{shared && <button onClick={frameConnection}>Show the connection</button>}</>;
  }

  // One semantic cue per visible change. A narrator can cancel when a drawer/reveal takes over.
  useEffect(() => {
    // Typing feedback changes as someone writes; a narrator reads the step's first line, not each nudge mid-sentence.
    const typing = (step === "compose" || step === "help") && map.draftLength > 0;
    window.dispatchEvent(new CustomEvent("unwrap:room-guide", { detail: { roomId: room.id, step, peerId: peer?.id ?? null, title, text, active: visible, typing } }));
    return () => { window.dispatchEvent(new CustomEvent("unwrap:room-guide", { detail: { roomId: room.id, step: null, peerId: null, title: "", text: "", active: false } })); };
  }, [step, peer?.id, visible, room.id, title, text]);

  const meAvatar = avatarFor(participants, me.id), peerAvatar = peer ? avatarFor(participants, peer.publisherId) : meAvatar;
  return {
    visible,
    restart: () => { remember("started"); setPeerId(null); setStep(composing ? "compose" : "arrival"); if (!composing) mapView.reset(reduced); },
    cinematic,
    panel: <AnimatePresence>{visible && <motion.div key="room-guide" className={`${s.shell} ${cinematic ? s.cinematic : ""} ${step === "connect" ? s.held : ""}`}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.35 }}>
      <div className={s.vignette} aria-hidden />
      {seedStep && <div className={s.rail}><span>WITH MOSS <i /> YOUR FIRST MEMORY</span><button onClick={finish}>Explore on my own ↗</button></div>}
      {step === "connect" && <div className={s.heldPill} role="status"><i />Moss paused the room for a moment</div>}
      {step !== "arrival" && step !== "live" && step !== "saved" && <motion.section aria-label="Moss room guide" className={`${s.guide} ${s.stageCard}`}
        initial={{ opacity: 0, x: reduced ? 0 : 18 }} animate={{ opacity: 1, x: 0 }}>
        <span className={s.eyebrow}>{step === "help" ? "A LITTLE NUDGE FROM MOSS" : step === "compose" ? `A MEMORY OF ${room.recipientDisplayName}` : step === "connect" ? "HOW CONNECTIONS WORK" : "YOUR FIRST MEMORY"}</span>
        <h2>{title}</h2>
        {step === "welcome" && <p>There’s no right way to remember someone.</p>}
        {step === "connect" && <div className={s.flow} aria-hidden>
          <div><b><img src={portraitUrl(meAvatar)} alt="" /><img src={portraitUrl(peerAvatar)} alt="" /></b><span>Your memory + {peerName}’s</span></div><i>→</i>
          <div><b className={s.cloud}>{shared?.label ?? "A theme"}</b><span>{shared ? "What they share" : "Forms as memories connect"}</span></div><i>→</i>
          <div><b className={s.gifts}><em /><em /><em /></b><span>More real gifts</span></div>
        </div>}
        {step === "help" && nudge && recall?.question === question && <MossRecall recall={recall} />}
        {callPanel}
        <div className={s.editor}>{editor}</div>
        <div className={s.actions}>{controls}</div>
        {step === "connect" && <div className={s.hold}><i style={{ animationDuration: `${reduced ? CONNECT_HOLD_MS * 1.5 : CONNECT_HOLD_MS}ms` }} /><span>Continues on its own</span></div>}
        {map.error && <p role="alert" className={s.error}>{map.error}</p>}
      </motion.section>}
      <div className={s.narration} aria-live="polite"><img src={portraitUrl("calm")} alt="Moss" /><div><span>MOSS</span><p>{text}</p></div></div>
    </motion.div>}</AnimatePresence>,
  };
}

/** The memory Moss found for this question, quoted as shared, with how it was found. */
function MossRecall({ recall }: { recall: { state: "loading" | "done"; view: MossNudgeView | null } }) {
  if (recall.state === "loading") return <div className={s.recall} role="status"><i className={s.recallDots} aria-hidden><em /><em /><em /></i><span>Moss is looking through what friends shared…</span></div>;
  if (!recall.view) return <div className={s.recall} role="status"><span>No one else has shared a memory yet. Start with a real moment you remember.</span></div>;
  const v = recall.view;
  return (
    <figure className={s.recall} aria-label={`${v.author} remembered`}>
      <blockquote>“{v.text}”</blockquote>
      <figcaption><b>{v.author}</b><span>{matchCaption(v)}</span></figcaption>
    </figure>
  );
}

/** The live call: who's talking, the last few lines, and the person's own words to keep. */
function MossCall({ call, onUse, recipient }: { call: ReturnType<typeof useMossVoice>; onUse(): void; recipient: string }) {
  const status = call.state === "connecting" ? "Calling Moss…"
    : call.state === "live" ? (call.speaking === "moss" ? "Moss is speaking" : call.speaking === "me" ? "Moss is listening" : "Say something about " + recipient)
    : call.state === "error" ? call.error ?? "Moss couldn’t start a call."
    : "Call ended";
  const recent: MossLine[] = call.lines.slice(-3);
  return (
    <section className={s.call} aria-label="Call with Moss" data-state={call.state} data-speaking={call.speaking ?? "none"}>
      <header>
        <i className={s.callOrb} aria-hidden><em /><em /><em /></i>
        <span role="status">{status}</span>
        {call.live && <button onClick={call.stop} className={s.hangUp}>Hang up</button>}
        {!call.live && <button onClick={() => void call.start()}>{call.state === "error" ? "Try again" : "Call again"}</button>}
      </header>
      {recent.length > 0 && <ol className={s.lines}>{recent.map((l) => <li key={l.id} data-who={l.who}><b>{l.who === "me" ? "You" : "Moss"}</b> {l.text}</li>)}</ol>}
      {call.myWords && <button className={s.useWords} onClick={onUse}>Use what I said</button>}
      <small className={s.callFine}>Moss hears you only during this call. Nothing is shared until you press share.</small>
    </section>
  );
}
