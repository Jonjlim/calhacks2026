import type { GiftSelection, Result } from "@/lib/contracts";
import type { RoomActions } from "@/components/room/types";

export function giftIsInBox(selection: GiftSelection | null, listingId: string): boolean {
  return selection?.status === "active" && (selection.items?.some((item) => item.listingId === listingId) ?? selection.listingId === listingId);
}

/** Old deployments may select the first item, but must never replace a collection by accident. */
export function addToGiftBox(actions: Pick<RoomActions, "addGiftToBox" | "selectGift">, selection: GiftSelection | null, listingId: string): Promise<Result<unknown>> {
  if (giftIsInBox(selection, listingId)) return Promise.resolve({ ok: true, value: null });
  if (actions.addGiftToBox) return actions.addGiftToBox(listingId);
  if (selection?.status === "active") return Promise.resolve({ ok: false, error: { code: "invalid_revision", message: "This room cannot add another gift yet. Your current box is safe. Please update the app before adding more." } });
  return actions.selectGift(listingId);
}
