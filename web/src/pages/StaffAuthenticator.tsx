/**
 * An administrator's authenticator (FR-ACC-11): setting one up, and the code
 * it shows at every sign-in after that.
 *
 * Built from the verify email screen: the same brand steps, icon tile, six
 * code boxes and actions row. Setting up shows the authenticator's QR code
 * and, for an app that cannot scan, the key to type in.
 *
 * The API holds an administrator's powers back until their sign-in carries an
 * authenticator, so setting one up is the first thing the console asks, and
 * nothing else in it opens until it is done. Once set up, Cognito asks for a
 * code at every sign-in, and refreshing the session straight away gives the
 * token that says so.
 */

import { confirmSignIn, fetchAuthSession, setUpTOTP, updateMFAPreference, verifyTOTPSetup } from "aws-amplify/auth";
import QRCode from "qrcode";
import { type FormEvent, useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import type { Me } from "../api/client";
import { messageFor } from "../auth/errors";
import { useSession } from "../auth/session";
import { AuthLayout, StepsBrand } from "../components/AuthLayout";
import { CodeInput, isComplete } from "../components/CodeInput";
import { Notice } from "../components/controls";
import { Info, Key, Shield } from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { STAFF_FOOTER } from "./StaffSignIn";

const ISSUER = "Atria";

/** The key in groups of four, which is how an authenticator app asks for it. */
export function grouped(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

function WhyBrand({ current }: { current: "setup" | "code" }) {
  return (
    <>
      <StepsBrand
        steps={[
          { title: "Password", text: "The one you chose for the console", state: "done" },
          {
            title: current === "setup" ? "Set up an authenticator" : "Authenticator code",
            text:
              current === "setup"
                ? "Once, on a phone you keep with you"
                : "Six digits from the app you set up, new every 30 seconds",
            state: "current",
          },
          { title: "Administration", text: "Staff accounts, settings, reports and the audit log", state: "upcoming" },
        ]}
      />
      <div className="aside-card">
        <p className="aside-title">Why administrators</p>
        <p className="aside-text">
          An administrator can create staff accounts and change what every unit offers. A stolen password alone must not
          be enough to do either.
        </p>
      </div>
    </>
  );
}

/** The code at sign-in, for an administrator who has set up an authenticator. */
export function StaffAuthenticatorCode() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh } = useSession();
  const email = (location.state as { email?: string } | null)?.email;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cognito's half-finished sign-in lives only in this tab's memory, so a
  // reload has nothing to continue: start again from the password.
  if (!email) return <Navigate to="/staff/sign-in" replace />;

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!isComplete(code)) return;
    setError(null);
    setBusy(true);
    try {
      const result = await confirmSignIn({ challengeResponse: code });
      if (!result.isSignedIn) {
        navigate("/staff/sign-in", { replace: true, state: { notice: "Sign in again to continue." } });
        return;
      }
      const state = await refresh("staff");
      navigate(state.status === "signed-in" ? "/console" : "/staff/sign-in", { replace: true });
    } catch (caught) {
      setCode("");
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout product="STAFF CONSOLE" brandKey="authenticator" paneWidth={600} footer={STAFF_FOOTER} brand={<WhyBrand current="code" />}>
      <span className="icon-tile" aria-hidden="true">
        <Shield size={32} />
      </span>
      <h1 className="title title-large">Enter your authenticator code.</h1>
      <p className="lede lede-large">
        Open the authenticator app you set up for <strong>{email}</strong> and type the six digits it shows for Atria.
      </p>
      <form onSubmit={verify} noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <CodeInput value={code} onChange={setCode} label="Authenticator code" invalid={Boolean(error)} />
        <div className="actions">
          <button type="submit" className="action action-primary" disabled={!isComplete(code) || busy} aria-busy={busy || undefined}>
            {busy ? <LoadingIndicator size={22} label="Checking" /> : null}
            {busy ? "Checking" : "Sign in"}
          </button>
          <button type="button" className="action" onClick={() => navigate("/staff/sign-in", { replace: true })}>
            Start again
          </button>
        </div>
      </form>
      <div className="help">
        <Info size={19} />
        <p>
          Lost the phone with your authenticator? The authenticator has to be reset on your account before you can sign in
          again, so contact whoever runs Atria for your hospital.
        </p>
      </div>
    </AuthLayout>
  );
}

type Setup = { status: "loading" } | { status: "ready"; secret: string; qr: string } | { status: "failed"; message: string };

/** Setting up an authenticator, which the console asks for before anything else. */
export function StaffAuthenticatorSetup({ me }: { me: Me }) {
  const { refresh, signOut } = useSession();
  const [setup, setSetup] = useState<Setup>({ status: "loading" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = me.email ?? [me.givenName, me.familyName].filter(Boolean).join(" ");

  useEffect(() => {
    let live = true;
    setUpTOTP()
      .then(async (details) => {
        const uri = details.getSetupUri(ISSUER, account || undefined).toString();
        const qr = await QRCode.toDataURL(uri, { margin: 1, width: 184, errorCorrectionLevel: "M" });
        if (live) setSetup({ status: "ready", secret: details.sharedSecret, qr });
      })
      .catch((caught: unknown) => live && setSetup({ status: "failed", message: messageFor(caught) }));
    return () => {
      live = false;
    };
  }, [account]);

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!isComplete(code)) return;
    setError(null);
    setBusy(true);
    try {
      await verifyTOTPSetup({ code });
      await updateMFAPreference({ totp: "PREFERRED" });
      // A fresh token is the one that carries the authenticator.
      await fetchAuthSession({ forceRefresh: true });
      await refresh("staff");
    } catch (caught) {
      setCode("");
      setError(messageFor(caught));
      setBusy(false);
    }
  }

  return (
    <AuthLayout product="STAFF CONSOLE" brandKey="authenticator-setup" paneWidth={600} boxWidth={520} footer={STAFF_FOOTER} brand={<WhyBrand current="setup" />}>
      <span className="icon-tile" aria-hidden="true">
        <Key size={32} />
      </span>
      <h1 className="title title-large">Set up your authenticator.</h1>
      <p className="lede lede-large">
        Administrators sign in with a password and a code from an authenticator app. Scan this with Google
        Authenticator, Microsoft Authenticator or any app like them, then type the code it shows.
      </p>
      {setup.status === "loading" && <LoadingIndicator size={28} label="Preparing your authenticator" />}
      {setup.status === "failed" && <Notice tone="error">{setup.message}</Notice>}
      {setup.status === "ready" && (
        <div className="totp-setup">
          <img className="totp-qr" src={setup.qr} width={184} height={184} alt="QR code for your authenticator app" />
          <div className="totp-key">
            <span className="totp-key-label">Can't scan? Type this key</span>
            <code className="totp-key-value">{grouped(setup.secret)}</code>
            <span className="totp-key-label">Account: {account || "your Atria account"}</span>
          </div>
        </div>
      )}
      <form onSubmit={verify} noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <CodeInput value={code} onChange={setCode} label="Authenticator code" invalid={Boolean(error)} />
        <div className="actions">
          <button
            type="submit"
            className="action action-primary"
            disabled={setup.status !== "ready" || !isComplete(code) || busy}
            aria-busy={busy || undefined}
          >
            {busy ? <LoadingIndicator size={22} label="Checking" /> : null}
            {busy ? "Checking" : "Turn on and continue"}
          </button>
          <button type="button" className="action" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </form>
      <div className="help">
        <Info size={19} />
        <p>
          From now on the console asks for a code at every sign-in. Keep the app on a phone you have with you at work.
        </p>
      </div>
    </AuthLayout>
  );
}
