/**
 * Moss voice call passes (MAP-026, D29). Server-only.
 *
 * GET  → { available } : whether this server has Moss voice configured.
 * POST { roomId } with `Authorization: Bearer <the caller's Convex token>`
 *      → { serverUrl, roomName, participantToken } for a call with the hosted
 *        Moss voice agent. Membership is checked in Convex with the caller's
 *        own token first, so only room members can start (and spend) a call.
 *
 * Moss credentials never reach the browser. Room and participant names in the
 * call are random; no room ID, user ID or name is sent to Moss here. The pass
 * expires after 15 minutes (set by @moss-tools/voice-server).
 */
import { randomUUID } from "node:crypto";
import { MossVoiceServer } from "@moss-tools/voice-server";
import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const bodySchema = z.strictObject({ roomId: z.string().min(1).max(64) });

function config() {
  const projectId = process.env.MOSS_PROJECT_ID;
  const projectKey = process.env.MOSS_PROJECT_KEY;
  const voiceAgentId = process.env.MOSS_VOICE_AGENT_ID;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  return projectId && projectKey && voiceAgentId && convexUrl ? { projectId, projectKey, voiceAgentId, convexUrl } : null;
}

// One credential fetch per server process; retried after a failure.
let server: Promise<MossVoiceServer> | null = null;
function voiceServer(cfg: NonNullable<ReturnType<typeof config>>) {
  server ??= MossVoiceServer.create({ projectId: cfg.projectId, projectKey: cfg.projectKey, voiceAgentId: cfg.voiceAgentId })
    .catch((error: unknown) => { server = null; throw error; });
  return server;
}

const fail = (status: number, code: string, message: string) =>
  Response.json({ ok: false, error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  return Response.json({ available: config() !== null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const cfg = config();
  if (!cfg) return fail(503, "unavailable", "Moss voice isn't set up on this server.");
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return fail(401, "unauthorized", "Sign in first.");
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "validation_failed", "Which room?");

  const convex = new ConvexHttpClient(cfg.convexUrl);
  convex.setAuth(token);
  try {
    const member = await convex.query(api.moss.voice.canCall, { roomId: parsed.data.roomId as Id<"rooms"> });
    if (!member.ok) return fail(403, member.error.code, member.error.message);
  } catch {
    return fail(403, "unauthorized", "You are not a member of this room.");
  }

  try {
    const moss = await voiceServer(cfg);
    const roomName = `unwrap-voice-${randomUUID()}`;
    const participantToken = await moss.createParticipantToken({ identity: `friend-${randomUUID()}`, name: "friend" }, roomName);
    return Response.json({ ok: true, value: { serverUrl: moss.getServerUrl(), roomName, participantToken } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Provider errors may echo credentials; never return or log them.
    return fail(502, "provider_timeout", "Moss voice didn't answer. Try again in a moment.");
  }
}
