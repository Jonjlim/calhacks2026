import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mapView } from "@/components/world/room/mapView";
beforeEach(() => { mapView.locked = false; mapView.dragging = false; mapView.reset(true); });
afterEach(() => { mapView.locked = false; mapView.dragging = false; mapView.reset(true); });
describe("guided room camera", () => {
  it("leaves camera ownership with an active reveal or user drag", () => {
    mapView.locked = true;
    mapView.focus(12, 11, 0.4);
    expect(mapView.target.x).toBe(0);
    mapView.locked = false;
    mapView.dragging = true;
    mapView.focus(12, 11, 0.4);
    expect(mapView.target.x).toBe(0);
  });
  it("snaps guided framing for reduced motion", () => {
    mapView.focus(12, 11, 0.4, -0.2);
    expect(mapView.step(0.016, true)).toEqual(mapView.target);
  });
  it("restores cinematic composition and tracks a user's takeover", () => {
    const interaction = mapView.interaction;
    mapView.focus(12, 11, 0.24, -0.55, { tilt: -0.48, lift: 3.1, shiftX: -0.17 });
    mapView.step(0.016, true);
    expect(mapView.framing).toEqual({ lift: 3.1, shiftX: -0.17 });
    mapView.orbit(0.1, 0);
    expect(mapView.interaction).toBeGreaterThan(interaction);
    mapView.reset(true);
    expect(mapView.framing).toEqual({ lift: 0, shiftX: 0 });
  });
  it("lets a gesture override the guide and returns to the regular map", () => {
    mapView.focus(12, 11, 0.4);
    mapView.pan(2, 0);
    expect(mapView.target.x).toBeGreaterThan(12);
    mapView.reset(true);
    expect(mapView.current).toEqual({ x: 0, z: 0, zoom: 1, yaw: 0, tilt: 0 });
  });
});
