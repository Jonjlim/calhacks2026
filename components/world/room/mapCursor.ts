/**
 * What the pointer would do on the gift map right now. The map writes it on
 * hover; the room's following cursor reads it to change its label. Local to
 * this browser.
 */
export type MapCursorMode = "memory" | "gift" | "box" | "node" | "pan" | "drag" | "ui";

type Listener = (mode: MapCursorMode) => void;

class MapCursor {
  mode: MapCursorMode = "memory";
  private listeners = new Set<Listener>();

  set(mode: MapCursorMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.listeners.forEach((fn) => fn(mode));
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}

export const mapCursor = new MapCursor();
