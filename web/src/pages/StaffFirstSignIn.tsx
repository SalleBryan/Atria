/**
 * "Desktop · First sign-in" (FR-ACC-04, FR-ACC-05).
 *
 * Cognito forces a new password on a staff account's first sign-in. On its
 * current plan it does not refuse the temporary password as the new one, so
 * this screen does (ADR 0018): the rule is in the checklist, and Save stays
 * disabled until it holds. The Rev A frame already carried the rule, which is
 * where the decision came from.
 *
 * The frame names who created the account and when. The token issued at this
 * point is not yet a signed-in session, so the pane shows only what the person
 * typed; the identity card appears in the console once they are in.
 */

import { confirmSignIn } from "aws-amplify/auth";
import { type FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { messageFor } from "../auth/errors";
import { allMet, passwordRules } from "../auth/passwordRules";
import { firstSignIn, useSession } from "../auth/session";
import { AuthLayout, StepsBrand } from "../components/AuthLayout";
import { Button, Notice, StatusPill } from "../components/controls";
import { Info } from "../components/icons";
import { NewPassword } from "../components/NewPassword";

export function StaffFirstSignIn() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [pending] = useState(() => firstSignIn.peek());
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A reload loses the temporary password and Cognito's session with it, so
  // there is nothing to continue: start again from sign-in.
  if (!pending) return <Navigate to="/staff/sign-in" replace />;

  const ready = allMet(passwordRules(password, pending.password)) && password === confirm;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setError(null);
    setBusy(true);
    try {
      const result = await confirmSignIn({ challengeResponse: password });
      firstSignIn.clear();
      if (!result.isSignedIn) {
        navigate("/staff/sign-in", { replace: true, state: { notice: "Password saved. Sign in with it now." } });
        return;
      }
      const state = await refresh("staff");
      navigate(state.status === "signed-in" ? "/home" : "/staff/sign-in", { replace: true });
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      product="CLINIC CONSOLE"
      brandKey="first-sign-in"
      paneWidth={520}
      boxWidth={520}
      footer="Step 3 of 3 · first sign-in"
      brand={
        <>
          <StepsBrand
            steps={[
              { title: "Account created for you", text: "Your practice administrator added you to the console", state: "done" },
              { title: "Temporary password used", text: "Signed in with the one-time password from your invitation email", state: "done" },
              {
                title: "Choose your own password",
                text: "Required before the console will open. The temporary one stops working immediately.",
                state: "current",
              },
            ]}
          />
          <div className="identity-card">
            <span className="avatar" aria-hidden="true">
              {pending.email.slice(0, 2).toUpperCase()}
            </span>
            <span>
              <span className="identity-name">{pending.email}</span>
              <span className="identity-role">Staff account · first sign-in</span>
            </span>
          </div>
        </>
      }
    >
      <StatusPill tone="awaiting" icon={Info}>
        Password change required
      </StatusPill>
      <h1 className="title">Set your own password.</h1>
      <p className="lede">
        Your temporary password expires the moment this is saved. Choose something you have not used on another system.
      </p>
      <form className="form-card" onSubmit={save} noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <NewPassword
          password={password}
          confirm={confirm}
          onPassword={setPassword}
          onConfirm={setConfirm}
          temporary={pending.password}
          mismatch={Boolean(confirm) && confirm !== password}
        />
        <Button type="submit" busy={busy} disabled={!ready}>
          Save and continue
        </Button>
      </form>
      <Notice>
        Nobody at Atria or your clinic can see this password, including the administrator who created your account. If
        you lose it, they can only issue a new temporary one.
      </Notice>
    </AuthLayout>
  );
}
