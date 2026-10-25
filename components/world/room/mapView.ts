/**
 * Pan and zoom for the gift map (D19). The map component writes the target
 * when someone drags the sky or scrolls; the camera eases toward it each
 * frame. Presentation only: nothing here is shared with the room.
 */

const PAN_X = 30;
const PAN_Z = 22;
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 1.6;
/** How far the view may tilt from its default angle, in radians: up toward overhead, down toward the horizon. */
const TILT_UP = 0.5;
const TILT_DOWN = 0.42;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface MapViewState {
  x: number;
  z: number;
  /** 1 is the default framing; smaller is closer. */
  zoom: number;
  /** Turn around the present, in radians. */
  yaw: number;
  /** Tilt from the default angle, in radians: positive looks more from above. */
  tilt: number;
}

class MapView {
  target: MapViewState = { x: 0, z: 0, zoom: 1, yaw: 0, tilt: 0 };
  current: MapViewState = { x: 0, z: 0, zoom: 1, yaw: 0, tilt: 0 };
  /** While a finger or mouse is dragging the sky, the view follows it closely instead of easing. */
  dragging = false;

  /** Moves the view by screen-relative amounts: right and toward the viewer, turned with the camera. */
  pan(dx: number, dz: number) {
    const c = Math.cos(this.target.yaw);
    const s = Math.sin(this.target.yaw);
    this.target.x = clamp(this.target.x + dx * c + dz * s, -PAN_X, PAN_X);
    this.target.z = clamp(this.target.z - dx * s + dz * c, -PAN_Z, PAN_Z);
  }

  /** Turns the camera around the present and tilts it, within limits. */
  orbit(dYaw: number, dTilt: number) {
    this.target.yaw += dYaw;
    this.target.tilt = clamp(this.target.tilt + dTilt, -TILT_DOWN, TILT_UP);
  }

  zoomBy(factor: number) {
    this.target.zoom = clamp(this.target.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  }

  /** Back to the default framing. `instant` also snaps the eased value. */
  reset(instant = false) {
    // Turn back the short way round.
    const turns = Math.round(this.current.yaw / (Math.PI * 2));
    this.current.yaw -= turns * Math.PI * 2;
    this.target = { x: 0, z: 0, zoom: 1, yaw: 0, tilt: 0 };
    if (instant) this.current = { ...this.target };
  }

  /** Eases the current view toward the target; returns it. */
  step(dt: number, reducedMotion: boolean): MapViewState {
    const k = reducedMotion ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 9);
    const pan = this.dragging ? 1 : k;
    this.current.x += (this.target.x - this.current.x) * pan;
    this.current.z += (this.target.z - this.current.z) * pan;
    this.current.zoom += (this.target.zoom - this.current.zoom) * k;
    this.current.yaw += (this.target.yaw - this.current.yaw) * pan;
    this.current.tilt += (this.target.tilt - this.current.tilt) * pan;
    return this.current;
  }
}

export const mapView = new MapView();
