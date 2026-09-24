/** "Desktop · Sign in / create", the sign-in half (FR-ACC-01, FR-ACC-02). */

import { signIn, signInWithRedirect } from "aws-amplify/auth";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { configureFor, setPatientPersistence } from "../auth/config";
import { errorName, messageFor } from "../auth/errors";
import { useSession } from "../auth/session";
import { AuthLayout, PatientBrand } from "../components/AuthLayout";
import { Button, Checkbox, Divider, Field, Notice } from "../components/controls";
import { Lock, Mail } from "../components/icons";
import { PatientModeSwitch } from "./PatientModeSwitch";

export const PATIENT_FOOTER = (
  <>
    Atria clinics in Douala and Yaounde.
    <br />
    Clinic staff sign in at the console, not here.
  </>
);

export function PatientSignIn() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh } = useSession();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState<"password" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => configureFor("patient"), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy("password");
    setPatientPersistence(keep);
    try {
      const result = await signIn({ username: email.trim(), password });
      if (result.nextStep.signInStep === "CONFIRM_SIGN_UP") {
        navigate("/verify-email", { state: { email: email.trim() } });
        return;
      }
      if (!result.isSignedIn) {
        setError("This account needs a step the patient app does not support. Contact your clinic.");
        return;
      }
      const state = await refresh("patient");
      if (state.status === "signed-in") navigate("/home", { replace: true });
      else setError(state.status === "unresolved" ? state.message : "Sign-in did not complete.");
    } catch (caught) {
      if (errorName(caught) === "UserNotConfirmedException") {
        navigate("/verify-email", { state: { email: email.trim() } });
        return;
      }
      setError(messageFor(caught));
    } finally {
      setBusy(null);
    }
  }

  async function google() {
    setError(null);
    setBusy("google");
    setPatientPersistence(keep);
    try {
      await signInWithRedirect({ provider: "Google" });
    } catch (caught) {
      setError(messageFor(caught));
      setBusy(null);
    }
  }

  return (
    <AuthLayout product="PATIENT ACCOUNT" brand={<PatientBrand />} footer={PATIENT_FOOTER}>
      <PatientModeSwitch />
      <h1 className="title">Welcome back.</h1>
      <p className="lede">Pick up where you left off. Your visits, reminders and records follow you across every device.</p>
      <form className="form-card" onSubmit={submit} noValidate>
        {notice && <Notice tone="success">{notice}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        <Field
          label="Email address"
          icon={Mail}
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
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
          required
        />
        <div className="aux">
          <Checkbox checked={keep} onChange={setKeep}>
            Keep me signed in
          </Checkbox>
          <Link className="link" to="/reset-password" state={{ email }}>
            Forgot password?
          </Link>
        </div>
        <Button type="submit" busy={busy === "password"} disabled={!email || !password || busy !== null}>
          Sign in
        </Button>
        <Divider>OR</Divider>
        <Button variant="secondary" busy={busy === "google"} disabled={busy !== null} onClick={google}>
          <span className="google-mark" aria-hidden="true">
            G
          </span>
          Continue with Google
        </Button>
      </form>
      <p className="legal">Trouble signing in? Your clinic front desk can confirm the email on your record.</p>
    </AuthLayout>
  );
}
