/**
 * The twin's votes on the room's ideas. A vote says whether the idea is
 * true according to the recipient's own messages: up when they back it,
 * down when they contradict it ("friends say backpacking; she hates it") or
 * show she already owns it. Negated ideas flip: if friends wrote "Jon
 * doesn't want a jacket" and Jon wants an Arc'teryx jacket, that is a
 * downvote. Silence is the default; an idea with no clear evidence gets no
 * vote.
 *
 * Every vote is derived from evidence: what the messages show about the
 * subject (a TwinInsightCategory). expectedVote turns evidence plus the
 * idea's polarity into the vote, for the patterns here, for model output,
 * and again at insert (agent.ts).
 */
import { z } from "zod";
import { validatedModelCall, type ModelTransport } from "../agents/model";
import {
  isShareableConfidence,
  screenSharedText,
  TWIN_LIMITS,
  twinVoteSchema,
  type RoomIdea,
  type TwinConfidence,
  type TwinInsightCategory,
  type TwinVote,
  type TwinVoteCast,
  type VaultMessage,
} from "../../lib/agentCollaborators/contracts";
import { findStatements } from "./extract";
import { isCoherentNote } from "./interpret";

const STOPWORDS = new Set(
  "a an the and or but if of to in on for with at by from about as is are was were be been being do does did has have had would could should will can may might they them their theirs she her hers he him his it its this that these those what which who whom whose when where why how any some something anything already own owns like likes want wants gift gifts get got enjoy into really lately recently there here than then also just more most very much many one".split(" "),
);

export function searchTerms(text: string, ignore: string[] = []): string[] {
  const skip = new Set(ignore.map((s) => s.toLowerCase()));
  const terms = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !skip.has(t));
  return [...new Set(terms)];
}

/** Matches on a shared prefix so "runs" finds "running" and "pots" finds "pottery". */
function hits(text: string, term: string): boolean {
  const stem = term.length > 5 ? term.slice(0, term.length - 2) : term.length > 3 ? term.slice(0, 4) : term;
  return new RegExp(`\\b${stem.replace(/[-]/g, "\\-")}`, "i").test(text);
}

export function searchMessages(messages: VaultMessage[], terms: string[], limit = 12): VaultMessage[] {
  if (terms.length === 0) return [];
  const scored: Array<{ message: VaultMessage; score: number }> = [];
  for (const message of messages) {
    let score = 0;
    for (const term of terms) if (hits(message.text, term)) score += 1;
    if (score > 0) scored.push({ message, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || b.message.sentAt - a.message.sentAt)
    .slice(0, limit)
    .map((s) => s.message);
}

const IDEA_NOISE = ["loves", "love", "likes", "like", "enjoys", "wants", "maybe", "gift", "idea", "something", "really", "probably", "into", "great", "nice", "good", "favorite", "thing", "things", "stuff", "new", "doesn", "don", "didn", "isn", "won", "not", "never", "hate", "hates", "dislike", "dislikes", "stand", "avoid", "avoids", "nothing", "without"];
const NEGATIVE = /\b(hate[sd]?|can'?t stand|can’t stand|don'?t like|don’t like|not a fan|not into|so over|sick of|never again|gave up|quit|stopped|no longer|allergic)\b/i;
const POSITIVE = /\b(love|loving|obsessed|into|want|wanna|been (?:playing|doing|practicing|learning)|excited|can'?t wait|addicted|hooked)\b/i;

const NEGATED_IDEA = /\b(doesn'?t|does not|don'?t|do not|didn'?t|isn'?t|is not|won'?t|not|no|never|hates?|dislikes?|can'?t stand|avoid|avoids|nothing|without)\b/i;

/** True when the idea itself says no ("Jon doesn't want a jacket", an exclusion clue). Listing titles are never read as negated. */
export function ideaIsNegative(idea: RoomIdea): boolean {
  if (idea.clueKind === "exclusion") return true;
  if (idea.kind === "listing") return false;
  return NEGATED_IDEA.test(idea.text.replace(/[’‘]/g, "'"));
}

/**
 * The vote a piece of evidence implies for an idea, or null when it says
 * nothing either way (owning something a negated idea mentions).
 */
export function expectedVote(evidence: TwinInsightCategory, idea: RoomIdea): TwinVote | null {
  const negative = ideaIsNegative(idea);
  switch (evidence) {
    case "dislike":
      return negative ? "up" : "down";
    case "owns":
      if (negative) return null;
      // Owning it backs a clue about liking it, but makes a product idea a bad gift.
      return idea.kind === "clue" ? "up" : "down";
    case "interest":
    case "wish":
    case "style":
      return negative ? "down" : "up";
  }
}

/** Aligns a vote with its own evidence. Votes without evidence keep their vote. */
export function reconcileVote(cast: TwinVoteCast, idea: RoomIdea): TwinVoteCast | null {
  if (!cast.category) return cast;
  const vote = expectedVote(cast.category, idea);
  if (!vote) return null;
  return vote === cast.vote ? cast : { ...cast, vote };
}

interface Signal {
  vote: TwinVote;
  evidence: TwinInsightCategory;
  subject: string;
  sentAt: number;
}

function stem(term: string): string {
  return term.length > 5 ? term.slice(0, term.length - 2) : term;
}

/** What one message shows about a term, and the vote that implies for the idea. */
function signalFor(message: VaultMessage, terms: string[], idea: RoomIdea): Signal | null {
  const lower = message.text.toLowerCase();
  const term = terms.filter((t) => lower.includes(stem(t))).sort((a, b) => b.length - a.length)[0];
  if (!term) return null;
  const statement = findStatements(message.text).find((s) => s.object.toLowerCase().includes(stem(term)));
  let evidence: TwinInsightCategory;
  let subject: string;
  if (statement) {
    evidence = statement.category;
    subject = statement.category === "owns" ? statement.object : statement.object.replace(/^(a|an|the|some|new) /i, "");
  } else if (NEGATIVE.test(lower)) {
    evidence = "dislike";
    subject = term;
  } else if (POSITIVE.test(lower)) {
    evidence = "interest";
    subject = term;
  } else return null;
  const vote = expectedVote(evidence, idea);
  return vote ? { vote, evidence, subject, sentAt: message.sentAt } : null;
}

/** States the evidence, which reads correctly for an upvote and a downvote alike. */
function sentenceFor(name: string, signal: Signal): string {
  switch (signal.evidence) {
    case "dislike":
      return `${name} has said they don't like ${signal.subject}`;
    case "owns":
      return `${name} already has ${signal.subject}`;
    case "wish":
      return `${name} has said they want ${signal.subject}`;
    case "interest":
    case "style":
      return `${name} has said they're into ${signal.subject}`;
  }
}

/** Model-free votes from keyword search plus the extractor's statement patterns. */
export function heuristicVotes(ideas: RoomIdea[], messages: VaultMessage[], recipientName: string): TwinVoteCast[] {
  const out: TwinVoteCast[] = [];
  for (const idea of ideas.slice(0, TWIN_LIMITS.contextIdeasMax)) {
    const terms = searchTerms(idea.text, [recipientName, ...IDEA_NOISE]);
    if (terms.length === 0) continue;
    const signals = searchMessages(messages, terms, 20)
      .map((m) => signalFor(m, terms, idea))
      .filter((s): s is Signal => s !== null)
      .sort((a, b) => b.sentAt - a.sentAt);
    const against = signals.filter((s) => s.vote === "down");
    const forIt = signals.filter((s) => s.vote === "up");
    if (against.length === 0 && forIt.length === 0) continue;
    // A clear "I hate it" outweighs older enthusiasm; otherwise the majority wins.
    const down = against.length > 0 && (against.length >= forIt.length || against[0]!.sentAt > (forIt[0]?.sentAt ?? 0));
    const winning = down ? against : forIt;
    const lead = winning[0]!;
    const confidence: TwinConfidence = winning.length >= 2 || (down && forIt.length === 0) ? "high" : "medium";
    const screened = screenSharedText(sentenceFor(recipientName, lead));
    if (!screened.ok) continue;
    out.push({
      ideaRef: idea.ref,
      vote: lead.vote,
      text: screened.text,
      category: lead.evidence,
      confidence,
      evidenceCount: winning.length,
    });
    if (out.length >= TWIN_LIMITS.votesPerRun) break;
  }
  return out;
}

const VOTE_INSTRUCTIONS = `You are a Gift Twin: an agent acting for the gift recipient, who gave one-time permission for you to read messages they sent. Friends planning a gift shared their current ideas about the recipient. For each idea you get the recipient's messages that mention it.
For each idea, decide whether the idea is TRUE according to the recipient's own messages. Read the idea's exact wording, including negations like "doesn't", "not", "hates", or "no".
- vote "up" if the messages show the idea is true; "down" if they show it is false or would make a bad gift.
- category is what the messages show about the subject, regardless of the idea's wording: "wish" (wants it), "interest" (does or likes it), "style" (taste or favorite), "dislike" (doesn't like it), "owns" (already has it). Always include it.
Examples:
- idea "Jon loves backpacking"; he wrote that he hates backpacking -> vote "down", category "dislike".
- idea "Jon doesn't want a jacket"; he wrote that he wants an Arc'teryx jacket -> vote "down", category "wish" (the idea is false).
- idea "Jon hates candles"; he wrote that he can't stand scented candles -> vote "up", category "dislike".
- idea "Kindle Paperwhite" (a listing); he wrote that he already has a Kindle -> vote "down", category "owns".
- idea "Jon likes matcha"; he makes matcha every morning -> vote "up", category "interest".
Rules:
- Only vote on ideas with clear evidence. Leave out anything unclear; an empty list is fine.
- text is one short, complete third-person sentence (max 160 characters) about the recipient by name stating what the messages show, e.g. "Jon has said he wants an Arc'teryx jacket". Never quote messages, never mention other people, no links, no quotation marks.
- Never mention health, religion, sexuality, politics, finances, legal matters, or passwords.
- confidence is "high" for repeated or explicit evidence, "medium" for one clear mention. Never "low".
Return JSON only: {"votes":[{"ideaRef":string,"vote":"up"|"down","text":string,"category":"dislike"|"owns"|"interest"|"wish"|"style","confidence":"medium"|"high","evidenceCount":number}]}`;

const looseVotes = z.object({ votes: z.array(z.unknown()).max(60) });

/** Heuristic votes, replaced by a model pass when one is configured. Model output is re-validated. */
export async function castVotes(ideas: RoomIdea[], messages: VaultMessage[], recipientName: string, model?: ModelTransport): Promise<TwinVoteCast[]> {
  const fallback = heuristicVotes(ideas, messages, recipientName);
  if (!model || ideas.length === 0) return fallback;
  const withEvidence = ideas
    .slice(0, TWIN_LIMITS.contextIdeasMax)
    .map((idea) => ({
      ref: idea.ref,
      kind: idea.kind,
      idea: idea.text,
      negated: ideaIsNegative(idea),
      messages: searchMessages(messages, searchTerms(idea.text, [recipientName, ...IDEA_NOISE]), 8).map((m) => m.text.slice(0, 300)),
    }))
    .filter((i) => i.messages.length > 0);
  if (withEvidence.length === 0) return [];
  try {
    const raw = await validatedModelCall(
      model,
      { role: "recipient", instructions: VOTE_INSTRUCTIONS, input: { recipient: recipientName, ideas: withEvidence } },
      looseVotes,
    );
    const byRef = new Map(ideas.map((idea) => [idea.ref, idea]));
    const out: TwinVoteCast[] = [];
    for (const candidate of raw.votes) {
      const parsed = twinVoteSchema.safeParse(candidate);
      const idea = parsed.success ? byRef.get(parsed.data.ideaRef) : undefined;
      if (!parsed.success || !idea || !isShareableConfidence(parsed.data.confidence) || !isCoherentNote(parsed.data.text)) continue;
      const reconciled = reconcileVote(parsed.data, idea);
      if (reconciled) out.push(reconciled);
    }
    return out.slice(0, TWIN_LIMITS.votesPerRun);
  } catch {
    return fallback;
  }
}
