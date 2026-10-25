/**
 * Moss's natural narration voice (D30). Server-only.
 *
 * GET  → { available } : whether ELEVENLABS_API_KEY is set on this server.
 * POST { roomId, text } with `Authorization: Bearer <the caller's Convex token>`
 *      → audio/mpeg of `text` in Moss's ElevenLabs voice.
 *
 * Only room members may use it (checked in Convex with their own token), so the
 * paid voice can't be spent by strangers. Text is the guide's own line (at most
 * 400 characters). Repeated lines are served from a small in-memory cache. The
 * API key never reaches the browser (the SDK reads ELEVENLABS_API_KEY from the
 * server environment) and provider errors are never echoed.
 */
import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { elevenLabs } from "@/lib/elevenlabs";
import { cleanSpeechText, DEFAULT_ELEVENLABS_MODEL, DEFAULT_ELEVENLABS_VOICE, SPEECH_MAX_CHARS, speechRequest } from "@/lib/room/mossSpeech";

const bodySchema = z.strictObject({ roomId: z.string().min(1).max(64), text: z.string().min(1).max(SPEECH_MAX_CHARS) });

const CACHE_LINES = 200;
const MEMBER_TTL_MS = 5 * 60 * 1000;
const audioCache = new Map<string, ArrayBuffer>();
const members = new Map<string, number>();

function config() {
  const client = elevenLabs();
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  return client && convexUrl
    ? { client, convexUrl, voiceId: process.env.ELEVENLABS_VOICE_ID || DEFAULT_ELEVENLABS_VOICE, modelId: process.env.ELEVENLABS_MODEL_ID || DEFAULT_ELEVENLABS_MODEL }
    : null;
}

const fail = (status: number, code: string, message: string) =>
  Response.json({ ok: false, error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });

async function isMember(convexUrl: string, token: string, roomId: string): Promise<boolean> {
  const key = `${roomId}:${token}`;
  if ((members.get(key) ?? 0) > Date.now()) return true;
  const convex = new ConvexHttpClient(convexUrl);
  convex.setAuth(token);
  try {
    const r = await convex.query(api.moss.voice.canCall, { roomId: roomId as Id<"rooms"> });
    if (!r.ok) return false;
  } catch {
    return false;
  }
  if (members.size > 500) members.clear();
  members.set(key, Date.now() + MEMBER_TTL_MS);
  return true;
}

export async function GET() {
  return Response.json({ available: config() !== null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const cfg = config();
  if (!cfg) return fail(503, "unavailable", "Moss's natural voice isn't set up on this server.");
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return fail(401, "unauthorized", "Sign in first.");
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  const text = parsed.success ? cleanSpeechText(parsed.data.text) : null;
  if (!parsed.success || !text) return fail(400, "validation_failed", "Nothing to say.");
  if (!(await isMember(cfg.convexUrl, token, parsed.data.roomId))) return fail(403, "unauthorized", "You are not a member of this room.");

  const key = `${cfg.voiceId}:${cfg.modelId}:${text}`;
  let audio = audioCache.get(key);
  if (!audio) {
    const { voiceId, request } = speechRequest(text, cfg);
    try {
      const stream = await cfg.client.textToSpeech.convert(voiceId, request, { timeoutInSeconds: 10, maxRetries: 1 });
      audio = await new Response(stream).arrayBuffer();
    } catch {
      return fail(502, "provider_timeout", "Moss's voice didn't answer.");
    }
    if (audioCache.size >= CACHE_LINES) audioCache.delete(audioCache.keys().next().value!);
    audioCache.set(key, audio);
  }
  return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" } });
}
