/** Tiny in-scene event bus so ambient characters can react to the gift. Visual only; never app state. */
type Listener = () => void;

const giftPopListeners = new Set<Listener>();

export function onGiftPop(fn: Listener): () => void {
  giftPopListeners.add(fn);
  return () => giftPopListeners.delete(fn);
}

export function emitGiftPop() {
  giftPopListeners.forEach((fn) => fn());
}
