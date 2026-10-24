/**
 * Tool allowlists per agent role. Owner: Dev 3 (AI-010).
 * Access is enforced here and in Convex auth checks, never by prompts.
 * Tool names the model requests outside these lists are ignored.
 */

export type AgentRole = "buyer" | "extractor" | "recipient";

export type AgentToolName =
  | "getRoomSnapshot"
  | "listAskedSlots"
  | "startResearch"
  | "getListings"
  | "queryRecipientAgent"
  | "getOwnEvidence"
  | "proposeClues"
  | "getAuthorizedPreferences";

export function toolsFor(
  role: AgentRole,
  options: { recipientAgentEnabled: boolean } = { recipientAgentEnabled: false },
): readonly AgentToolName[] {
  switch (role) {
    case "buyer":
      return [
        "getRoomSnapshot",
        "listAskedSlots",
        "startResearch",
        "getListings",
        ...(options.recipientAgentEnabled ? (["queryRecipientAgent"] as const) : []),
      ];
    case "extractor":
      return ["getOwnEvidence", "proposeClues"];
    case "recipient":
      return ["getAuthorizedPreferences"];
  }
}
