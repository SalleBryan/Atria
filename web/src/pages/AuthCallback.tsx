/**
 * Where Google returns a patient (FR-ACC-02). Amplify trades the code in the
 * address for tokens in the background; the session provider hears the
 * result and resolves the patient through GET /me. This screen only waits,
 * and says so if Google or Cognito refused.
 */

import { Hub } from "aws-amplify/utils";
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { useSession } from "../auth/session";
import { AuthLayout, PatientBrand } from "../components/AuthLayout";
import { Notice } from "../components/controls";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { PATIENT_FOOTER } from "./PatientSignIn";

export function AuthCallback() {
  const { state } = useSession();
  const [failed, setFailed] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("error_description") ?? params.get("error");
  });

  useEffect(
    () =>
      Hub.listen("auth", ({ payload }) => {
        if (payload.event === "signInWithRedirect_failure") {
          setFailed("Google sign-in did not complete.");
        }
      }),
    [],
  );

  if (state.status === "signed-in") return <Navigate to="/home" replace />;

  return (
    <AuthLayout product="PATIENT ACCOUNT" brandKey="patient" brand={<PatientBrand />} footer={PATIENT_FOOTER}>
      <h1 className="title">{failed ? "Google sign-in stopped." : "Signing you in."}</h1>
      <p className="lede">
        {failed ? "Nothing was changed. You can try again or sign in with your email." : "One moment while Atria finishes with Google."}
      </p>
      {!failed && state.status !== "unresolved" && (
        <div className="waiting">
          <LoadingIndicator size={52} contained label="Signing you in" />
        </div>
      )}
      {failed && (
        <>
          <Notice tone="error">{failed}</Notice>
          <p className="legal">
            <Link className="link" to="/sign-in">
              Back to sign in
            </Link>
          </p>
        </>
      )}
      {state.status === "unresolved" && <Notice tone="error">{state.message}</Notice>}
    </AuthLayout>
  );
}
