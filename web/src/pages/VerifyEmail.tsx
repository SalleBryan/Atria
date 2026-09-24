/**
 * "Desktop · Verify email" (FR-ACC-01): the six-digit code Cognito emails
 * after sign-up. Confirming it fires the post-confirmation trigger, which
 * writes the person and the patient profile.
 *
 * Straight after sign-up the patient is signed in as soon as the code is
 * accepted. Arriving from the sign-in screen with an unconfirmed account,
 * there is no sign-up session to continue, so they sign in again.
 */

import { autoSignIn, confirmSignUp, resendSignUpCode } from "aws-amplify/auth";
import { type FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { configureFor } from "../auth/config";
import { messageFor } from "../auth/errors";
import { useSession } from "../auth/session";
import { AuthLayout, StepsBrand } from "../components/AuthLayout";
import { CodeInput, isComplete } from "../components/CodeInput";
import { Notice } from "../components/controls";
import { Info, Mail } from "../components/icons";

const RESEND_AFTER = 60;

function useCountdown(seconds: number) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) return;
    const timer = window.setTimeout(() => setLeft(left - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);
  return [left, () => setLeft(seconds)] as const;
}

export function VerifyEmail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh } = useSession();
  const email = (location.state as { email?: string } | null)?.email ?? "";
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [left, restart] = useCountdown(RESEND_AFTER);

  useEffect(() => configureFor("patient"), []);

  if (!email) return <Navigate to="/sign-in" replace />;

  async function verify(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await confirmSignUp({ username: email, confirmationCode: code });
      if (result.nextStep.signUpStep === "COMPLETE_AUTO_SIGN_IN") {
        await autoSignIn();
        const state = await refresh("patient");
        if (state.status === "signed-in") {
          navigate("/home", { replace: true });
          return;
        }
      }
      navigate("/sign-in", { replace: true, state: { notice: "Email confirmed. Sign in to continue." } });
    } catch (caught) {
      setError(messageFor(caught));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setSent(null);
    try {
      await resendSignUpCode({ username: email });
      setSent("A new code is on its way. Only the latest code works.");
      restart();
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  const minutes = Math.floor(left / 60);
  const seconds = String(left % 60).padStart(2, "0");

  return (
    <AuthLayout
      product="PATIENT ACCOUNT"
      paneWidth={520}
      boxWidth={560}
      footer="Step 2 of 3"
      brand={
        <>
          <StepsBrand
            steps={[
              { title: "Account created", text: "Name, contact details and password saved", state: "done" },
              { title: "Confirm your email", text: "Proves the address can receive your booking receipts", state: "current" },
              { title: "Book your first visit", text: "Browse clinicians and hold a slot", state: "upcoming" },
            ]}
          />
          <div className="aside-card">
            <p className="aside-title">Why we verify</p>
            <p className="aside-text">
              Your confirmation and cancellation receipts are the only written record of a booking. A wrong address
              means they go nowhere, and the clinic cannot resend them for you.
            </p>
          </div>
        </>
      }
    >
      <span className="icon-tile" aria-hidden="true">
        <Mail size={32} />
      </span>
      <h1 className="title title-large">Confirm your email address.</h1>
      <p className="lede lede-large">
        We sent a six-digit code to <strong>{email}</strong>. It expires in 24 hours.
      </p>
      <form onSubmit={verify} noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        {sent && <Notice tone="success">{sent}</Notice>}
        <CodeInput value={code} onChange={setCode} label="Confirmation code" invalid={Boolean(error)} />
        <div className="actions">
          <button type="submit" className="action action-primary" disabled={!isComplete(code) || busy} aria-busy={busy || undefined}>
            {busy ? "Checking" : "Verify and continue"}
          </button>
          <button type="button" className="action" disabled={left > 0} onClick={() => void resend()}>
            {left > 0 ? `Resend in ${minutes}:${seconds}` : "Resend code"}
          </button>
          <Link className="action" to="/create-account">
            Change email
          </Link>
        </div>
      </form>
      <div className="help">
        <Info size={19} />
        <p>
          Codes sometimes land in <strong>spam or promotions</strong>. If nothing arrives after a minute, resend it,
          then check the address is spelled correctly.
        </p>
      </div>
    </AuthLayout>
  );
}
