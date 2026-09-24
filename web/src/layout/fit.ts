/**
 * Zoom the two-pane screens to the window, keeping the Rev A proportions.
 *
 * The frames are drawn at 1440 x 900. A laptop at 150% display scaling gives
 * the page about 1280 x 550, where the frame at its drawn size overflows. So
 * the whole screen, text and components together, is zoomed by
 *
 *     fit = min(height / 900, width / 1240), between MIN_FIT and 1
 *
 * 900 is the frame's height. 1240 is the narrowest the two panes can be at
 * the frame's own sizes (the widest pane, 520, plus the widest form box, 560,
 * plus its padding), so width only takes over on narrow windows, and a wide
 * short window keeps its extra width as space around the form.
 *
 * The laid-out canvas is then the window's size divided by the zoom, so once
 * zoomed it fills the window exactly. Below 960px wide the phone and tablet
 * layout is used instead, unzoomed.
 */

export const FRAME_HEIGHT = 900;
export const MIN_CANVAS_WIDTH = 1240;
export const SINGLE_COLUMN_BELOW = 960;
/** Never smaller than this, so text stays legible on a very short window. */
export const MIN_FIT = 0.6;

export function fitFor(width: number, height: number): number {
  if (width < SINGLE_COLUMN_BELOW) return 1;
  const fit = Math.min(height / FRAME_HEIGHT, width / MIN_CANVAS_WIDTH, 1);
  return Math.max(MIN_FIT, fit);
}

function apply(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const fit = fitFor(width, height);
  const root = document.documentElement.style;
  root.setProperty("--fit", String(fit));
  root.setProperty("--fit-width", `${width / fit}px`);
  root.setProperty("--fit-height", `${height / fit}px`);
}

/** Size the canvas now and whenever the window changes. */
export function fitToWindow(): void {
  apply();
  window.addEventListener("resize", apply);
}
