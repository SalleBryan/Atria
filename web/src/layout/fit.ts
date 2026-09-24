/**
 * Zoom the two-pane screens to the window, keeping the Rev A proportions.
 *
 * The frames are drawn at 1440 x 900. A laptop at 150% display scaling gives
 * the page about 1280 x 550, where the frame at its drawn size overflows. So
 * the whole screen, text and components together, is zoomed by
 *
 *     fit = min(height / 760, width / 1240), between MIN_FIT and 1
 *
 * 760 is the height the frames' content needs, not the frame's 900: the
 * frames leave empty space above and below the form and under the brand
 * pane's cards, and fitting that too made everything smaller than it needs
 * to be. At 760 the tallest brand pane and every sign-in form but create
 * account's still fit. 1240 is the narrowest the two panes can be at
 * the frame's own sizes (the widest pane, 520, plus the widest form box, 560,
 * plus its padding), so width only takes over on narrow windows.
 *
 * A window wider in proportion than the frame keeps the frame's proportions
 * across: the brand pane and the form box each take the share of the width
 * they have in the frame (auth.css, --pane-share and --box-share), so the
 * extra width is spread the way the frame spreads it.
 *
 * The laid-out canvas is then the window's size divided by the zoom, so once
 * zoomed it fills the window exactly. Below 960px wide the phone and tablet
 * layout is used instead, unzoomed.
 */

export const CONTENT_HEIGHT = 760;
export const MIN_CANVAS_WIDTH = 1240;
export const SINGLE_COLUMN_BELOW = 960;
/** Never smaller than this, so text stays legible on a very short window. */
export const MIN_FIT = 0.6;

export function fitFor(width: number, height: number): number {
  if (width < SINGLE_COLUMN_BELOW) return 1;
  const fit = Math.min(height / CONTENT_HEIGHT, width / MIN_CANVAS_WIDTH, 1);
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
