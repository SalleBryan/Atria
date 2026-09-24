# 0019. Motion is Material 3 Expressive springs

Status: accepted
Source: project, from the Rev A design brief (a glass design with a Material 3 Expressive feel)

## Context

The Rev A brief asked for a glass design with the feel of Material 3 Expressive, including its
motion: the smallest interactions and the largest transitions, not a static page. M3 Expressive
describes motion as spring physics rather than fixed curves. Spatial springs move, resize and
reshape, and may overshoot. Effects springs change colour and opacity, and never do. Each comes
in fast, default and slow.

Browsers have no springs. Animation libraries simulate them, but the ones that animate layout
measure the page in screen pixels. The sign-in screens are zoomed to fit the window
(`web/src/layout/fit.ts`), and that measurement would be off by the zoom.

## Decision

1. **Material's own spring values**, from Jetpack Compose's `MotionScheme.expressive()`:

   | Spring | Damping ratio | Stiffness | Settles in |
   |---|---|---|---|
   | Spatial fast | 0.6 | 800 | 360 ms, overshoots about 9.5% |
   | Spatial default | 0.8 | 380 | 435 ms, overshoots about 1.5% |
   | Spatial slow | 0.8 | 200 | 600 ms |
   | Effects fast | 1.0 | 3800 | 150 ms |
   | Effects default | 1.0 | 1600 | 231 ms |
   | Effects slow | 1.0 | 800 | 327 ms |

2. **Solved in the browser, played by CSS.** `web/src/motion/springs.ts` solves each spring's
   step response and writes it as a CSS `linear()` easing sampled from the physics, with the
   settle time as its duration. Every transition and animation in `web/src/styles/motion.css`
   uses one of the six. There is no animation library, and no layout measurement to disagree
   with the zoom.
3. **Small things bounce, large things barely.** Fast spatial springs are for small elements:
   the segmented pill, tick boxes, code digits, the pressed shape morph. Slow spatial springs are
   for whole screens entering. Colour and opacity always use effects springs.
4. **Material's interaction model:** state layers (hover 8%, focus and press 10%), ripples from
   the pointer, buttons that square their corners when pressed, and the expressive loading
   indicator. The indicator is a shape morphing through Material's shape set while it turns, in
   place of a spinner.
5. **Less motion when asked.** Under `prefers-reduced-motion`, everything reaches its end state
   with the briefest fade. Nothing slides, bounces, drifts or morphs.

## Consequences

- New screens get their motion from the same tokens and the same classes. A new animation picks
  a spring by what it moves, not a duration by feel.
- The Sign in and Create account tabs are always in the same order, so the pill has somewhere to
  slide. The Rev A create account frame put its own tab first; that is the one layout change
  motion required.
- Entrance animations start hidden and play in. A browser that pauses animations in a background
  tab shows the page as soon as the tab is looked at.
