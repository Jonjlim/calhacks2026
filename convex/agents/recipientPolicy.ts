import { z } from "zod";
import type {
  AgentReply,
  RecipientGrant,
  RecipientPreference,
} from "../../lib/contracts";
import { agentQuerySchema, recipientVerdictSchema } from "../../lib/validation";
import { BASE_INSTRUCTIONS } from "./engine";
import { AgentFailure, validatedModelCall, type ModelTransport } from "./model";

export const RECIPIENT_GUIDANCE = {
  yes: "The recipient agent found support for this direction in approved preferences.",
  no: "The recipient agent recommends avoiding this direction based on approved preferences.",
  mixed:
    "The recipient agent found both support and reservations; consider another direction or ask a friend.",
} as const;

/** Select first; unauthorized and non-disclosable preference text never enters the model. */
export async function answerRecipientQuery(
  raw: unknown,
  context: {
    roomId: string;
    jobId: string;
    profileId: string;
    preferences: RecipientPreference[];
    grants: RecipientGrant[];
  },
  model: ModelTransport,
): Promise<AgentReply> {
  const parsed = agentQuerySchema.safeParse(raw);
  const refuse = (reason: string): AgentReply => ({
    queryId: parsed.success ? parsed.data.id : "invalid",
    status: "refused",
    usedPreferenceIds: [],
    policy: { allowed: false, reason },
  });
  if (!parsed.success) return refuse("out_of_policy");
  const query = parsed.data;
  if (query.roomId !== context.roomId || query.askedByJobId !== context.jobId)
    return refuse("wrong_scope");
  const grants = context.grants.filter(
    (g) =>
      g.recipientProfileId === context.profileId &&
      g.allowedQuestionTypes.includes(query.type),
  );
  if (!grants.length) return refuse("category_not_granted");
  const categories = new Set(grants.map((g) => g.category));
  const preferences = context.preferences.filter(
    (p) =>
      p.recipientProfileId === context.profileId &&
      p.authorized &&
      p.disclosable &&
      categories.has(p.category),
  );
  const unknown = (): AgentReply => ({
    queryId: query.id,
    status: "unknown",
    usedPreferenceIds: [],
    policy: { allowed: true },
  });
  if (!preferences.length) return unknown();
  const verdict = await validatedModelCall(
    model,
    {
      role: "recipient",
      instructions:
        BASE_INSTRUCTIONS +
        "\nYou represent the recipient. Assess only the supplied subject using the explicitly disclosable preferences. You cannot see buyer chat. Return yes/no/mixed, or unknown if these records do not establish relevance. Cite only supplied preference IDs. No free text or extra fields. Match outputSchema.",
      input: {
        question: { type: query.type, subject: query.subject },
        preferences: preferences.map((p) => ({
          id: p.id,
          category: p.category,
          text: p.text,
        })),
        outputSchema: z.toJSONSchema(recipientVerdictSchema),
      },
    },
    recipientVerdictSchema,
  );
  if (verdict.suitability === "unknown") return unknown();
  const ids = new Set(preferences.map((p) => p.id));
  if (
    !verdict.usedPreferenceIds.length ||
    verdict.usedPreferenceIds.some((id) => !ids.has(id))
  ) {
    throw new AgentFailure(
      "validation_failed",
      "Recipient verdict referenced unavailable preferences.",
    );
  }
  const guidance = RECIPIENT_GUIDANCE[verdict.suitability];
  return {
    queryId: query.id,
    status: "answered",
    suitability: verdict.suitability,
    guidance,
    usedPreferenceIds: verdict.usedPreferenceIds,
    policy: { allowed: true },
  };
}
