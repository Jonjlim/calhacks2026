/** Manual check: `npx convex run agents/smoke:extractSynthetic`. Synthetic data only; one paid model call. */
import { internalAction } from "../_generated/server";
import { extractEvidence } from "./engine";
import { configuredModel } from "./model";

export const extractSynthetic = internalAction({
  args: {},
  handler: async () => {
    const result = await extractEvidence(
      {
        sourceId: "synthetic-source",
        messages: [
          {
            id: "synthetic-message",
            speakerHint: "recipient",
            body: "I would love to take a beginner pottery class this year.",
          },
        ],
        publishedClues: [],
      },
      configuredModel(),
    );
    return {
      clueCount: result.clues.length,
      grounded: result.clues.every((c) =>
        c.sourceMessageIds.includes("synthetic-message"),
      ),
      kinds: result.clues.map((c) => c.kind),
    };
  },
});
