/**
 * The gift map's camera state (D19). The map component writes targets when
 * someone drags, scrolls, presses a key or focuses an island; the camera eases
 * toward them each frame. Presentation only: nothing here is shared with the
 * room.
 *
 * The camera orbits a focus point on the map: `x`/`z` move that point,
 * `zoom` scales the distance to it, `yaw` swings round it and `pitch` tilts
 * the view up or down (as offsets from the default composition).
 */

const PAN_X = 36;
const PAN_Z = 28;
const ZOOM_MIN = 0.22;
const ZOOM_MAX = 1.6;
/** Offsets from the default elevation, in radians (the default is about 53 degrees). */
export const PITCH_MIN = -0.72;
export const PITCH_MAX = 0.5;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface MapViewState {
  x: number;
  z: number;
  /** 1 is the default framing; smaller is closer. */
  zoom: number;
  yaw: number;
  pitch: number;
  /** Lift and centered framing for a real gift close-up. */
  lift: number;
  giftFocus: number;
}

const HOME: MapViewState = { x: 0, z: 0, zoom: 1, yaw: 0, pitch: 0, lift: 0, giftFocus: 0 };

class MapView {
  target: MapViewState = { ...HOME };
  current: MapViewState = { ...HOME };
  /** While a finger or mouse is dragging the sky, the view follows it exactly instead of easing. */
  dragging = false;
  /** The gift reveal owns the camera: nothing moves the map meanwhile. */
  locked = false;
  /** Slower easing for scripted moves (focusing an island), so they glide for a second or two. */
  private gliding = false;
  private flight: { from: MapViewState; elapsed: number; duration: number } | null = null;
  private beforeGift: MapViewState | null = null;
  get giftArrived(): boolean { return this.target.giftFocus === 1 && this.flight === null; }

  private listeners = new Set<() => void>();

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  /** True when the camera is somewhere other than the default overview. */
  get away(): boolean {
    const t = this.target;
    return Math.hypot(t.x, t.z) > 0.5 || Math.abs(t.zoom - 1) > 0.02 || Math.abs(t.yaw) > 0.02 || Math.abs(t.pitch) > 0.02;
  }

  /** Moves the focus point in world axes. */
  pan(dx: number, dz: number) {
    if (this.locked) return;
    this.flight = null;
    this.gliding = false;
    this.target.x = clamp(this.target.x + dx, -PAN_X, PAN_X);
    this.target.z = clamp(this.target.z + dz, -PAN_Z, PAN_Z);
    this.emit();
  }

  /** Moves the focus point along the screen: `right` px-scaled units across, `away` units into the scene. */
  panScreen(right: number, away: number) {
    const y = this.target.yaw;
    this.pan(Math.cos(y) * right - Math.sin(y) * away, -Math.sin(y) * right - Math.cos(y) * away);
  }

  zoomBy(factor: number) {
    if (this.locked) return;
    this.flight = null;
    this.gliding = false;
    this.target.zoom = clamp(this.target.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    this.emit();
  }

  orbit(dYaw: number, dPitch: number) {
    if (this.locked) return;
    this.flight = null;
    this.gliding = false;
    this.target.yaw += dYaw;
    this.target.pitch = clamp(this.target.pitch + dPitch, PITCH_MIN, PITCH_MAX);
    this.emit();
  }

  /**
   * Glides to look at a point on the map (an offset from the present): the
   * orbit angles are kept, so the viewer keeps their bearings.
   */
  focus(x: number, z: number, zoom = 0.55) {
    if (this.locked) return;
    this.flight = null;
    this.beforeGift = null;
    this.gliding = true;
    this.target.lift = 0;
    this.target.giftFocus = 0;
    this.target.x = clamp(x, -PAN_X, PAN_X);
    this.target.z = clamp(z, -PAN_Z, PAN_Z);
    this.target.zoom = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
    this.emit();
  }

  /** A finite camera dolly: the real island grows continuously under the viewer. */
  focusGift(x: number, z: number) {
    if (this.locked) return;
    const previous = this.beforeGift ?? { ...this.current };
    this.focus(x, z - 1, 0.24);
    this.beforeGift = previous;
    this.target.lift = 3.7; // map target is 2 below the island; gift is 1.7 above it
    this.target.giftFocus = 1;
    this.flight = { from: { ...this.current }, elapsed: 0, duration: 1.2 };
  }

  trackGift(x: number, z: number) {
    if (this.locked || this.target.giftFocus !== 1) return;
    this.target.x = clamp(x, -PAN_X, PAN_X);
    this.target.z = clamp(z - 1, -PAN_Z, PAN_Z);
    this.gliding = true;
  }

  returnFromGift() {
    if (this.locked) return;
    const to = this.beforeGift ?? { ...HOME };
    this.beforeGift = null;
    this.target = { ...to };
    this.flight = { from: { ...this.current }, elapsed: 0, duration: 0.9 };
  }

  /**
   * Three named viewpoints: 1 a high overview (about 66 degrees), 2 a
   * three-quarter exploring view (about 40) and 3 a low cinematic one (about
   * 20) that shows island thickness, waterfalls and the far kingdom. The
   * default framing sits near 53 degrees.
   */
  preset(view: 1 | 2 | 3) {
    if (this.locked) return;
    this.gliding = true;
    this.target.pitch = clamp({ 1: 0.22, 2: -0.23, 3: -0.58 }[view], PITCH_MIN, PITCH_MAX);
    this.emit();
  }

  /** Back to the default overview. `instant` also snaps the eased value. */
  reset(instant = false) {
    this.flight = null;
    this.beforeGift = null;
    this.gliding = !instant;
    this.target = { ...HOME };
    if (instant) this.current = { ...HOME };
    this.emit();
  }

  /** Eases the current view toward the target; returns it. */
  step(dt: number, reducedMotion: boolean): MapViewState {
    if (this.flight) {
      const flight = this.flight;
      flight.elapsed += Math.max(0, Math.min(dt, 0.1));
      const t = reducedMotion ? 1 : Math.min(1, flight.elapsed / flight.duration);
      const eased = t * t * t * (t * (t * 6 - 15) + 10);
      for (const key of Object.keys(HOME) as (keyof MapViewState)[]) {
        this.current[key] = flight.from[key] + (this.target[key] - flight.from[key]) * eased;
      }
      if (t === 1) { this.flight = null; this.gliding = false; }
      return this.current;
    }
    const rate = this.gliding ? 3.2 : 9;
    const k = reducedMotion ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * rate);
    const follow = this.dragging ? 1 : k;
    const c = this.current;
    const t = this.target;
    c.x += (t.x - c.x) * follow;
    c.z += (t.z - c.z) * follow;
    c.zoom += (t.zoom - c.zoom) * k;
    c.yaw += (t.yaw - c.yaw) * follow;
    c.pitch += (t.pitch - c.pitch) * follow;
    c.lift += (t.lift - c.lift) * k;
    c.giftFocus += (t.giftFocus - c.giftFocus) * k;
    if (this.gliding && Math.abs(t.x - c.x) + Math.abs(t.z - c.z) + Math.abs(t.zoom - c.zoom) + Math.abs(t.yaw - c.yaw) + Math.abs(t.pitch - c.pitch) < 0.02) this.gliding = false;
    return c;
  }
}

export const mapView = new MapView();
