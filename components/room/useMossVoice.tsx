"use client";

import { useAuthToken } from "@convex-dev/auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Room, TextStreamReader } from "livekit-client";

/**
 * A live voice call with Moss, the hosted Moss voice agent (MAP-026, D29).
 *
 * The mic starts only from `start()` (an explicit tap) and stops on `stop()`,
 * when the component unmounts, or when `active` turns false (guide hidden,
 * drawer or reveal). The first text sent into the call is the room context
 * (room-visible memories only). Transcripts stay in this browser; nothing from
 * the call is saved or published. "Use what I said" only fills the draft.
 */
export type MossCallState = "idle" | "connecting" | "live" | "ended" | "error";
export interface MossLine { id: string; who: "me" | "moss"; text: string; final: boolean }

export function useMossVoice({ roomId, active, contextText }: { roomId: string; active: boolean; contextText: () => string }) {
  const authToken = useAuthToken();
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<MossCallState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<MossLine[]>([]);
  const [speaking, setSpeaking] = useState<"me" | "moss" | null>(null);
  const room = useRef<Room | null>(null);
  const audio = useRef<HTMLAudioElement[]>([]);
  const context = useRef(contextText);
  context.current = contextText;

  // Only offer the call when this server has Moss voice configured.
  useEffect(() => {
    let live = true;
    fetch("/api/moss-voice", { cache: "no-store" }).then((r) => r.json()).then((d: { available?: boolean }) => { if (live) setAvailable(!!d.available); }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  const stop = useCallback(() => {
    const r = room.current;
    room.current = null;
    if (r) void r.disconnect();
    for (const el of audio.current) { el.pause(); el.remove(); }
    audio.current = [];
    setSpeaking(null);
    setState((s) => (s === "live" || s === "connecting" ? "ended" : s));
  }, []);

  const start = useCallback(async () => {
    if (room.current || !authToken) return;
    setState("connecting");
    setError(null);
    setLines([]);
    try {
      const res = await fetch("/api/moss-voice", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ roomId }) });
      const body = await res.json() as { ok: boolean; value?: { serverUrl: string; participantToken: string }; error?: { message: string } };
      if (!body.ok || !body.value) throw new Error(body.error?.message ?? "Moss couldn't start a call.");
      const { Room, RoomEvent, Track } = await import("livekit-client");
      const r = new Room({ adaptiveStream: true, dynacast: true });
      room.current = r;
      r.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach() as HTMLAudioElement;
        el.style.display = "none";
        document.body.appendChild(el);
        audio.current.push(el);
      });
      r.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        setSpeaking(speakers.length === 0 ? null : speakers.some((p) => p.identity === r.localParticipant.identity) ? "me" : "moss");
      });
      r.on(RoomEvent.Disconnected, () => { if (room.current === r) stop(); });
      // Live captions for both sides; each stream is one segment, updated as it grows.
      r.registerTextStreamHandler("lk.transcription", async (reader: TextStreamReader, from: { identity: string }) => {
        const id = reader.info.attributes?.["lk.segment_id"] ?? reader.info.id;
        const who: MossLine["who"] = from.identity === r.localParticipant.identity ? "me" : "moss";
        let text = "";
        for await (const chunk of reader) {
          text += chunk;
          const final = reader.info.attributes?.["lk.transcription_final"] === "true";
          setLines((prev) => {
            const next = prev.filter((l) => l.id !== id);
            return [...next, { id, who, text, final }].slice(-12);
          });
        }
      });
      await r.connect(body.value.serverUrl, body.value.participantToken);
      await r.localParticipant.setMicrophoneEnabled(true);
      // Room context first, as data for the agent (see scripts/moss-voice/agent.json).
      await r.localParticipant.sendText(context.current(), { topic: "lk.chat" });
      setState("live");
    } catch (e) {
      stop();
      setState("error");
      setError(e instanceof Error && /microphone|permission|NotAllowed/i.test(e.message) ? "Moss needs your microphone. Allow it and try again." : e instanceof Error ? e.message : "Moss couldn't start a call.");
    }
  }, [authToken, roomId, stop]);

  useEffect(() => { if (!active) stop(); }, [active, stop]);
  useEffect(() => stop, [stop]);

  /** The person's own most recent words, for "Use what I said". */
  const myWords = lines.filter((l) => l.who === "me" && l.text.trim()).slice(-2).map((l) => l.text.trim()).join(" ");
  return { available, state, error, lines, speaking, start, stop, myWords, live: state === "live" || state === "connecting" };
}
