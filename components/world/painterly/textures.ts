import * as THREE from "three";
import { mulberry32 } from "./noise";

/**
 * Hand-painted textures generated on a canvas at runtime. Each is built from
 * many small brush dabs and pencil strokes rather than photographic noise, so
 * the 3D surfaces read as gouache/watercolour. Results are cached per key.
 */

type Ctx = CanvasRenderingContext2D;
type Rng = () => number;

const cache = new Map<string, THREE.Texture>();

function cached(key: string, build: () => THREE.Texture): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const tex = build();
  cache.set(key, tex);
  return tex;
}

function canvas(w: number, h = w): [HTMLCanvasElement, Ctx] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return [c, ctx];
}

function finish(c: HTMLCanvasElement, repeat = true, colorSpace = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  if (colorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

const pick = <T,>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;

/** Draws `fn` at every wrapped offset so strokes crossing an edge tile cleanly. */
function tiled(size: number, x: number, y: number, fn: (x: number, y: number) => void) {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      const px = x + ox;
      const py = y + oy;
      if (px > -size * 0.25 && px < size * 1.25 && py > -size * 0.25 && py < size * 1.25) fn(px, py);
    }
  }
}

function dab(ctx: Ctx, x: number, y: number, rx: number, ry: number, angle: number, color: string, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A slightly wobbly pencil line between two points. */
function pencil(ctx: Ctx, rng: Rng, pts: [number, number][], color: string, width: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const jx = x + (rng() - 0.5) * width * 0.9;
    const jy = y + (rng() - 0.5) * width * 0.9;
    if (i === 0) ctx.moveTo(jx, jy);
    else ctx.lineTo(jx, jy);
  });
  ctx.stroke();
  ctx.restore();
}

function paperGrain(ctx: Ctx, rng: Rng, size: number, count: number, alpha: number) {
  for (let i = 0; i < count; i++) {
    const v = rng() > 0.5 ? "#ffffff" : "#5a4a3a";
    ctx.globalAlpha = alpha * rng();
    ctx.fillStyle = v;
    ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 1.5, 1 + rng() * 1.5);
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------

/** Soft-step toon ramp: plateaus with blurred transitions, like gouache shading. */
export function toonRamp(): THREE.DataTexture {
  return cached("ramp", () => {
    const steps = [0.42, 0.66, 0.86, 1.0];
    const n = 64;
    const data = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const f = t * steps.length;
      const k = Math.min(steps.length - 1, Math.floor(f));
      const frac = f - k;
      const blend = Math.min(1, Math.max(0, (frac - 0.7) / 0.3));
      const next = steps[Math.min(steps.length - 1, k + 1)]!;
      const v = steps[k]! + (next - steps[k]!) * blend * blend;
      const b = Math.round(v * 255);
      data.set([b, b, b, 255], i * 4);
    }
    const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex as THREE.DataTexture;
  }) as THREE.DataTexture;
}

/** Grass painted with short directional strokes; tinted further by vertex colour. */
export function grassTexture(): THREE.Texture {
  return cached("grass", () => {
    const S = 512;
    const [c, ctx] = canvas(S);
    const rng = mulberry32(11);
    ctx.fillStyle = "#e9f0d6";
    ctx.fillRect(0, 0, S, S);
    const tones = ["#f6f8e4", "#dfe9c4", "#cddcb0", "#e8efcf", "#fffbe8", "#c4d6ab"];
    for (let i = 0; i < 2600; i++) {
      const x = rng() * S;
      const y = rng() * S;
      const len = 6 + rng() * 14;
      const col = pick(rng, tones);
      const a = -Math.PI / 2 + (rng() - 0.5) * 0.9;
      tiled(S, x, y, (px, py) => dab(ctx, px, py, len, 1.6 + rng() * 1.6, a, col, 0.55));
    }
    // A few darker clumps and warm sun flecks.
    for (let i = 0; i < 140; i++) {
      const x = rng() * S;
      const y = rng() * S;
      tiled(S, x, y, (px, py) => dab(ctx, px, py, 10 + rng() * 18, 6 + rng() * 8, rng() * 3, "#a9bf8f", 0.18));
    }
    for (let i = 0; i < 90; i++) {
      const x = rng() * S;
      const y = rng() * S;
      tiled(S, x, y, (px, py) => dab(ctx, px, py, 3, 3, 0, pick(rng, ["#fff6c8", "#ffffff", "#f7d9e4"]), 0.8));
    }
    paperGrain(ctx, rng, S, 3000, 0.12);
    return finish(c);
  });
}

/** Cliff strata: vertical rain streaks, pencil cracks, chalky highlights. */
export function cliffTexture(): THREE.Texture {
  return cached("cliff", () => {
    const S = 512;
    const [c, ctx] = canvas(S);
    const rng = mulberry32(23);
    ctx.fillStyle = "#efe6da";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      const x = rng() * S;
      const y = rng() * S;
      const col = pick(rng, ["#ffffff", "#e2d6c8", "#d6cbd9", "#f7efe2", "#cfc2b4"]);
      tiled(S, x, y, (px, py) => dab(ctx, px, py, 3 + rng() * 6, 12 + rng() * 34, (rng() - 0.5) * 0.25, col, 0.45));
    }
    // Rock facets: chunky angled planes with a lit top edge.
    for (let i = 0; i < 70; i++) {
      const x = rng() * S;
      const y = rng() * S;
      const w = 20 + rng() * 40;
      const h = 30 + rng() * 60;
      tiled(S, x, y, (px, py) => {
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = "#8f8199";
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + w, py + h * 0.2);
        ctx.lineTo(px + w * 0.8, py + h);
        ctx.lineTo(px - w * 0.15, py + h * 0.85);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = "#fffaf0";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + w, py + h * 0.2);
        ctx.stroke();
      });
    }
    for (let i = 0; i < 60; i++) {
      const x = rng() * S;
      const y = rng() * S;
      const pts: [number, number][] = [];
      let cx = x;
      let cy = y;
      for (let k = 0; k < 5; k++) {
        pts.push([cx, cy]);
        cx += (rng() - 0.5) * 14;
        cy += 8 + rng() * 14;
      }
      tiled(S, 0, 0, (ox, oy) =>
        pencil(ctx, rng, pts.map(([a, b]) => [a + ox, b + oy] as [number, number]), "#5b4a5e", 1.4, 0.35),
      );
    }
    paperGrain(ctx, rng, S, 3000, 0.14);
    return finish(c);
  });
}

/** Irregular paving stones with sketchy outlines and moss in the joints. */
export function stoneTexture(): THREE.Texture {
  return cached("stone", () => {
    const S = 512;
    const [c, ctx] = canvas(S);
    const rng = mulberry32(37);
    ctx.fillStyle = "#9fae86";
    ctx.fillRect(0, 0, S, S);
    const cells = 5;
    const cell = S / cells;
    for (let gy = 0; gy < cells; gy++) {
      for (let gx = 0; gx < cells; gx++) {
        const cx = gx * cell + cell / 2 + (rng() - 0.5) * cell * 0.2;
        const cy = gy * cell + cell / 2 + (rng() - 0.5) * cell * 0.2;
        const pts: [number, number][] = [];
        const n = 7 + Math.floor(rng() * 3);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          const r = cell * (0.38 + rng() * 0.1);
          pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        const base = pick(rng, ["#e9e0cf", "#ddd3c3", "#efe7d8", "#d8cdc4", "#e4dccf"]);
        tiled(S, 0, 0, (ox, oy) => {
          ctx.globalAlpha = 1;
          ctx.fillStyle = base;
          ctx.beginPath();
          pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + ox, y + oy) : ctx.moveTo(x + ox, y + oy)));
          ctx.closePath();
          ctx.fill();
          const g = ctx.createLinearGradient(cx + ox, cy + oy - cell * 0.4, cx + ox, cy + oy + cell * 0.4);
          g.addColorStop(0, "rgba(255,252,240,0.55)");
          g.addColorStop(1, "rgba(120,104,130,0.28)");
          ctx.fillStyle = g;
          ctx.fill();
        });
        for (let k = 0; k < 14; k++) {
          const x = cx + (rng() - 0.5) * cell * 0.6;
          const y = cy + (rng() - 0.5) * cell * 0.6;
          tiled(S, x, y, (px, py) => dab(ctx, px, py, 4 + rng() * 8, 2 + rng() * 3, rng() * 3, pick(rng, ["#c9bfb2", "#f6efe2", "#b8b0b8"]), 0.45));
        }
        tiled(S, 0, 0, (ox, oy) =>
          pencil(ctx, rng, [...pts, pts[0]!].map(([x, y]) => [x + ox, y + oy] as [number, number]), "#5a4a52", 2, 0.55),
        );
      }
    }
    for (let i = 0; i < 300; i++) {
      tiled(S, rng() * S, rng() * S, (px, py) => dab(ctx, px, py, 3 + rng() * 4, 2, rng() * 3, pick(rng, ["#7f9d5c", "#a6bf6e"]), 0.5));
    }
    paperGrain(ctx, rng, S, 2500, 0.12);
    return finish(c);
  });
}

/** Warm wood planks with grain strokes. */
export function woodTexture(): THREE.Texture {
  return cached("wood", () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    const rng = mulberry32(41);
    ctx.fillStyle = "#a9774f";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 260; i++) {
      const y = rng() * S;
      const x = rng() * S;
      const col = pick(rng, ["#c48f62", "#8c5f3f", "#b98256", "#d6a77a", "#7a5038"]);
      tiled(S, x, y, (px, py) => dab(ctx, px, py, 30 + rng() * 60, 1.5 + rng() * 2, (rng() - 0.5) * 0.05, col, 0.5));
    }
    for (let i = 0; i < 6; i++) {
      tiled(S, rng() * S, rng() * S, (px, py) => {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = "#5e3e2c";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(px, py, 8, 3, 0, 0, Math.PI * 2);
        ctx.stroke();
      });
    }
    paperGrain(ctx, rng, S, 1200, 0.15);
    return finish(c);
  });
}

/** Cream wrapping paper with gold stars, coral blossoms and soft fold creases. */
export function giftPaperTexture(): THREE.Texture {
  return cached("giftPaper", () => {
    const S = 1024;
    const [c, ctx] = canvas(S);
    const rng = mulberry32(53);
    ctx.fillStyle = "#f6ead2";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 260; i++) {
      tiled(S, rng() * S, rng() * S, (px, py) =>
        dab(ctx, px, py, 30 + rng() * 60, 20 + rng() * 30, rng() * 3, pick(rng, ["#fbf3e1", "#f1e0c2", "#f8ecd6"]), 0.28),
      );
    }
    const star = (x: number, y: number, r: number, color: string, a: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rng() * Math.PI);
      ctx.globalAlpha = a;
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const rr = k % 2 ? r * 0.42 : r;
        const ang = (k / 10) * Math.PI * 2;
        ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    const blossom = (x: number, y: number, r: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rng() * Math.PI);
      for (let k = 0; k < 5; k++) {
        ctx.rotate((Math.PI * 2) / 5);
        dab(ctx, r * 0.55, 0, r * 0.55, r * 0.33, 0, pick(rng, ["#e39a82", "#d98a74", "#eaa995"]), 0.85);
      }
      dab(ctx, 0, 0, r * 0.22, r * 0.22, 0, "#d9b66f", 0.95);
      ctx.restore();
    };
    // Motifs on a jittered grid so they read as a printed pattern.
    const grid = 6;
    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++) {
      const x = ((gx + 0.5 + (gy % 2) * 0.5) / grid) * S + (rng() - 0.5) * 30;
      const y = ((gy + 0.5) / grid) * S + (rng() - 0.5) * 30;
      const kind = (gx + gy) % 3 === 0 ? 0.9 : (gx + gy * 2) % 2 ? 0.3 : 0.6;
      tiled(S, x, y, (px, py) => {
        if (kind < 0.45) star(px, py, 26 + rng() * 10, "#d2a24c", 0.95);
        else if (kind < 0.8) blossom(px, py, 34 + rng() * 10);
        else {
          for (let k = 0; k < 5; k++) dab(ctx, px + (rng() - 0.5) * 44, py + (rng() - 0.5) * 44, 5, 5, 0, "#c99a4e", 0.85);
        }
      });
      }
    }
    // Hand-drawn swirl vines between motifs.
    for (let i = 0; i < 26; i++) {
      const x = rng() * S;
      const y = rng() * S;
      const pts: [number, number][] = [];
      for (let k = 0; k < 11; k++) pts.push([x + Math.cos(k * 0.7) * k * 7, y + Math.sin(k * 0.7) * k * 7]);
      tiled(S, 0, 0, (ox, oy) => pencil(ctx, rng, pts.map(([a, b]) => [a + ox, b + oy] as [number, number]), "#c3965c", 3.5, 0.6));
    }
    // Soft fold creases.
    for (let i = 0; i < 5; i++) {
      const x = rng() * S;
      ctx.globalAlpha = 0.1;
      ctx.strokeStyle = "#8f6d52";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (rng() - 0.5) * 120, S);
      ctx.stroke();
    }
    paperGrain(ctx, rng, S, 5000, 0.07);
    return finish(c);
  });
}

/** Coral satin ribbon: u runs along the ribbon, v across it. */
export function ribbonTexture(): THREE.Texture {
  return cached("ribbon", () => {
    const [c, ctx] = canvas(256, 64);
    const rng = mulberry32(61);
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, "#b4594a");
    g.addColorStop(0.12, "#d9786a");
    g.addColorStop(0.45, "#f0a08f");
    g.addColorStop(0.55, "#e78c7b");
    g.addColorStop(0.88, "#d9786a");
    g.addColorStop(1, "#b4594a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = "#e3bd73";
    ctx.globalAlpha = 0.9;
    ctx.fillRect(0, 7, 256, 2.5);
    ctx.fillRect(0, 54.5, 256, 2.5);
    for (let i = 0; i < 160; i++) dab(ctx, rng() * 256, 16 + rng() * 32, 10 + rng() * 20, 0.8, 0, "#ffd0c2", 0.2);
    const tex = finish(c);
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  });
}

/** Terracotta / slate roof shingles. */
export function roofTexture(key: "coral" | "slate" | "lilac"): THREE.Texture {
  return cached(`roof-${key}`, () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    const rng = mulberry32(key.length * 97);
    const palette = {
      coral: ["#c9705a", "#d98068", "#b85f4c", "#e39177"],
      slate: ["#6f7fb3", "#7d8fc4", "#62709f", "#8b9ccc"],
      lilac: ["#9d8fc4", "#ab9fd0", "#8f80b6", "#bcb0dc"],
    }[key];
    ctx.fillStyle = palette[0]!;
    ctx.fillRect(0, 0, S, S);
    const rows = 10;
    for (let r = 0; r < rows; r++) {
      const y = (r / rows) * S;
      const off = r % 2 ? S / 16 : 0;
      for (let k = -1; k < 9; k++) {
        const x = k * (S / 8) + off;
        ctx.fillStyle = pick(rng, palette);
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.ellipse(x + S / 16, y + S / rows, S / 17, S / rows, 0, 0, Math.PI);
        ctx.fill();
        pencil(ctx, rng, [[x + 2, y + S / rows], [x + S / 16, y + S / rows * 1.9], [x + S / 8 - 2, y + S / rows]], "#3e2b3c", 1.2, 0.35);
      }
    }
    paperGrain(ctx, rng, S, 1200, 0.15);
    return finish(c);
  });
}

/** Cream plaster with brushy patches and a few sketched bricks. */
export function plasterTexture(): THREE.Texture {
  return cached("plaster", () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    const rng = mulberry32(71);
    ctx.fillStyle = "#f3e7d3";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 400; i++) {
      tiled(S, rng() * S, rng() * S, (px, py) =>
        dab(ctx, px, py, 8 + rng() * 18, 5 + rng() * 10, rng() * 3, pick(rng, ["#fff8ea", "#e8d7bf", "#efd9cf", "#e4dbe6"]), 0.4),
      );
    }
    for (let i = 0; i < 18; i++) {
      const x = rng() * S;
      const y = rng() * S;
      pencil(ctx, rng, [[x, y], [x + 18, y], [x + 18, y + 9], [x, y + 9], [x, y]], "#9b7f6c", 1.2, 0.4);
    }
    paperGrain(ctx, rng, S, 1500, 0.12);
    return finish(c);
  });
}

/** Clustered leaf dabs used on canopies; luminance only, coloured by vertex colour. */
export function foliageTexture(): THREE.Texture {
  return cached("foliage", () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    const rng = mulberry32(83);
    ctx.fillStyle = "#d8e2c8";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 700; i++) {
      tiled(S, rng() * S, rng() * S, (px, py) =>
        dab(ctx, px, py, 7 + rng() * 6, 3 + rng() * 3, rng() * Math.PI, pick(rng, ["#ffffff", "#c2d0ae", "#eef3df", "#a9bb95", "#f9f7e2"]), 0.55),
      );
    }
    paperGrain(ctx, rng, S, 1000, 0.1);
    return finish(c);
  });
}

/** A painted cumulus puff on transparent ground: warm lit crown, lilac belly. */
export function cloudTexture(seed: number, warm = false): THREE.Texture {
  return cached(`cloud-${seed}-${warm}`, () => {
    const W = 512;
    const H = 256;
    const [c, ctx] = canvas(W, H);
    const rng = mulberry32(seed * 131 + 7);
    const base = H * 0.78;
    const puffs: { x: number; y: number; r: number }[] = [];
    const n = 16 + Math.floor(rng() * 8);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x = W * (0.14 + t * 0.72) + (rng() - 0.5) * 30;
      const hump = Math.sin(t * Math.PI);
      const r = 26 + hump * (50 + rng() * 40);
      puffs.push({ x, y: base - r * (0.5 + rng() * 0.3), r });
    }
    ctx.filter = "blur(1.5px)";
    // Shadow belly.
    for (const p of puffs) {
      const g = ctx.createRadialGradient(p.x, p.y + p.r * 0.35, p.r * 0.1, p.x, p.y + p.r * 0.2, p.r);
      g.addColorStop(0, warm ? "#e6d3df" : "#d8d8ef");
      g.addColorStop(1, warm ? "rgba(214,184,206,0)" : "rgba(186,190,226,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y + p.r * 0.15, p.r * 1.02, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of puffs) {
      ctx.fillStyle = warm ? "#f1e3e6" : "#e6e7f5";
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 0.92, 0, Math.PI * 2);
      ctx.fill();
    }
    // Lit crowns.
    ctx.globalAlpha = 1;
    for (const p of puffs) {
      const g = ctx.createRadialGradient(p.x - p.r * 0.25, p.y - p.r * 0.45, p.r * 0.05, p.x, p.y - p.r * 0.1, p.r * 0.9);
      g.addColorStop(0, warm ? "#fff6e2" : "#ffffff");
      g.addColorStop(0.6, warm ? "rgba(255,236,214,0.85)" : "rgba(250,250,255,0.85)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y - p.r * 0.08, p.r * 0.85, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.filter = "none";
    // Flatten and fade the base.
    ctx.globalCompositeOperation = "destination-out";
    const fade = ctx.createLinearGradient(0, base - 70, 0, base + 14);
    fade.addColorStop(0, "rgba(0,0,0,0)");
    fade.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, base - 70, W, H);
    ctx.globalCompositeOperation = "source-over";
    // Brushy watercolour texture inside the puff only.
    ctx.globalCompositeOperation = "source-atop";
    for (let i = 0; i < 160; i++) {
      dab(ctx, rng() * W, rng() * H, 10 + rng() * 22, 4 + rng() * 8, rng() * 3, pick(rng, ["#ffffff", "#dcd8f1", "#fff2e0"]), 0.09);
    }
    ctx.globalCompositeOperation = "source-over";
    const tex = finish(c, false);
    return tex;
  });
}

/** Four-point twinkle used for sparkles and magical motes. */
export function sparkleTexture(): THREE.Texture {
  return cached("sparkle", () => {
    const S = 64;
    const [c, ctx] = canvas(S);
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.2, "rgba(255,240,200,0.8)");
    g.addColorStop(1, "rgba(255,220,160,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    const r = S / 2;
    const k = 0.18;
    ctx.moveTo(r, 0);
    ctx.quadraticCurveTo(r + r * k, r - r * k, S, r);
    ctx.quadraticCurveTo(r + r * k, r + r * k, r, S);
    ctx.quadraticCurveTo(r - r * k, r + r * k, 0, r);
    ctx.quadraticCurveTo(r - r * k, r - r * k, r, 0);
    ctx.fill();
    return finish(c, false);
  });
}

/** A leafy branch silhouette for the soft foreground framing layer. */
export function foregroundLeavesTexture(seed: number): THREE.Texture {
  return cached(`fg-leaves-${seed}`, () => {
    const W = 512;
    const H = 512;
    const [c, ctx] = canvas(W, H);
    const rng = mulberry32(seed * 19 + 3);
    ctx.strokeStyle = "#4f5a3a";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(W, H);
    ctx.quadraticCurveTo(W * 0.6, H * 0.75, W * 0.18, H * 0.35);
    ctx.stroke();
    for (let i = 0; i < 70; i++) {
      const t = rng();
      const x = W - (W * 0.82) * t + (rng() - 0.5) * 70;
      const y = H - (H * 0.65) * t + (rng() - 0.5) * 70;
      const ang = rng() * Math.PI * 2;
      const len = 26 + rng() * 22;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.fillStyle = pick(rng, ["#5f7d45", "#4d6b3f", "#7d9a52", "#3f5a3c", "#8fae5e"]);
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len * 0.5, -len * 0.38, len, 0);
      ctx.quadraticCurveTo(len * 0.5, len * 0.38, 0, 0);
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = "#f3f0c8";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(2, 0);
      ctx.lineTo(len * 0.85, 0);
      ctx.stroke();
      ctx.restore();
    }
    return finish(c, false);
  });
}

/** Neutral shingles (near-white) so kit roofs take their hue from vertex colour. */
export function tileTexture(): THREE.Texture {
  return cached("tile", () => {
    const S = 256;
    const [c, ctx] = canvas(S);
    const rng = mulberry32(211);
    const tones = ["#f4efe9", "#ffffff", "#e3dcd6", "#ece6e2"];
    ctx.fillStyle = "#e6dfda";
    ctx.fillRect(0, 0, S, S);
    const rows = 8;
    for (let r = 0; r < rows; r++) {
      const y = (r / rows) * S;
      const off = r % 2 ? S / 16 : 0;
      for (let k = -1; k < 9; k++) {
        const x = k * (S / 8) + off + (rng() - 0.5) * 3;
        ctx.fillStyle = pick(rng, tones);
        ctx.beginPath();
        ctx.ellipse(x + S / 16, y + S / rows, S / 17, S / rows, 0, 0, Math.PI);
        ctx.fill();
        pencil(ctx, rng, [[x + 2, y + S / rows], [x + S / 16, y + (S / rows) * 1.9], [x + S / 8 - 2, y + S / rows]], "#4a3a48", 1.2, 0.32);
      }
    }
    paperGrain(ctx, rng, S, 1200, 0.14);
    return finish(c);
  });
}

/** Falling-water streaks for cheap scrolling waterfalls (luminance, tinted by material colour). */
export function waterTexture(): THREE.Texture {
  return cached("water", () => {
    const W = 128;
    const H = 256;
    const [c, ctx] = canvas(W, H);
    const rng = mulberry32(227);
    ctx.fillStyle = "#cfe4f2";
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 140; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const col = pick(rng, ["#ffffff", "#a9cde6", "#e8f4fb", "#8fbfe0"]);
      for (const oy of [-H, 0, H]) dab(ctx, x, y + oy, 1.5 + rng() * 2.5, 14 + rng() * 30, 0, col, 0.55);
    }
    const tex = finish(c);
    return tex;
  });
}
