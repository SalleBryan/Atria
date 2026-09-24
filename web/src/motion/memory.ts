/**
 * What the last screen was, so the next one can arrive the right way.
 *
 * Every sign-in screen renders its own layout, so moving between two of them
 * mounts a fresh one. Remembering the previous screen lets the new one move
 * as Material's shared axis does: Sign in and Create account are two
 * positions on one axis, so going right slides content in from the right and
 * going back slides it in from the left. The brand pane replays its entrance
 * only when what it shows changes; switching tabs under the same pane leaves
 * it still.
 *
 * Read while rendering, written after: a render may run twice, a commit once.
 */

export type Enter = "rise" | "forward" | "back";

/** Screens that sit side by side on one axis, in order. */
const AXIS: Readonly<Record<string, number>> = { "/sign-in": 0, "/create-account": 1 };

let lastPath: string | null = null;
let lastBrand: string | null = null;
let lastTab: number | null = null;

export function enterFrom(path: string): Enter {
  const from = lastPath === null ? undefined : AXIS[lastPath];
  const to = AXIS[path];
  if (from === undefined || to === undefined || from === to) return "rise";
  return to > from ? "forward" : "back";
}

export function brandEnters(brand: string): boolean {
  return brand !== lastBrand;
}

export function tabFrom(current: number): number {
  return lastTab ?? current;
}

export const remember = {
  screen(path: string, brand: string) {
    lastPath = path;
    lastBrand = brand;
  },
  tab(index: number) {
    lastTab = index;
  },
  /** For tests, which render screens in isolation. */
  reset() {
    lastPath = null;
    lastBrand = null;
    lastTab = null;
  },
};
