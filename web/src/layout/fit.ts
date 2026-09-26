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
 * Desktop and tablet zoom the whole screen, text, components and spacing
 * together, by the window's width alone:
 *
 *     fit = width / frame width      (1440 desktop, 1194 tablet)
 *
 * so the canvas is always the frame's width, and a window's height only adds
 * or removes room below: full screen and a normal window look the same side
 * to side, full screen is just taller. Screens share spare height out across
 * their gaps and panes (--tall), and their lists and panels scroll inside.
 * A screen that cannot close up past some height (the sign-in panes) sets a
 * min-height, and below it the page scrolls, as any web page does.
 *
 * Why width alone (2026-09-26, third try). The user's screen is 1920 x 1080
 * at 150%, so a normal browser window is 1280 x 551 CSS pixels and full
 * screen 1280 x 720. Fitting whichever dimension was tighter zoomed the
 * normal window by its height (0.725), which laid it out 1766 wide: the same
 * screen looked smaller and stretched compared with full screen (1440 wide).
 * The earlier width-only try (2026-09-25) broke the sign-in panes because it
 * squeezed them into 619 pixels of height; now they scroll instead.
 *
 * The laid-out canvas is the window's size divided by the zoom, so once
 * zoomed it fills the window exactly. The tier is written on <html> as
 * data-tier, so a screen can ask which layout it is in.
 */

import { useEffect, useState } from "react";

export type Tier = "mobile" | "tablet" | "desktop";

/** The desktop safe area: every desktop canvas is at least this wide and this tall. */
export const FRAME_WIDTH = 1440;
export const FRAME_HEIGHT = 760;
export const TABLET_FROM = 768;
export const DESKTOP_FROM = 1200;
/** The tablet safe area, likewise. */
export const TABLET_WIDTH = 1194;
export const TABLET_HEIGHT = 834;
/** The shortest canvas any screen is laid out on; shorter windows scroll the page. */
export const MIN_HEIGHT = 560;
/** Never smaller than this, so text stays legible on a narrow window; below it, screens scroll sideways. */
export const MIN_FIT = 0.6;
/** Never larger than this, so a very large monitor does not get billboard type. */
export const MAX_FIT = 2;

export function tierFor(width: number): Tier {
  if (width < TABLET_FROM) return "mobile";
  return width < DESKTOP_FROM ? "tablet" : "desktop";
}

export function fitFor(width: number): number {
  const tier = tierFor(width);
  if (tier === "mobile") return 1;
  const fit = width / (tier === "tablet" ? TABLET_WIDTH : FRAME_WIDTH);
  return Math.min(MAX_FIT, Math.max(MIN_FIT, fit));
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

/**
 * How much room to breathe the canvas has, from 0 on the 760 pixel safe
 * area to 1 on the frame's own 900. Vertical spacing is written against it,
 * as `calc(compact + extra * var(--tall))`, so a short window closes its gaps
 * up before anything has to scroll, and a tall one opens them to the frame's.
 */
export function tallness(canvasHeight: number): number {
  return Math.min(1, Math.max(0, (canvasHeight - FRAME_HEIGHT) / (900 - FRAME_HEIGHT)));
}

function apply(): void {
  // The width inside any page scrollbar, so a short window that scrolls does
  // not also scroll sideways by the scrollbar's width.
  const width = document.documentElement.clientWidth || window.innerWidth;
  const height = window.innerHeight;
  const fit = fitFor(width);
  const canvasHeight = Math.max(MIN_HEIGHT, height / fit);
  const root = document.documentElement;
  root.dataset.tier = tierFor(width);
  root.style.setProperty("--fit", String(fit));
  root.style.setProperty("--fit-width", `${width / fit}px`);
  root.style.setProperty("--fit-height", `${canvasHeight}px`);
  root.style.setProperty("--tall", tierFor(width) === "mobile" ? "1" : tallness(canvasHeight).toFixed(3));
}

/** Size the canvas now and whenever the window changes. */
export function fitToWindow(): void {
  apply();
  window.addEventListener("resize", apply);
  // A page scrollbar coming or going (a short window on the sign-in screens)
  // changes the width without resizing the window.
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(apply).observe(document.documentElement);
}
