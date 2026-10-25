/** Small painted-line icons for the map's tokens and panels, in place of emoji, so they sit in the same hand-drawn world. */
const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export function GiftIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} style={{ verticalAlign: "-0.2em" }}>
      <rect x="3.5" y="9" width="17" height="11" rx="1.5" />
      <path d="M3 9h18V6.2H3zM12 6.2V20M12 6.2c-1-3-5-3.4-5-1.1 0 1.2 2.2 1.1 5 1.1zM12 6.2c1-3 5-3.4 5-1.1 0 1.2-2.2 1.1-5 1.1z" />
    </svg>
  );
}

export function CameraIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} style={{ verticalAlign: "-0.2em" }}>
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}
