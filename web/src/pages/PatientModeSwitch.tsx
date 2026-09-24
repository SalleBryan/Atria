/** The Sign in / Create account switch at the top of the patient screens. */

import { NavLink } from "react-router-dom";

export function PatientModeSwitch({ createFirst = false }: { createFirst?: boolean }) {
  const signIn = (
    <NavLink key="in" to="/sign-in" end>
      Sign in
    </NavLink>
  );
  const create = (
    <NavLink key="create" to="/create-account" end>
      Create account
    </NavLink>
  );
  // The Rev A create account frame puts its own tab first.
  return <nav className="mode-switch" aria-label="Account">{createFirst ? [create, signIn] : [signIn, create]}</nav>;
}
