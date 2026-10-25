/**
 * Where the parchment invitation sits, shared by the DOM card and the 3D
 * flying tag so the hand-off between them lands on the same pixels. Pure
 * numbers (no Three.js), in CSS px.
 */

/** Share of the viewport the 3D world keeps; the parchment takes the rest. */
export const WORLD_SHARE = 0.67;
/** Height / width of the small hanging tag (see giftTag/GiftTag). */
export const TAG_ASPECT = 0.52 / 0.4;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Desktop and landscape tablets get the side-by-side composition. */
export const isWideLayout = (vw: number, vh: number) => vw / Math.max(1, vh) >= 1.15;

/** The settled invitation: a tall tag centred in the right third (or a sheet along the bottom on narrow screens). */
export function parchmentRect(vw: number, vh: number): Rect {
  if (isWideLayout(vw, vh)) {
    const region = vw * (1 - WORLD_SHARE);
    const margin = Math.min(40, Math.max(16, vw * 0.02));
    const w = Math.min(region - margin * 1.5, 520);
    const h = Math.min(vh - 2 * Math.max(18, vh * 0.035), w * 1.85);
    return { x: vw * WORLD_SHARE + (region - w) / 2 - margin * 0.25, y: (vh - h) / 2, w, h };
  }
  const w = Math.min(vw - 32, 440);
  const h = Math.min(vh * 0.55, 620);
  return { x: (vw - w) / 2, y: vh - h - 16, w, h };
}

/** Where the flying 3D tag hands over: a smaller tag, same proportions as the hanging one, inside the final card. */
export function handoffRect(vw: number, vh: number): Rect {
  const p = parchmentRect(vw, vh);
  const w = p.w * 0.42;
  const h = w * TAG_ASPECT;
  return { x: p.x + (p.w - w) / 2, y: p.y + p.h * 0.4 - h / 2, w, h };
}
