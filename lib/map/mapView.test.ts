import { beforeEach, describe, expect, it } from "vitest";
import { mapView, PITCH_MAX, PITCH_MIN } from "@/components/world/room/mapView";

describe("map camera state", () => {
  beforeEach(() => {
    mapView.locked = false;
    mapView.reset(true);
  });

  it("orbits freely round and clamps the tilt", () => {
    mapView.orbit(7, 0);
    expect(mapView.target.yaw).toBe(7);
    mapView.orbit(0, 5);
    expect(mapView.target.pitch).toBe(PITCH_MAX);
    mapView.orbit(0, -9);
    expect(mapView.target.pitch).toBe(PITCH_MIN);
  });

  it("keeps zoom and pan inside the world", () => {
    mapView.zoomBy(0.001);
    expect(mapView.target.zoom).toBeGreaterThan(0.2);
    mapView.zoomBy(1e6);
    expect(mapView.target.zoom).toBeLessThanOrEqual(1.6);
    mapView.pan(500, -500);
    expect(Math.abs(mapView.target.x)).toBeLessThanOrEqual(36);
    expect(Math.abs(mapView.target.z)).toBeLessThanOrEqual(28);
  });

  it("pans along the screen whatever the bearing", () => {
    mapView.orbit(Math.PI / 2, 0);
    mapView.panScreen(0, 3);
    // Looking along the world's x axis, "forward" is a move in x.
    expect(Math.abs(mapView.target.x)).toBeCloseTo(3, 5);
    expect(Math.abs(mapView.target.z)).toBeLessThan(1e-9);
  });

  it("focuses an island keeping the viewer's angle, and returns home", () => {
    mapView.orbit(1.2, 0.1);
    mapView.focus(10, -6);
    expect(mapView.target).toMatchObject({ x: 10, z: -6, yaw: 1.2 });
    expect(mapView.away).toBe(true);
    mapView.reset();
    expect(mapView.target).toMatchObject({ x: 0, z: 0, zoom: 1, yaw: 0, pitch: 0 });
    expect(mapView.away).toBe(false);
  });

  it("ignores everything while the gift reveal owns the camera", () => {
    mapView.locked = true;
    mapView.orbit(2, 0.3);
    mapView.zoomBy(0.5);
    mapView.focus(5, 5);
    mapView.preset(3);
    expect(mapView.target).toMatchObject({ x: 0, z: 0, zoom: 1, yaw: 0, pitch: 0 });
  });

  it("eases toward the target, and snaps when asked", () => {
    mapView.orbit(1, 0);
    const first = mapView.step(0.016, false).yaw;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(1);
    expect(mapView.step(0.016, true).yaw).toBe(1);
  });
  it("flies toward the actual gift continuously and arrives after the authored duration", () => {
    mapView.focusGift(10, 7);
    expect(mapView.current.zoom).toBe(1); // setting the target never cuts the camera
    for (let i = 0; i < 36; i++) mapView.step(1 / 60, false);
    expect(mapView.current.zoom).toBeCloseTo(0.62, 5);
    expect(mapView.current.x).toBeCloseTo(5, 5);
    expect(mapView.giftArrived).toBe(false);
    for (let i = 0; i < 40; i++) mapView.step(1 / 60, false);
    expect(mapView.current).toMatchObject({ x: 10, z: 6, zoom: 0.24, lift: 3.7, giftFocus: 1 });
    expect(mapView.giftArrived).toBe(true);
  });

  it("returns to the previous framing and honors reduced motion", () => {
    mapView.focus(4, -2, 0.8);
    mapView.orbit(0.4, 0.1);
    const previous = { ...mapView.step(0.016, true) };
    mapView.focusGift(12, 5);
    mapView.step(0.016, true);
    expect(mapView.giftArrived).toBe(true);
    mapView.returnFromGift();
    expect(mapView.step(0.016, true)).toEqual(previous);
    expect(mapView.giftArrived).toBe(false);
  });

});
