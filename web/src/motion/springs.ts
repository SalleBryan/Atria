/**
 * Material 3 Expressive motion, as springs.
 *
 * M3 Expressive replaces fixed easing curves with a spring physics system:
 * spatial springs move things and may overshoot, effects springs change
 * colour and opacity and never do. Each comes in fast, default and slow. The
 * values are Material's own expressive motion scheme (Jetpack Compose
 * MotionScheme.expressive()), so the web moves as Material specifies rather
 * than as an approximation of it.
 *
 * A browser has no springs, so each one is solved here and written as a CSS
 * linear() easing, sampled from the spring's own step response, with the
 * duration the spring takes to settle. Transitions and animations then use
 * var(--spring-spatial-default) and var(--spring-spatial-default-duration)
 * and move with the physics, overshoot included.
 */

export interface Spring {
  /** 1 is critically damped (no overshoot); below 1 bounces. */
  readonly dampingRatio: number;
  /** Stiffness for a unit mass, in N/m: stiffer settles sooner. */
  readonly stiffness: number;
}

export const EXPRESSIVE = {
  spatial: {
    fast: { dampingRatio: 0.6, stiffness: 800 },
    default: { dampingRatio: 0.8, stiffness: 380 },
    slow: { dampingRatio: 0.8, stiffness: 200 },
  },
  effects: {
    fast: { dampingRatio: 1, stiffness: 3800 },
    default: { dampingRatio: 1, stiffness: 1600 },
    slow: { dampingRatio: 1, stiffness: 800 },
  },
} as const satisfies Record<string, Record<string, Spring>>;

/** Where a spring released from 0 towards 1, at rest, is after t seconds. */
export function position(spring: Spring, t: number): number {
  const omega = Math.sqrt(spring.stiffness);
  const zeta = spring.dampingRatio;
  if (zeta < 1) {
    const damped = omega * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-zeta * omega * t);
    return 1 - decay * (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t));
  }
  if (zeta === 1) {
    return 1 - Math.exp(-omega * t) * (1 + omega * t);
  }
  const root = omega * Math.sqrt(zeta * zeta - 1);
  const fast = -zeta * omega - root;
  const slow = -zeta * omega + root;
  return 1 + (fast * Math.exp(slow * t) - slow * Math.exp(fast * t)) / (slow - fast);
}

const STEP = 0.001;
const LONGEST = 4;

/** Seconds until the spring stays within tolerance of rest for good. */
export function settleTime(spring: Spring, tolerance = 0.001): number {
  let last = 0;
  for (let t = 0; t <= LONGEST; t += STEP) {
    if (Math.abs(position(spring, t) - 1) > tolerance) last = t;
  }
  return last + STEP;
}

export interface Easing {
  /** A CSS linear() timing function sampled from the spring. */
  readonly linear: string;
  readonly durationMs: number;
}

export function easing(spring: Spring, samples = 40): Easing {
  const duration = settleTime(spring);
  const points: string[] = [];
  for (let index = 0; index < samples; index += 1) {
    const value = index === samples - 1 ? 1 : position(spring, (index / (samples - 1)) * duration);
    points.push(String(Math.round(value * 10000) / 10000));
  }
  return { linear: `linear(${points.join(", ")})`, durationMs: Math.round(duration * 1000) };
}

/** Material's emphasized curves, for a browser without linear(). */
const FALLBACK = {
  spatial: "cubic-bezier(0.34, 1.36, 0.64, 1)",
  effects: "cubic-bezier(0.2, 0, 0, 1)",
};

/**
 * Write every spring onto the document as custom properties:
 * --spring-<spatial|effects>-<fast|default|slow> and the same with -duration.
 */
export function installMotion(root: HTMLElement = document.documentElement): void {
  const supported =
    typeof CSS !== "undefined" && CSS.supports?.("transition-timing-function", "linear(0, 1)");
  for (const [family, speeds] of Object.entries(EXPRESSIVE)) {
    for (const [speed, spring] of Object.entries(speeds)) {
      const { linear, durationMs } = easing(spring);
      const name = `--spring-${family}-${speed}`;
      root.style.setProperty(name, supported ? linear : FALLBACK[family as keyof typeof FALLBACK]);
      root.style.setProperty(`${name}-duration`, `${durationMs}ms`);
    }
  }
}
