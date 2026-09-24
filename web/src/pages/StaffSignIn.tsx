/**
 * "Desktop · Staff sign in" (FR-ACC-03, FR-ACC-04), through the staff app
 * client, which offers no Google and no self sign-up.
 *
 * A new account holds a temporary password, and Cognito answers the first
 * sign-in with a forced change. The temporary password is kept in memory for
 * the next screen, which must refuse it as the new one (ADR 0018).
 *
 * The frame's "Trust this workstation for 12 hours" is FR-ACC-10, Phase 2,
 * and is left out rather than shown doing nothing; a staff session here always
 * ends with the tab.
 */

import { signIn, signOut } from "aws-amplify/auth";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { configureFor } from "../auth/config";
import { messageFor } from "../auth/errors";
import { firstSignIn, useSession } from "../auth/session";
import { AuthLayout, StaffBrand } from "../components/AuthLayout";
import { Button, Field, Notice, StatusPill } from "../components/controls";
import { Lock, Mail } from "../components/icons";

export const STAFF_FOOTER = (
  <>
    Staff accounts are issued by your practice administrator.
    <br />
    Access is logged for audit.
  </>
);

export function StaffSignIn() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh } = useSession();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => configureFor("staff"), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const username = email.trim();
    try {
      const result = await signIn({ username, password });
      if (result.nextStep.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
        firstSignIn.hold(username, password);
        navigate("/staff/first-sign-in");
        return;
      }
      if (!result.isSignedIn) {
        setError("This account needs a step the console does not support yet. Contact your administrator.");
        return;
      }
      const state = await refresh("staff");
      if (state.status === "signed-in" && state.me.staffId) {
        navigate("/console", { replace: true });
      } else if (state.status === "signed-in") {
        // A patient account signed in through the staff client: it has no
        // console, and must not keep a staff-client session.
        await signOut();
        await refresh("staff");
        setError("That is a patient account. Patients sign in through the Atria app, not the console.");
      } else {
        setError(state.status === "unresolved" ? state.message : "Sign-in did not complete.");
      }
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout product="CLINIC CONSOLE" brandKey="staff" brand={<StaffBrand />} footer={STAFF_FOOTER} paneWidth={600}>
      <StatusPill tone="booked" icon={Lock}>
        Staff access only
      </StatusPill>
      <h1 className="title">Sign in to the console.</h1>
      <p className="lede">
        Use the credentials your practice administrator issued you. Patients sign in through the Atria app, not here.
      </p>
      <form className="form-card" onSubmit={submit} noValidate>
        {notice && <Notice tone="success">{notice}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        <Field
          label="Work email"
          icon={Mail}
          type="email"
          autoComplete="username"
          placeholder="you@clinic.cm"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Field
          label="Password"
          icon={Lock}
          type="password"
          autoComplete="current-password"
          placeholder="Your password"
          revealable
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <div className="aux aux-end">
          <Link className="link" to="/staff/reset-password" state={{ email }}>
            Forgot password?
          </Link>
        </div>
        <Button type="submit" busy={busy} disabled={!email.trim() || !password}>
          Sign in
        </Button>
      </form>
      <Notice>
        Signing in for the first time? You will be asked to replace the temporary password your administrator sent
        you before the console opens.
      </Notice>
    </AuthLayout>
  );
}
