/**
 * The Material 3 Expressive loading indicator: one shape that morphs through
 * Material's shape set (soft burst, cookie, pentagon, pill, sunny, oval)
 * while it turns, in place of a spinner.
 *
 * Every shape is drawn with the same number of points around the same centre,
 * so SVG can interpolate any one into the next. Each shape is a polar curve:
 * a circle with k lobes of relative depth a, or an ellipse for the oval.
 * People who ask their system for less motion see the first shape, still.
 */

import { useSyncExternalStore } from "react";

const POINTS = 72;
const RADIUS = 40;

type Shape = (theta: number) => number;

const lobed =
  (lobes: number, depth: number): Shape =>
  (theta) =>
    1 + depth * Math.cos(lobes * theta);

const ellipse =
  (squash: number): Shape =>
  (theta) =>
    squash / Math.sqrt((squash * Math.cos(theta)) ** 2 + Math.sin(theta) ** 2);

const SHAPES: readonly Shape[] = [
  lobed(10, 0.1), // soft burst
  lobed(9, 0.08), // cookie
  lobed(5, 0.11), // pentagon, softened
  ellipse(0.62), // pill
  lobed(8, 0.06), // sunny
  lobed(4, 0.12), // four-sided cookie
  ellipse(0.8), // oval
];

function path(shape: Shape): string {
  // Normalised so every shape has the same mean radius: the morph changes
  // the outline, not the size.
  const raw = Array.from({ length: POINTS }, (_, index) => shape((index / POINTS) * Math.PI * 2));
  const mean = raw.reduce((sum, value) => sum + value, 0) / POINTS;
  const points = raw.map((value, index) => {
    const theta = (index / POINTS) * Math.PI * 2;
    const radius = (value / mean) * RADIUS;
    return `${(radius * Math.cos(theta)).toFixed(2)} ${(radius * Math.sin(theta)).toFixed(2)}`;
  });
  return `M${points.join(" L")} Z`;
}

const PATHS = SHAPES.map(path);
const CYCLE = [...PATHS, PATHS[0]].join(";");
const KEY_TIMES = PATHS.concat(PATHS[0] as string)
  .map((_, index) => (index / PATHS.length).toFixed(4))
  .join(";");
// Material's emphasized curve between shapes: a quick change, then a hold.
const SPLINES = PATHS.map(() => "0.2 0 0 1").join(";");
const DURATION = `${PATHS.length * 0.65}s`;

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia?.(QUERY);
  media?.addEventListener?.("change", onChange);
  return () => media?.removeEventListener?.("change", onChange);
}

function reduced(): boolean {
  return Boolean(window.matchMedia?.(QUERY).matches);
}

export function LoadingIndicator({
  size = 24,
  label = "Loading",
  contained = false,
}: {
  size?: number;
  label?: string;
  /** On a tinted circle, as Material shows it on its own on a surface. */
  contained?: boolean;
}) {
  const still = useSyncExternalStore(subscribe, reduced, () => false);
  return (
    <svg
      className={`loading-indicator${contained ? " loading-contained" : ""}`}
      width={size}
      height={size}
      viewBox="-50 -50 100 100"
      role="progressbar"
      aria-label={label}
    >
      {contained && <circle className="loading-container" r="50" />}
      <g>
        {!still && (
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0"
            to="360"
            dur={`${PATHS.length * 0.65 * 0.5}s`}
            repeatCount="indefinite"
          />
        )}
        <path className="loading-shape" d={PATHS[0]} transform={contained ? "scale(0.62)" : undefined}>
          {!still && (
            <animate
              attributeName="d"
              values={CYCLE}
              keyTimes={KEY_TIMES}
              calcMode="spline"
              keySplines={SPLINES}
              dur={DURATION}
              repeatCount="indefinite"
            />
          )}
        </path>
      </g>
    </svg>
  );
}
