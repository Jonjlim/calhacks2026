/**
 * Agent collaborators: AI agents that join a gift room alongside people and
 * post suggestions the way a friend would ("I learned that Maya is into
 * trail running"). The Gift Twin is the first kind; a trend scout is the
 * planned second.
 *
 * Shared by Convex (`convex/giftTwin/*`), the Mac companion (`gift-twin/`)
 * and the UI. Keep this file dependency-free apart from zod and type-only
 * imports, because the companion runs it directly under Node type stripping.
 *
 * Gift Twin flow: the recipient pairs their Mac, then grants one-time
 * permission to upload the messages they sent into a temporary server-only
 * vault (deleted after TWIN_LIMITS.vaultTtlMs, on `forget`, or on
 * disconnect). The cloud twin agent, acting for the recipient:
 *   - finds gift-feasible insights (one clear mention is enough), and
 *   - votes up or down on the room's ideas, both the ones already there and
 *     new ones added while the vault is open ("friends say backpacking; she
 *     hates it" is a downvote).
 * Unwrap's gift agent then decides what becomes room knowledge. Twin votes
 * are advisory signals, separate from participant votes: agents still
 * cannot select, approve, or touch money.
 */
import { z } from "zod";
import type { ClueKind } from "../contracts";

export const AGENT_COLLABORATOR_KINDS = ["gift_twin", "trend_scout"] as const;
export type AgentCollaboratorKind = (typeof AGENT_COLLABORATOR_KINDS)[number];

export const AGENT_COLLABORATOR_STATUSES = ["pending_pairing", "active", "revoked"] as const;
export type AgentCollaboratorStatus = (typeof AGENT_COLLABORATOR_STATUSES)[number];

export const TWIN_INSIGHT_CATEGORIES = ["interest", "wish", "dislike", "owns", "style"] as const;
export type TwinInsightCategory = (typeof TWIN_INSIGHT_CATEGORIES)[number];

export const TWIN_CONFIDENCES = ["low", "medium", "high"] as const;
export type TwinConfidence = (typeof TWIN_CONFIDENCES)[number];

export const TWIN_VOTES = ["up", "down"] as const;
export type TwinVote = (typeof TWIN_VOTES)[number];

export const AGENT_POST_KINDS = ["insight", "vote"] as const;
export type AgentPostKind = (typeof AGENT_POST_KINDS)[number];

/**
 * suggested: awaiting the gift agent; added: published as a room clue;
 * noted: shown in the feed but no new clue (e.g. an upvote);
 * dismissed: skipped by the gift agent and hidden.
 */
export const AGENT_POST_STATUSES = ["suggested", "added", "noted", "dismissed"] as const;
export type AgentPostStatus = (typeof AGENT_POST_STATUSES)[number];

/**
 * uploading: the companion is sending batches; processing: the twin agent's
 * first pass; ready: first pass done, votes on new room ideas until expiry;
 * expired: the messages are deleted (TTL, forget, or disconnect).
 */
export const TWIN_VAULT_STATUSES = ["uploading", "processing", "ready", "expired"] as const;
export type TwinVaultStatus = (typeof TWIN_VAULT_STATUSES)[number];

export const ROOM_IDEA_KINDS = ["clue", "idea", "listing"] as const;
export type RoomIdeaKind = (typeof ROOM_IDEA_KINDS)[number];

export const TWIN_LIMITS = {
  insightTextMaxChars: 160,
  insightsPerRun: 20,
  votesPerRun: 30,
  /** Room ideas the twin looks at per pass. */
  contextIdeasMax: 30,
  ideaTextMaxChars: 200,
  ideaRefMaxChars: 80,
  /** Idea refs remembered as already checked, so the watch loop does not re-vote. */
  checkedRefsMax: 500,
  pairingCodeLength: 8,
  pairingCodeTtlMs: 15 * 60_000,
  deviceLabelMaxChars: 60,
  deviceTokenMinChars: 32,
  deviceTokenMaxChars: 128,
  messageMaxChars: 2_000,
  /** Keeps each stored chunk well under Convex's 1 MiB document limit, even for multi-byte text. */
  uploadBatchMaxChars: 250_000,
  uploadBatchMaxMessages: 1_000,
  /** Shared 1 MiB read budget and server-side UTF-8 text limit. */
  messageReadMaxBytes: 1024 * 1024,
  vaultMaxBytes: 1024 * 1024,
  vaultMaxChars: 1024 * 1024,
  vaultMaxChunks: 40,
  vaultTtlMs: 24 * 60 * 60_000,
  /** How often the twin checks the room for new ideas while the vault is open. */
  watchIntervalMs: 30_000,
} as const;

/** Vague or ambiguous signals are dropped. A single clear mention is not low. */
export function isShareableConfidence(confidence: TwinConfidence): boolean {
  return confidence !== "low";
}

/** No 0/O, 1/I/L: codes are read aloud or typed from a screen. */
export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function normalizePairingCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ---------- Vault upload (companion → Convex) ----------

/** One message the recipient sent. Messages from other people are never uploaded. */
export interface VaultMessage {
  text: string;
  sentAt: number;
}

/** Splits an upload into batches that each fit one `device.uploadMessages` call. */
export function splitIntoUploadBatches(messages: VaultMessage[]): VaultMessage[][] {
  const batches: VaultMessage[][] = [];
  let current: VaultMessage[] = [];
  let chars = 0;
  for (const message of messages) {
    const text = message.text.slice(0, TWIN_LIMITS.messageMaxChars);
    if (current.length >= TWIN_LIMITS.uploadBatchMaxMessages || chars + text.length > TWIN_LIMITS.uploadBatchMaxChars) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push({ text, sentAt: message.sentAt });
    chars += text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

// ---------- Screening of anything the twin posts to the room ----------

/**
 * Topics a twin must never share with the room even if the recipient's
 * messages discuss them. Applied to model output and again at insert;
 * prompts are not an access-control layer.
 */
const SENSITIVE_TOPICS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(diagnos\w*|medicat\w*|prescription\w*|therap(y|ist)\w*|depress\w*|anxiety|adhd|pregnan\w*|cancer|chemo\w*|illness\w*|disease\w*|surgery|rehab|sobriety|sober|disorder\w*|allerg\w*)\b/i, "health"],
  [/\b(religio\w*|church|mosque|synagogue|temple|pray(ing|er|ers)?|bible|quran|torah)\b/i, "religion"],
  [/\b(sexual\w*|gay|lesbian|bisexual|queer|transgender|dating app\w*|hookup\w*)\b/i, "sexuality"],
  [/\b(politic\w*|democrat\w*|republican\w*|liberal|conservative|election\w*|vote[sd]?|voting)\b/i, "politics"],
  [/\b(debt\w*|bankrupt\w*|salary|loan\w*|mortgage|rent money|broke|payday)\b/i, "finances"],
  [/\b(lawsuit\w*|arrest\w*|court date|divorc\w*|custody|immigration|visa status)\b/i, "legal"],
  [/\b(password\w*|passcode\w*|ssn|social security|bank account|credit card|pin code)\b/i, "credentials"],
];

const CONTACT_DETAILS: ReadonlyArray<RegExp> = [
  /https?:\/\/|www\./i,
  /[\w.+-]+@[\w-]+\.[\w.]+/,
  /(\+?\d[\d\s().-]{7,}\d)/,
];

export type ScreenResult = { ok: true; text: string } | { ok: false; reason: string };

/**
 * Accepts short third-person summaries only: no quoted transcript, links,
 * contact details, or sensitive topics.
 */
export function screenSharedText(raw: string, maxChars: number = TWIN_LIMITS.insightTextMaxChars): ScreenResult {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length === 0) return { ok: false, reason: "empty" };
  if (text.length > maxChars) return { ok: false, reason: "too_long" };
  if (/["“”]/.test(text)) return { ok: false, reason: "quoted_transcript" };
  if (CONTACT_DETAILS.some((pattern) => pattern.test(text))) return { ok: false, reason: "contact_details" };
  for (const [pattern, topic] of SENSITIVE_TOPICS) if (pattern.test(text)) return { ok: false, reason: `sensitive_${topic}` };
  return { ok: true, text };
}

const sharedText = z.string().superRefine((value, ctx) => {
  const result = screenSharedText(value);
  if (!result.ok) ctx.addIssue({ code: "custom", message: result.reason });
});

export const twinInsightSchema = z.strictObject({
  category: z.enum(TWIN_INSIGHT_CATEGORIES),
  text: sharedText,
  confidence: z.enum(TWIN_CONFIDENCES),
  /** How many of the recipient's messages supported it. A count only. */
  evidenceCount: z.number().int().min(1).max(999),
});
export type TwinInsight = z.infer<typeof twinInsightSchema>;

export const twinVoteSchema = z.strictObject({
  /** Server-issued room idea ref ("clue:<id>"); the server resolves it and stores its own copy of the idea text. */
  ideaRef: z.string().min(1).max(TWIN_LIMITS.ideaRefMaxChars),
  vote: z.enum(TWIN_VOTES),
  /** Third-person, screened: "Maya has said she hates backpacking". */
  text: sharedText,
  /** Downvotes only: "dislike" (she hates it) or "owns" (she already has it); becomes the clue kind. */
  category: z.enum(TWIN_INSIGHT_CATEGORIES).optional(),
  confidence: z.enum(TWIN_CONFIDENCES),
  evidenceCount: z.number().int().min(1).max(999),
});
export type TwinVoteCast = z.infer<typeof twinVoteSchema>;

/** The gift agent's verdict on each new twin note, by index. Missing indexes are skipped. */
export const twinReviewSchema = z.strictObject({
  decisions: z.array(z.strictObject({ index: z.number().int().min(0), add: z.boolean() })).max(TWIN_LIMITS.insightsPerRun),
});

/** How a twin note becomes a room clue once the gift agent adds it. */
export function clueKindForCategory(category: TwinInsightCategory): ClueKind {
  switch (category) {
    case "interest":
    case "style":
      return "interest";
    case "wish":
      return "explicit_wish";
    case "dislike":
      return "exclusion";
    case "owns":
      return "ownership";
  }
}

export function insightDedupeKey(category: TwinInsightCategory, text: string): string {
  return `${category}:${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
}

export function voteDedupeKey(ideaRef: string): string {
  return `vote:${ideaRef}`;
}

/** A room idea the twin may vote on: clue, idea-branch, or listing text only. */
export interface RoomIdea {
  ref: string;
  kind: RoomIdeaKind;
  text: string;
  /** Set for clues; an "exclusion" clue is read as a negated idea when voting. */
  clueKind?: ClueKind;
}

// ---------- Room-facing views (never include hashes or message text) ----------

export interface TwinVaultView {
  status: TwinVaultStatus;
  messageCount: number;
  expiresAt?: number;
}

export interface AgentCollaboratorView {
  id: string;
  roomId: string;
  kind: AgentCollaboratorKind;
  displayName: string;
  status: AgentCollaboratorStatus;
  deviceLabel?: string;
  pairingExpiresAt?: number;
  /** When the recipient granted the one-time upload. */
  consentedAt?: number;
  /** When the twin agent finished its first pass. */
  reportedAt?: number;
  vault?: TwinVaultView;
  createdAt: number;
}

export interface AgentCollaboratorPostView {
  id: string;
  collaboratorId: string;
  kind: AgentPostKind;
  category?: TwinInsightCategory;
  text: string;
  confidence: TwinConfidence;
  evidenceCount?: number;
  /** Public collaborator identity, retained for posts after disconnect. */
  authorName?: string;
  /** Votes only: server-validated target and the twin's evaluation. */
  ideaRef?: string;
  ideaText?: string;
  vote?: TwinVote;
  status: AgentPostStatus;
  publishedClueId?: string;
  createdAt: number;
}

export interface AgentCollaboratorFeed {
  collaborators: AgentCollaboratorView[];
  posts: AgentCollaboratorPostView[];
}

export interface DeviceSession {
  collaboratorId: string;
  recipientDisplayName: string;
  occasion: string;
  status: AgentCollaboratorStatus;
  vault?: TwinVaultView;
}

export interface UploadStarted {
  uploadId: string;
  expiresAt: number;
}

export interface UploadFinished {
  messageCount: number;
  expiresAt: number;
}
