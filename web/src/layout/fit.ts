/**
 * Which Rev A frame set a window gets, and how far it is zoomed to fit.
 *
 * The design has three sets of frames: desktop (1440 x 900), tablet
 * (1194 x 834) and mobile (390 x 844). A window gets the set its width
 * belongs to:
 *
 *     mobile   below 768px    the phone frames, unzoomed, scrolling as a page
 *     tablet   768 to 1199px  the tablet frames, zoomed to fit
 *     desktop  1200px and up  the desktop frames, zoomed to fit
 *
 * Desktop and tablet zoom the whole screen, text and components together:
 *
 *     fit = min(height / content height, width / canvas width), between MIN_FIT and 1
 *
 * Desktop's content height is 760, not the frame's 900: the frames leave
 * empty space above and below the form and under the brand pane's cards, and
 * fitting that too made everything smaller than it needs to be. Its canvas
 * width, 1240, is the narrowest the two sign-in panes can be at the frame's
 * own sizes. The tablet frames are fitted by their own height and width.
 *
 * The laid-out canvas is the window's size divided by the zoom, so once
 * zoomed it fills the window exactly. The tier is written on <html> as
 * data-tier, so a screen can ask which layout it is in.
 */

import { useEffect, useState } from "react";

export type Tier = "mobile" | "tablet" | "desktop";

export const CONTENT_HEIGHT = 760;
export const MIN_CANVAS_WIDTH = 1240;
export const TABLET_FROM = 768;
export const DESKTOP_FROM = 1200;
export const TABLET_HEIGHT = 834;
export const TABLET_WIDTH = 1194;
/** Never smaller than this, so text stays legible on a very short window. */
export const MIN_FIT = 0.6;

export function tierFor(width: number): Tier {
  if (width < TABLET_FROM) return "mobile";
  return width < DESKTOP_FROM ? "tablet" : "desktop";
}

export function fitFor(width: number, height: number): number {
  const tier = tierFor(width);
  if (tier === "mobile") return 1;
  const fit =
    tier === "tablet"
      ? Math.min(height / TABLET_HEIGHT, width / TABLET_WIDTH, 1)
      : Math.min(height / CONTENT_HEIGHT, width / MIN_CANVAS_WIDTH, 1);
  return Math.max(MIN_FIT, fit);
}

/** The tier the window is in now. */
export const currentTier = (): Tier => tierFor(window.innerWidth);

/** The tier, kept current as the window changes, for what CSS alone cannot do (what to fetch, where to go). */
export function useTier(): Tier {
  const [tier, setTier] = useState<Tier>(currentTier);
  useEffect(() => {
    const update = () => setTier(currentTier());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return tier;
}

function apply(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const fit = fitFor(width, height);
  const root = document.documentElement;
  root.dataset.tier = tierFor(width);
  root.style.setProperty("--fit", String(fit));
  root.style.setProperty("--fit-width", `${width / fit}px`);
  root.style.setProperty("--fit-height", `${height / fit}px`);
}

/** Size the canvas now and whenever the window changes. */
export function fitToWindow(): void {
  apply();
  window.addEventListener("resize", apply);
}
