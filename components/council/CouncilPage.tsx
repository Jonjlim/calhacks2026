"use client";

import { useConvexConnectionState, useQuery } from "convex/react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { COUNCIL_LABEL, COUNCIL_TINT, poseFor } from "@/lib/council/animation";
import { COUNCIL_ACTORS, type CouncilEvent, type CouncilMemberState, decorationsFrom, type DecorationSpec, reduceCouncil } from "@/lib/council/contracts";
import { SAMPLE_MEMORY, SAMPLE_SESSION } from "@/lib/council/sampleSession";

const CouncilScene = dynamic(() => import("./CouncilScene"), { ssr: false });

const DEMO_KEY = "unwrap:council-demo-key";
const HAS_CONVEX = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
/** No event for this long while running → treat the run as interrupted. */
const INTERRUPTED_MS = 120_000;

interface LiveData {
  run: { runId: string; source: "web" | "asi1"; status: "running" | "completed" | "failed"; startedAt: number; updatedAt: number } | null;
  events: CouncilEvent[];
  decorations: DecorationSpec[];
}

function useDemoKey(): string | null {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    const watch = new URLSearchParams(window.location.search).get("watch");
    if (watch && /^[A-Za-z0-9_-]{6,64}$/.test(watch)) return setKey(watch);
    try {
      let k = localStorage.getItem(DEMO_KEY);
      if (!k) {
        k = "demo_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
        localStorage.setItem(DEMO_KEY, k);
      }
      setKey(k);
    } catch {
      setKey("demo_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20));
    }
  }, []);
  return key;
}

/** Live subscription. Only mounted when a Convex deployment is configured. */
function LiveSource({ demoKey, onData, onConnection }: { demoKey: string; onData: (d: LiveData | null | undefined) => void; onConnection: (online: boolean) => void }) {
  const data = useQuery(api.council.demoState, { demoKey }) as LiveData | null | undefined;
  const conn = useConvexConnectionState();
  useEffect(() => onData(data), [data, onData]);
  useEffect(() => onConnection(conn.isWebSocketConnected), [conn.isWebSocketConnected, onConnection]);
  return null;
}

export function CouncilPage() {
  const demoKey = useDemoKey();
  const [mode, setMode] = useState<"live" | "replay">(HAS_CONVEX ? "live" : "replay");
  const [live, setLive] = useState<LiveData | null | undefined>(undefined);
  const [online, setOnline] = useState(true);
  const [replayEvents, setReplayEvents] = useState<CouncilEvent[]>([]);
  const [memory, setMemory] = useState(SAMPLE_MEMORY);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const initialIds = useRef<Set<string> | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  const onData = useCallback((d: LiveData | null | undefined) => setLive(d), []);
  const onConnection = useCallback((v: boolean) => setOnline(v), []);

  const events = mode === "replay" ? replayEvents : (live?.events ?? []);
  const interrupted = mode === "live" && live?.run?.status === "running" && now - live.run.updatedAt > INTERRUPTED_MS;
  const members = useMemo(() => {
    const m = reduceCouncil(events);
    // An interrupted run leaves no one stuck mid-task: they settle back to a calm recovery pose.
    if (interrupted) for (const a of COUNCIL_ACTORS) if (m[a].status === "started") m[a] = { ...m[a], status: "failed", summary: "Run interrupted" };
    return m;
  }, [events, interrupted]);
  const decorations = useMemo(() => (mode === "replay" ? decorationsFrom(replayEvents) : (live?.decorations ?? [])), [mode, replayEvents, live]);

  // Charms already persisted when the page loaded render in place; later ones get the carry animation.
  if (mode === "live" && live && initialIds.current === null) initialIds.current = new Set(live.decorations.map((d) => d.memoryId));
  const freshIds = useMemo(() => new Set(decorations.filter((d) => mode === "replay" || !initialIds.current?.has(d.memoryId)).map((d) => d.memoryId)), [decorations, mode]);

  const runActive = events.length > 0 && members.courier.status === "started";
  const runMuse = events.find((e) => e.actor === "muse" && e.status === "completed");
  const note = runActive || (runMuse && members.courier.status !== "idle" && !interrupted && events.length > 0)
    ? { jar: runMuse?.result?.decorations?.[0]?.jar ?? (members.muse.status === "failed" ? "moment" : null), settled: members.muse.status === "completed" || members.muse.status === "failed" }
    : null;

  const stopReplay = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => stopReplay, []);

  const playReplay = () => {
    stopReplay();
    setMode("replay");
    setReplayEvents([]);
    setError(null);
    for (const { at, event } of SAMPLE_SESSION) {
      timers.current.push(window.setTimeout(() => setReplayEvents((evs) => [...evs, event]), at + 400));
    }
  };

  const submit = async () => {
    if (!demoKey) return;
    stopReplay();
    setMode("live");
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/council/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ demoKey, memories: [memory] }) });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) setError(body.error ?? "The council couldn't start.");
    } catch {
      setError("Couldn't reach the Unwrap server. Check your connection, or play the sample replay.");
    } finally {
      setPending(false);
    }
  };

  const busy = pending || (mode === "live" && live?.run?.status === "running" && !interrupted);

  return (
    <main className="relative grid min-h-dvh grid-rows-[auto_1fr] bg-[#d9e6f2] lg:grid-cols-[minmax(340px,420px)_1fr] lg:grid-rows-1">
      {HAS_CONVEX && demoKey && mode === "live" && <LiveSource demoKey={demoKey} onData={onData} onConnection={onConnection} />}
      <section className="z-10 flex flex-col gap-5 bg-[#fbf7f0]/95 px-6 py-7 shadow-[0_0_40px_rgba(65,52,76,0.15)] lg:overflow-y-auto">
        <header>
          <a href="/" className="font-display text-[26px] leading-none font-semibold text-dusk">
            unwrap<span className="text-coral-soft">.</span>
          </a>
          <h1 className="font-display mt-4 text-[34px] leading-[1.05] text-dusk">The AI Council</h1>
          <p className="mt-2 text-[14.5px] leading-relaxed text-dusk/70">
            Share a memory. A Fetch.ai coordinator runs five specialists on it — and each one moves here only when its real task starts, finishes or fails.
          </p>
        </header>

        {mode === "replay" && (
          <p role="status" className="rounded-xl border border-gold/60 bg-gold/15 px-3 py-2 text-[13px] font-medium text-dusk/80">
            <strong>Sample replay</strong> — a recorded session for when the network is down. These are not live agent results.
          </p>
        )}
        {mode === "live" && !HAS_CONVEX && <p className="rounded-xl bg-coral-soft/20 px-3 py-2 text-[13px] text-[#8c3b2c]">Live mode needs a Convex deployment (NEXT_PUBLIC_CONVEX_URL). The sample replay still works.</p>}
        {mode === "live" && HAS_CONVEX && !online && <p role="status" className="rounded-xl bg-lilac/60 px-3 py-2 text-[13px] text-dusk/80">Reconnecting… the council will catch up from saved events.</p>}
        {interrupted && (
          <p role="alert" className="rounded-xl bg-coral-soft/20 px-3 py-2 text-[13px] text-[#8c3b2c]">
            This run stopped reporting (agent offline or network lost). Its finished steps and charms are kept — submit again to retry.
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor="memory" className="text-[12.5px] font-semibold tracking-wide text-dusk/70">
            A memory about them
          </label>
          <textarea
            id="memory"
            value={memory}
            onChange={(e) => setMemory(e.target.value)}
            maxLength={600}
            rows={4}
            className="rounded-xl border border-dusk/15 bg-white/80 px-3.5 py-2.5 text-[14.5px] text-dusk outline-none focus:border-dusk/40 focus:ring-4 focus:ring-lilac/70"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy || memory.trim().length < 3 || !demoKey} className="btn-primary disabled:opacity-60">
              {pending ? "Starting…" : busy ? "Council at work…" : "Ask the Council"}
            </button>
            <button type="button" onClick={playReplay} className="btn-secondary h-12 px-5 text-[14px]">
              Play sample replay
            </button>
          </div>
          {error && (
            <p role="alert" className="rounded-xl bg-coral-soft/20 px-3 py-2 text-[13px] text-[#8c3b2c]">
              {error}
            </p>
          )}
        </form>

        <ol className="flex flex-col gap-2" aria-label="Council progress">
          {COUNCIL_ACTORS.map((a) => (
            <MemberRow key={a} state={members[a]} />
          ))}
        </ol>

        {decorations.length > 0 && (
          <p className="text-[13px] text-dusk/70">
            On the gift box: {decorations.map((d) => `${d.label} (${d.assetId.replace(/_/g, " ")})`).join(", ")}
          </p>
        )}
        <p className="mt-auto text-[12px] leading-snug text-dusk/50">
          Also available in ASI:One as the “Unwrap Gift Council” agent. Results appear there with real links and observed prices.
        </p>
      </section>

      <div className="relative min-h-[420px]" aria-hidden>
        <CouncilScene members={members} decorations={decorations} freshIds={freshIds} note={note} />
      </div>
    </main>
  );
}

function MemberRow({ state }: { state: CouncilMemberState }) {
  const pose = poseFor(state);
  const badge = { idle: "Idle", started: "Working", completed: "Done", failed: "Stopped" }[state.status];
  return (
    <li className="flex items-start gap-3 rounded-xl bg-white/60 px-3 py-2">
      <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: COUNCIL_TINT[state.actor], opacity: state.status === "idle" ? 0.4 : 1 }} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline justify-between gap-2 text-[14px] font-semibold text-dusk">
          {COUNCIL_LABEL[state.actor]}
          <span className="text-[11px] font-semibold tracking-wide text-dusk/55 uppercase">{badge}</span>
        </p>
        <p className="text-[13px] text-dusk/70">{pose.caption}</p>
        {state.summary && <p className="mt-0.5 truncate text-[12px] text-dusk/55" title={state.summary}>{state.summary}</p>}
      </div>
    </li>
  );
}
