/**
 * QR module grid for the invitation card. `true` = dark module.
 *
 * The animation and the HTML fallback only consume a square boolean grid, so
 * a real encoder can replace `mockQrModules` later (e.g. `realQrModules(url)`)
 * without touching the unwrapping sequence.
 *
 * This mock is decorative: finder, timing and alignment patterns make it read
 * as a QR code, but the "data" area is seeded noise and encodes nothing —
 * deliberately no URL, so it can never point anywhere.
 */
export type QrModules = boolean[][];

export const MOCK_QR_SIZE = 25;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mockQrModules(seedText: string, size = MOCK_QR_SIZE): QrModules {
  const grid: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const finder = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r++)
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r;
        const cc = c0 + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        reserved[rr]![cc] = true;
        const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        grid[rr]![cc] = r >= 0 && r <= 6 && c >= 0 && c <= 6 && ring !== 2;
      }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) {
    grid[6]![i] = grid[i]![6] = i % 2 === 0;
    reserved[6]![i] = reserved[i]![6] = true;
  }
  const a = size - 9;
  for (let r = -2; r <= 2; r++)
    for (let c = -2; c <= 2; c++) {
      reserved[a + r]![a + c] = true;
      grid[a + r]![a + c] = Math.max(Math.abs(r), Math.abs(c)) !== 1;
    }
  const rand = rng(hash(seedText));
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!reserved[r]![c]) grid[r]![c] = rand() < 0.47;
  return grid;
}
