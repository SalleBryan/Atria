/**
 * The Sign in / Create account switch at the top of the patient screens, as
 * a Material 3 segmented control: the selected pill slides between the two
 * on the bouncy spatial spring.
 *
 * The Rev A create account frame put its own tab first, so the tabs swapped
 * places between the two screens and the pill stood still. The order is fixed
 * here, Sign in then Create account, so the pill has somewhere to go and the
 * tabs stay where the hand expects them.
 *
 * Each screen mounts its own switch, so the pill starts where the previous
 * screen left it (src/motion/memory.ts) and springs to its new place.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { remember, tabFrom } from "../motion/memory";

const TABS = [
  { to: "/sign-in", label: "Sign in" },
  { to: "/create-account", label: "Create account" },
] as const;

export function PatientModeSwitch() {
  const { pathname } = useLocation();
  const index = Math.max(
    0,
    TABS.findIndex((tab) => tab.to === pathname),
  );
  const [at, setAt] = useState(() => tabFrom(index));
  const pill = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    remember.tab(index);
    // Make the browser settle the pill where the previous screen left it,
    // then move it before the first paint: the change from one computed
    // position to the other is what the spring transition animates. No
    // animation frame is awaited, so it works in a background tab too.
    pill.current?.getBoundingClientRect();
    setAt(index);
  }, [index]);

  return (
    <nav className="mode-switch" aria-label="Account">
      <span ref={pill} className="mode-pill" aria-hidden="true" style={{ transform: `translateX(calc(${at} * (100% + 5px)))` }} />
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
