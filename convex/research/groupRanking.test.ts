import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import { mockListings } from "../../lib/mocks/fixtures";
import { questionSupport, steerRanked, type RoomSteering } from "./groupRanking";

const hiking = { ...mockListings[0]!, id: "trail", title: "Day hiking backpack" };
const coffee = { ...mockListings[1]!, id: "cup", title: "Coffee mug" };
const base: RoomSteering = {
  giftNet: new Map(), polls: [{ directionId: "direction-a" as Id<"mapDirections">,
    options: [{ label: "Coffee", clue: "Likes coffee", listingIds: [] }],
    ballots: [{ participantId: "member" as Id<"participants">, option: 0, updatedAt: 1 }],
  }],
};
describe("question support stays separate from evidence and scoped to its direction", () => {
  it("boosts literal option matches only in the relevant direction, preserving scores", () => {
    expect(questionSupport(coffee, base, "direction-a")).toBe(1);
    expect(questionSupport(coffee, base, "direction-b")).toBe(0);
    const rows = [{ listingId: "trail", score: 0.9 }, { listingId: "cup", score: 0.2 }];
    const result = steerRanked(rows, [hiking, coffee], base, new Map([["trail", "direction-b"], ["cup", "direction-a"]]));
    expect(result.map(r => r.listingId)).toEqual(["cup", "trail"]);
    expect(result[0]?.score).toBe(0.2);
  });
  it.each(["Does not like coffee", "Doesn’t like coffee", "Don't like coffee"])("does not interpret a negated preference as a positive match: %s", clue => {
    const steering: RoomSteering = { giftNet: new Map(), polls: [{ ...base.polls[0]!, options: [{ label: "No coffee", clue, listingIds: [] }] }] };
    expect(questionSupport(coffee, steering, "direction-a")).toBe(0);
  });
});

it("human votes override even a much stronger AI score and withdrawal restores the order", () => {
  const rows = [{ listingId: "trail", score: 0.99 }, { listingId: "cup", score: 0.01 }];
  const steering = { giftNet: new Map([["cup", 1]]), polls: [] };
  expect(steerRanked(rows, [hiking, coffee], steering).map(r => r.listingId)).toEqual(["cup", "trail"]);
  steering.giftNet = new Map([["trail", -1]]);
  expect(steerRanked(rows, [hiking, coffee], steering)[0]?.listingId).toBe("cup");
  steering.giftNet.clear();
  expect(steerRanked(rows, [hiking, coffee], steering)[0]?.listingId).toBe("trail");
});
