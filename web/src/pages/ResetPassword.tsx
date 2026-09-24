/**
 * "Desktop · Reset password" (FR-ACC-06), for patients and staff alike.
 *
 * The Rev A frame promises a reset link. Cognito sends a six-digit code to
 * the verified email instead, which is also what the requirement says, so the
 * copy says code and the screen gains a second step: the code and the new
 * password together. That step has no frame of its own; it is built from the
 * code boxes of "Verify email" and the rules of "First sign-in".
 *
 * The pool hides whether an email has an account, so the first step moves on
 * whatever address is entered. Saying "no such account" would tell anyone
 * which addresses are registered.
 */

import { confirmResetPassword, resetPassword } from "aws-amplify/auth";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { type Audience, configureFor } from "../auth/config";
import { messageFor } from "../auth/errors";
import { allMet, passwordRules } from "../auth/passwordRules";
import { AuthLayout } from "../components/AuthLayout";
import { CodeInput, isComplete } from "../components/CodeInput";
import { Button, Field, Notice } from "../components/controls";
import { Info, Lock, Mail } from "../components/icons";
import { NewPassword } from "../components/NewPassword";

export function ResetPassword({ audience = "patient" }: { audience?: Audience }) {
  const navigate = useNavigate();
  const location = useLocation();
  const staff = audience === "staff";
  const [email, setEmail] = useState((location.state as { email?: string } | null)?.email ?? "");
  const [step, setStep] = useState<"request" | "confirm">("request");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => configureFor(audience), [audience]);

  async function request(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await resetPassword({ username: email.trim() });
      setStep("confirm");
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  const ready = isComplete(code) && allMet(passwordRules(password)) && password === confirm;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setError(null);
    setBusy(true);
    try {
      await confirmResetPassword({ username: email.trim(), confirmationCode: code, newPassword: password });
      navigate(staff ? "/staff/sign-in" : "/sign-in", {
        replace: true,
        state: { notice: "Password changed. Sign in with the new one." },
      });
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  const backTo = staff ? "/staff/sign-in" : "/sign-in";

  return (
    <AuthLayout
      product={staff ? "CLINIC CONSOLE" : "PATIENT ACCOUNT"}
      paneWidth={520}
      boxWidth={520}
      footer="Account recovery"
      brand={
        <div className="recovery">
          <span className="recovery-tile" aria-hidden="true">
            <Lock size={28} />
          </span>
          <h2 className="recovery-title">Only you can reset your password.</h2>
          <p className="recovery-text">
            Atria never sends your password by email, and neither clinic staff nor your administrator can read it. A
            code sent to your email is the only route back in.
          </p>
        </div>
      }
    >
      <span className="icon-tile icon-tile-small" aria-hidden="true">
        <Lock size={28} />
      </span>
      {step === "request" ? (
        <>
          <h1 className="title title-reset">Reset your password.</h1>
          <p className="lede lede-large">
            Enter the email on your Atria account and we will send a code to set a new password.
          </p>
          <form className="form-card" onSubmit={request} noValidate>
            {error && <Notice tone="error">{error}</Notice>}
            <Field
              label="Email address"
              icon={Mail}
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="field-tight"
            />
            <Button type="submit" busy={busy} disabled={!email.trim()}>
              Send reset code
            </Button>
          </form>
          {!staff && (
            <div className="note">
              <Info size={18} />
              <p>Signed up with Google? You do not have an Atria password. Use the Google button on the sign-in screen instead.</p>
            </div>
          )}
        </>
      ) : (
        <>
          <h1 className="title title-reset">Choose a new password.</h1>
          <p className="lede lede-large">
            If <strong>{email.trim()}</strong> has an Atria account, a six-digit code is on its way to it.
          </p>
          <form className="form-card" onSubmit={save} noValidate>
            {error && <Notice tone="error">{error}</Notice>}
            <p className="field-label">Code from the email</p>
            <CodeInput value={code} onChange={setCode} label="Reset code" invalid={Boolean(error)} />
            <div className="gap" />
            <NewPassword
              password={password}
              confirm={confirm}
              onPassword={setPassword}
              onConfirm={setConfirm}
              mismatch={Boolean(confirm) && confirm !== password}
            />
            <Button type="submit" busy={busy} disabled={!ready}>
              Save new password
            </Button>
          </form>
          <p className="legal">
            <button type="button" className="link" onClick={() => setStep("request")}>
              Use a different email or send a new code
            </button>
          </p>
        </>
      )}
      <p className="legal">
        Remembered it?{" "}
        <Link className="link" to={backTo}>
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
