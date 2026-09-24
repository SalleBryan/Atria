/**
 * Where a signed-in person lands until the patient and staff screens exist.
 * It shows what the API resolved them as, which is the proof that sign-in,
 * the pre-token trigger and the authoriser agree.
 */

import { Navigate } from "react-router-dom";

import { useSession } from "../auth/session";
import { AuthLayout, PatientBrand, StaffBrand } from "../components/AuthLayout";
import { Button, Notice, StatusPill } from "../components/controls";
import { CheckMark } from "../components/icons";
import { Waiting } from "../components/Waiting";

/** The staff console's landing, until its screens are built. Patients have their own home. */
export function Console() {
  const { state, signOut } = useSession();
  if (state.status === "loading") return <Waiting />;
  if (state.status !== "signed-in") return <Navigate to="/sign-in" replace />;
  const { me, audience } = state;
  const staff = audience === "staff";
  if (!staff) return <Navigate to="/home" replace />;
  return (
    <AuthLayout
      product={staff ? "CLINIC CONSOLE" : "PATIENT ACCOUNT"}
      brandKey={staff ? "home-staff" : "home-patient"}
      brand={staff ? <StaffBrand /> : <PatientBrand />}
      footer={staff ? "Access is logged for audit." : "Atria clinics in Douala and Yaounde."}
      paneWidth={staff ? 600 : 620}
    >
      <StatusPill tone="booked" icon={CheckMark}>
        Signed in
      </StatusPill>
      <h1 className="title">{staff ? "You are in the console." : "You are signed in."}</h1>
      <p className="lede">
        The {staff ? "schedule and booking" : "booking and visits"} screens arrive next. This page shows what Atria
        knows about the account.
      </p>
      <div className="form-card">
        <dl className="facts">
          <dt>Roles</dt>
          <dd>{me.roles.join(", ") || "none"}</dd>
          <dt>Tenant</dt>
          <dd>{me.tenantId}</dd>
          {me.clinicId && (
            <>
              <dt>Clinic</dt>
              <dd>{me.clinicId}</dd>
            </>
          )}
          {me.patientProfileId && (
            <>
              <dt>Patient profile</dt>
              <dd>{me.patientProfileId}</dd>
            </>
          )}
          <dt>Phone verified</dt>
          <dd>{me.phoneVerified ? "Yes" : "Not yet"}</dd>
        </dl>
        {!me.phoneVerified && !staff && (
          <Notice>Reminders go by text message once your phone number is verified.</Notice>
        )}
        <Button variant="secondary" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </AuthLayout>
  );
}
