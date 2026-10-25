"use client";

import { useAuthToken } from "@convex-dev/auth/react";
import { useEffect, useRef } from "react";
import { MOSS_VOICE_PITCH, MOSS_VOICE_RATE, pickMossVoice } from "@/lib/room/mossVoice";

type Cue = { text?: string; active?: boolean; typing?: boolean };

/**
 * Moss reading the guide's own lines aloud (D30, MAP-027). With ELEVENLABS_API_KEY
 * on the server she speaks in a natural ElevenLabs voice (`/api/moss-voice/speak`);
 * otherwise, or if a line fails, the browser's own voice reads it (a female
 * English system voice when there is one). Only while room sound is on and no
 * live Moss call is running; turning sound on reads the line on screen now.
 * It never listens or records.
 */
export function useMossNarrator(enabled: boolean, roomId: string) {
  const token = useAuthToken();
  const on = useRef(enabled);
  const latest = useRef<Cue | null>(null);
  const spoken = useRef("");
  const natural = useRef(false);
  const ready = useRef(false);
  const auth = useRef(token);
  auth.current = token;
  const speakRef = useRef<(cue: Cue | null) => void>(() => undefined);

  // Does this server have the natural voice? Stay quiet until this answers,
  // so the browser voice does not claim the line first.
  useEffect(() => {
    let live = true;
    fetch("/api/moss-voice/speak", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { available?: boolean }) => { if (live) natural.current = !!d.available; })
      .catch(() => { if (live) natural.current = false; })
      .finally(() => {
        if (!live) return;
        ready.current = true;
        speakRef.current(latest.current);
      });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    let voice: SpeechSynthesisVoice | null = synth ? pickMossVoice(synth.getVoices()) : null;
    const onVoices = () => { voice = synth ? pickMossVoice(synth.getVoices()) : null; };
    let playing: HTMLAudioElement | null = null;
    let inflight: AbortController | null = null;
    let held = false;

    const hush = () => {
      inflight?.abort();
      inflight = null;
      if (playing) { playing.pause(); URL.revokeObjectURL(playing.src); playing = null; }
      synth?.cancel();
    };
    const browserVoice = (text: string) => {
      if (!synth) return;
      const line = new SpeechSynthesisUtterance(text);
      if (voice) { line.voice = voice; line.lang = voice.lang; }
      line.pitch = MOSS_VOICE_PITCH;
      line.rate = MOSS_VOICE_RATE;
      synth.speak(line);
    };
    const naturalVoice = async (text: string) => {
      const abort = new AbortController();
      inflight = abort;
      try {
        const res = await fetch("/api/moss-voice/speak", {
          method: "POST", signal: abort.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.current}` },
          body: JSON.stringify({ roomId, text }),
        });
        if (!res.ok) throw new Error("speak failed");
        const url = URL.createObjectURL(await res.blob());
        if (abort.signal.aborted || spoken.current !== text) { URL.revokeObjectURL(url); return; }
        const audio = new Audio(url);
        playing = audio;
        audio.onended = () => { if (playing === audio) { URL.revokeObjectURL(url); playing = null; } };
        await audio.play();
      } catch {
        if (abort.signal.aborted || spoken.current !== text) return;
        // The clip is ready and the browser is waiting for a tap. Keep it.
        // The robotic voice is only for when ElevenLabs itself did not answer.
        if (playing) { held = true; return; }
        held = true;
        browserVoice(text);
      } finally {
        if (inflight === abort) inflight = null;
      }
    };

    speakRef.current = (cue) => {
      if (!on.current || !cue?.active || !cue.text) { hush(); spoken.current = ""; return; }
      if (!ready.current) return;
      // Signed-in rooms can use ElevenLabs. Wait for the token instead of
      // starting the browser voice and then refusing to switch.
      if (natural.current && !auth.current) return;
      if (cue.text === spoken.current) return;
      spoken.current = cue.text;
      hush();
      if (natural.current) void naturalVoice(cue.text);
      else browserVoice(cue.text);
    };
    // Always listen, so the current line is known the moment sound turns on.
    const onCue = (e: Event) => {
      const cue = (e as CustomEvent<Cue>).detail ?? null;
      // Don't talk over someone writing; their typing feedback stays on screen only.
      if (cue?.typing && cue.active) return;
      latest.current = cue;
      speakRef.current(cue);
    };
    const unlock = () => {
      if (!held || !on.current) return;
      held = false;
      if (playing) {
        void playing.play().catch(() => { if (latest.current?.text) browserVoice(latest.current.text); });
        return;
      }
      spoken.current = "";
      speakRef.current(latest.current);
    };
    synth?.addEventListener?.("voiceschanged", onVoices);
    window.addEventListener("unwrap:room-guide", onCue);
    window.addEventListener("pointerdown", unlock, true);
    return () => {
      window.removeEventListener("unwrap:room-guide", onCue);
      window.removeEventListener("pointerdown", unlock, true);
      synth?.removeEventListener?.("voiceschanged", onVoices);
      hush();
    };
  }, [roomId]);

  useEffect(() => {
    on.current = enabled;
    if (enabled) speakRef.current(latest.current);
    else { spoken.current = ""; speakRef.current(null); }
  }, [enabled, token]);
}
