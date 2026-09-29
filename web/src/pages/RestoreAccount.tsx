/**
 * A patient who deleted their account and signs in again within 30 days
 * (2026-09-29): GET /me carries the pending deletion, and the app offers to
 * take it back before anything else. Cancelled visits are not restored.
 */

import { useState } from "react";

import { api, type Me } from "../api/client";
import { messageFor } from "../auth/errors";
import { useSession } from "../auth/session";
import { AuthLayout, PatientBrand } from "../components/AuthLayout";
import { daysLeft } from "../components/DeleteAccountDialog";
import { Button, Notice } from "../components/controls";
import { clock } from "../patient/data";
import { PATIENT_FOOTER } from "./PatientSignIn";

export function RestoreAccount({ me }: { me: Me }) {
  const { refresh, signOut } = useSession();
  const [busy, setBusy] = useState<"restore" | "leave" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const purgeAt = me.deletion?.purgeAt ?? null;
  const left = daysLeft(purgeAt);

  async function restore() {
    setBusy("restore");
    setFailure(null);
    try {
      await api("/me/restore", { method: "POST" });
      await refresh("patient");
    } catch (caught) {
      setFailure(messageFor(caught));
      setBusy(null);
    }
  }

  return (
    <AuthLayout product="PATIENT ACCOUNT" brandKey="patient" brand={<PatientBrand />} footer={PATIENT_FOOTER}>
      <h1 className="title">Your account is deleted.</h1>
      <p className="lede">
        {purgeAt
          ? `It is erased on ${clock.long(purgeAt)}, in ${left} ${left === 1 ? "day" : "days"}. Until then you can take it back as it was.`
          : "You can still take it back as it was."}
      </p>
      <div className="form-card">
        {failure && <Notice tone="error">{failure}</Notice>}
        <Notice tone="info">Visits cancelled when you deleted it stay cancelled; book again once it is restored.</Notice>
        <Button busy={busy === "restore"} disabled={busy !== null} onClick={restore}>
          Restore my account
        </Button>
        <Button
          variant="secondary"
          busy={busy === "leave"}
          disabled={busy !== null}
          onClick={() => {
            setBusy("leave");
            void signOut();
          }}
        >
          Keep it deleted and sign out
        </Button>
      </div>
    </AuthLayout>
  );
}
