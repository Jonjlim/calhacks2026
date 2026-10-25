import { useSyncExternalStore } from "react";
import { playBookOpen } from "@/components/world/sfx";

/**
 * The Book of Possibilities: open or shut, and what it was opened for. Local
 * presentation only. The 3D book on its stand and the HTML catalogue both read
 * this, so they open and close as one object. Nothing here is room data.
 */
type Listener = () => void;

/** The 3D book lifts and opens for this long before the pages take over. */
export const BOOK_OPEN_MS = 900;
/** And folds back down for this long once the pages are closed. */
export const BOOK_CLOSE_MS = 650;

class BookStore {
  open = false;
  openedAt = -1e9;
  closedAt = -1e9;
  /** The theme the book was opened from (a label), to choose its illustrations. */
  theme: string | null = null;
  /** A gift to open straight to. */
  listingId: string | null = null;
  /** Whether the long first-time drawing has already been seen this session. */
  seen = false;
  private listeners = new Set<Listener>();

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  show(opts: { theme?: string | null; listingId?: string | null } = {}) {
    if (this.open) return;
    this.open = true;
    this.openedAt = performance.now();
    this.theme = opts.theme ?? null;
    this.listingId = opts.listingId ?? null;
    playBookOpen();
    this.emit();
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.closedAt = performance.now();
    this.emit();
  }

  markSeen() {
    this.seen = true;
  }

  /** 0 shut on its stand, 1 raised and open: the 3D book's pose. */
  progress(now = performance.now()): number {
    const ease = (k: number) => k * k * (3 - 2 * k);
    if (this.open) return ease(Math.min(1, (now - this.openedAt) / BOOK_OPEN_MS));
    return 1 - ease(Math.min(1, (now - this.closedAt) / BOOK_CLOSE_MS));
  }
}

export const book = new BookStore();

export function useBookOpen(): boolean {
  return useSyncExternalStore(book.subscribe, () => book.open, () => false);
}

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __book?: BookStore }).__book = book;
}
