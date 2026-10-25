/**
 * Pencil-and-watercolor motifs for the Book of Possibilities: a small library
 * of reusable drawings, chosen by the theme the book was opened from. They are
 * decoration only: they never claim anything about the recipient, and every
 * fact on the pages comes from the room's real data. Each motif is drawn in a
 * 400 x 230 box. `lines` are pencil strokes (drawn one after another); `washes`
 * are the watercolor fills that bloom in afterwards.
 */
export interface Motif {
  id: "hiking" | "creative" | "cozy" | "wishes" | "garden";
  lines: string[];
  washes: { d: string; color: string }[];
}

export const MOTIFS: Record<Motif["id"], Motif> = {
  hiking: {
    id: "hiking",
    lines: [
      "M10 200 L110 70 L165 140 L225 40 L310 170 L350 120 L392 200",
      "M110 70 L128 96 L112 90 L98 104",
      "M225 40 L246 74 L226 68 L208 84",
      "M60 200 C120 170 160 190 220 175 C270 162 300 190 360 180",
      "M40 150 L56 112 L72 150 Z M32 168 L56 128 L80 168 Z M56 168 L56 190",
      "M330 70 a22 22 0 1 0 0.1 0",
    ],
    washes: [
      { d: "M10 200 L110 70 L165 140 L225 40 L310 170 L350 120 L392 200 Z", color: "#a9b8d8" },
      { d: "M40 150 L56 112 L72 150 Z M32 168 L56 128 L80 168 Z", color: "#7fae7a" },
      { d: "M330 48 a22 22 0 1 0 0.1 0 Z", color: "#f2c46d" },
    ],
  },
  creative: {
    id: "creative",
    lines: [
      "M70 190 C60 130 90 100 130 100 C170 100 200 130 190 190 Z",
      "M110 100 C112 84 148 84 150 100",
      "M80 150 C110 164 160 164 182 150",
      "M240 190 L330 60 L346 72 L256 200 Z",
      "M330 60 C338 44 360 40 372 52 C360 56 350 62 346 72",
      "M300 190 a38 38 0 1 0 0.1 0 M286 176 a5 5 0 1 0 0.1 0 M314 168 a5 5 0 1 0 0.1 0",
    ],
    washes: [
      { d: "M70 190 C60 130 90 100 130 100 C170 100 200 130 190 190 Z", color: "#d9826a" },
      { d: "M330 60 C338 44 360 40 372 52 C360 56 350 62 346 72 Z", color: "#a98bd8" },
      { d: "M340 190 a38 38 0 1 0 0.1 0 Z", color: "#f3d27a" },
    ],
  },
  cozy: {
    id: "cozy",
    lines: [
      "M80 200 L80 120 L180 60 L280 120 L280 200 Z",
      "M62 126 L180 52 L298 126",
      "M120 200 L120 150 L160 150 L160 200 M208 140 L208 172 L248 172 L248 140 Z",
      "M236 78 L236 52 L256 52 L256 94",
      "M330 200 L330 130 M318 130 L342 130 L342 100 L318 100 Z M322 112 a6 8 0 1 0 0.1 0",
    ],
    washes: [
      { d: "M80 200 L80 120 L180 60 L280 120 L280 200 Z", color: "#e8c4a0" },
      { d: "M62 126 L180 52 L298 126 L280 120 L180 60 L80 120 Z", color: "#c9694d" },
      { d: "M318 130 L342 130 L342 100 L318 100 Z", color: "#f6cf74" },
    ],
  },
  wishes: {
    id: "wishes",
    lines: [
      "M200 30 L214 70 L256 70 L222 94 L236 134 L200 110 L164 134 L178 94 L144 70 L186 70 Z",
      "M60 190 C100 130 140 160 180 140 C230 114 260 170 340 120",
      "M70 140 C86 120 100 124 104 138 M104 138 C110 118 132 118 134 138",
      "M300 200 L300 150 M300 150 C270 150 262 120 286 108 C292 88 318 88 322 108 C346 118 336 150 300 150",
    ],
    washes: [
      { d: "M200 30 L214 70 L256 70 L222 94 L236 134 L200 110 L164 134 L178 94 L144 70 L186 70 Z", color: "#f4d27e" },
      { d: "M300 150 C270 150 262 120 286 108 C292 88 318 88 322 108 C346 118 336 150 300 150 Z", color: "#f0a9b6" },
    ],
  },
  garden: {
    id: "garden",
    lines: [
      "M120 200 C120 160 116 140 120 110 M120 110 a26 26 0 1 0 0.1 0 M120 110 m-12 0 a12 12 0 1 0 0.1 0",
      "M220 200 C222 170 214 150 220 130 M220 130 a20 20 0 1 0 0.1 0",
      "M310 200 C308 168 316 150 312 120 M312 120 a24 24 0 1 0 0.1 0",
      "M120 170 C100 170 92 156 100 148 M220 176 C238 176 246 164 238 156",
      "M40 200 C140 188 260 212 380 196",
    ],
    washes: [
      { d: "M146 110 a26 26 0 1 0 -52 0 a26 26 0 1 0 52 0 Z", color: "#f0a9b6" },
      { d: "M240 130 a20 20 0 1 0 -40 0 a20 20 0 1 0 40 0 Z", color: "#b9a6e0" },
      { d: "M336 120 a24 24 0 1 0 -48 0 a24 24 0 1 0 48 0 Z", color: "#f2c46d" },
    ],
  },
};

/** Chooses illustrations from the words of the theme the book was opened from. Falls back to a garden. */
export function motifFor(theme: string | null | undefined): Motif {
  const t = (theme ?? "").toLowerCase();
  if (/(hik|outdoor|trail|camp|adventure|mountain|travel|nature)/.test(t)) return MOTIFS.hiking;
  if (/(art|craft|pott|paint|creative|draw|music|design|make)/.test(t)) return MOTIFS.creative;
  if (/(cozy|home|tea|read|book|warm|moment|comfort)/.test(t)) return MOTIFS.cozy;
  if (/(wish|dream|hope|star)/.test(t)) return MOTIFS.wishes;
  return MOTIFS.garden;
}
