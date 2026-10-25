/** Explicit opt-in only. Uses a generated shape, never an actual person's photograph. */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { configuredModel } from "../agents/model";
import { proposePhotoClues, readPhoto } from "../agents/photo";
import { photoObservationSchema } from "../../lib/validation";

const enabled = process.env.UNWRAP_BITDEER_APP_SMOKE === "1";
describe.skipIf(!enabled)("LIVE Bitdeer through Unwrap's photo schema (synthetic image)", () => {
  it("reads an unmarked image into the real schema without inventing recipient activity or certain ownership", async () => {
    expect(process.env.LLM_BASE_URL).toBe("https://api-inference.bitdeer.ai/v1");
    expect(process.env.LLM_API_KEY?.trim()).toBeTruthy();
    const base64 = (await readFile(new URL("./fixtures/bitdeer-shape.png", import.meta.url))).toString("base64");
    const observation = await readPhoto({ mediaIndex: 0, image: { mediaType: "image/png", base64 } }, configuredModel());
    expect(photoObservationSchema.safeParse(observation).success).toBe(true);
    expect(observation.recipientActivity).toBeUndefined();
    expect(observation.visibleItems?.some(item => item.owned === "likely") ?? false).toBe(false);
    const clues = proposePhotoClues([observation]);
    expect(clues.every(clue => clue.kind === "uncertain" && clue.confidence <= 0.3)).toBe(true);
  }, 60_000);
});
