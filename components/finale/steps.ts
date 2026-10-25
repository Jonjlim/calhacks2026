/** The last steps of the game, derived from the shared simulated checkout, so every device agrees where the group is. */
export type Step = "plan" | "checkout" | "wrap" | "end";

export function finaleStepOf(status: string | undefined): Step {
  if (status === "wrapped") return "end";
  if (status === "complete") return "wrap";
  if (status === "ready" || status === "collecting") return "checkout";
  return "plan";
}
