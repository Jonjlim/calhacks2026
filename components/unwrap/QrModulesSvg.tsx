import type { QrModules } from "@/lib/invitation/mockQr";

/** Renders any QR module grid. Scannable codes get solid square modules and a 4-module quiet zone. */
export function QrModulesSvg({ modules, className, label, scannable = false }: { modules: QrModules; className?: string; label?: string; scannable?: boolean }) {
  const n = modules.length;
  const q = scannable ? 4 : 0;
  const inset = scannable ? 0 : 0.05;
  const size = scannable ? 1 : 0.9;
  return (
    <svg viewBox={`${-q} ${-q} ${n + 2 * q} ${n + 2 * q}`} className={className} shapeRendering="crispEdges" role="img" aria-label={label ?? "Demo QR pattern (not scannable)"}>
      {scannable && <rect x={-q} y={-q} width={n + 2 * q} height={n + 2 * q} fill="#ffffff" />}
      {modules.flatMap((row, r) => row.map((dark, c) => (dark ? <rect key={`${r}-${c}`} x={c + inset} y={r + inset} width={size} height={size} rx={scannable ? 0 : 0.12} fill={scannable ? "#2a1f2c" : "#3b2c3c"} /> : null)))}
    </svg>
  );
}
