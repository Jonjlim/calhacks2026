/**
 * Pan and zoom for the gift map (D19). The map component writes the target
 * when someone drags the sky or scrolls; the camera eases toward it each
 * frame. Presentation only: nothing here is shared with the room.
 */

const PAN_X = 30;
const PAN_Z = 22;
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 1.6;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface MapViewState {
  x: number;
  z: number;
  /** 1 is the default framing; smaller is closer. */
  zoom: number;
}

class MapView {
  target: MapViewState = { x: 0, z: 0, zoom: 1 };
  current: MapViewState = { x: 0, z: 0, zoom: 1 };

  pan(dx: number, dz: number) {
    this.target.x = clamp(this.target.x + dx, -PAN_X, PAN_X);
    this.target.z = clamp(this.target.z + dz, -PAN_Z, PAN_Z);
  }

  zoomBy(factor: number) {
    this.target.zoom = clamp(this.target.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  }

  /** Back to the default framing. `instant` also snaps the eased value. */
  reset(instant = false) {
    this.target = { x: 0, z: 0, zoom: 1 };
    if (instant) this.current = { ...this.target };
  }

  /** Eases the current view toward the target; returns it. */
  step(dt: number, reducedMotion: boolean): MapViewState {
    const k = reducedMotion ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 7);
    this.current.x += (this.target.x - this.current.x) * k;
    this.current.z += (this.target.z - this.current.z) * k;
    this.current.zoom += (this.target.zoom - this.current.zoom) * k;
    return this.current;
  }
}

export const mapView = new MapView();
