import type { CouncilActor } from "@/lib/council/contracts";
import type { CouncilClip } from "@/lib/council/animation";

interface Stop {
  angle: number;
  radius: number;
  wait: number;
  lookAt: readonly [number, number];
  clip: CouncilClip;
}
interface Routine { stops: Stop[]; speed: number; offset: number }
const stop = (angle: number, wait: number, lookAt: readonly [number, number], clip: CouncilClip, radius = 2.5): Stop => ({ angle, radius, wait, lookAt, clip });

/** Authored clear aisles: table radius 1.25, roaming lanes 1.8 / 2.5.
 * Background tidying is decorative; only persisted events drive council results.
 * The near-centre aisle belongs to the player, not the agents.
 */
export const AGENT_ROUTINES: Record<CouncilActor, Routine> = {
  archivist: { speed: 0.36, offset: 0, stops: [stop(-2.65, 5, [-3.6, -2.3], "read_scroll"), stop(-2.3, 4, [-2.6, -3.5], "think"), stop(-2.0, 4, [0, 0], "read_scroll")] },
  muse: { speed: 0.4, offset: 4, stops: [stop(-3.55, 4, [-3, -0.4], "sketch_idea"), stop(-3.2, 5, [-3.15, -1.55], "brush_twirl"), stop(-2.95, 4, [0, 0], "think")] },
  scout: { speed: 0.48, offset: 8, stops: [stop(-1.75, 4, [0, -4.5], "search"), stop(-1.4, 4, [2.3, -2], "inspect_object"), stop(-1.1, 3, [3.5, -2.3], "search")] },
  keeper: { speed: 0.32, offset: 2, stops: [stop(-0.85, 6, [2.3, -2], "count_coins"), stop(-0.55, 5, [0, 0], "compare_options"), stop(-0.2, 4, [2.9, -1.4], "think")] },
  courier: { speed: 0.52, offset: 11, stops: [stop(-0.1, 3, [0, 0], "carry_letter", 1.8), stop(-1.25, 3, [0, 2.1], "carry_letter", 1.8), stop(-2.35, 3, [-3.5, -2.3], "think", 1.8), stop(-3.05, 3, [0, 2.1], "carry_letter", 1.8)] },
};
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const length = (a: Stop, b: Stop) => Math.abs(angleDelta(a.angle, b.angle)) * (a.radius + b.radius) / 2;
export const stationFor = (actor: CouncilActor) => {
  const s = AGENT_ROUTINES[actor].stops[0]!;
  return { x: Math.cos(s.angle) * s.radius, z: Math.sin(s.angle) * s.radius, lookAt: s.lookAt, clip: s.clip };
};

/** Constant-speed arcs keep every path outside the table instead of cutting chords through it. */
export function sampleRoutine(actor: CouncilActor, time: number) {
  const { stops, speed, offset } = AGENT_ROUTINES[actor];
  const duration = stops.reduce((sum, s, i) => sum + s.wait + length(s, stops[(i + 1) % stops.length]!) / speed, 0);
  let t = ((time + offset) % duration + duration) % duration;
  for (let i = 0; i < stops.length; i++) {
    const a = stops[i]!;
    const b = stops[(i + 1) % stops.length]!;
    if (t < a.wait) return { x: Math.cos(a.angle) * a.radius, z: Math.sin(a.angle) * a.radius, moving: false, lookAt: a.lookAt, clip: a.clip };
    t -= a.wait;
    const travel = length(a, b) / speed;
    if (t <= travel) {
      const u = t / travel;
      const angle = a.angle + angleDelta(a.angle, b.angle) * u;
      const radius = a.radius + (b.radius - a.radius) * u;
      const direction = Math.sign(angleDelta(a.angle, b.angle));
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      return { x, z, moving: true, lookAt: [x - Math.sin(angle) * direction, z + Math.cos(angle) * direction] as const, clip: "walk" as const };
    }
    t -= travel;
  }
  return { ...stationFor(actor), moving: false };
}
