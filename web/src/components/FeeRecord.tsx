/**
 * A closed visit's fee ledger entry (FR-MSR-05, FR-MSR-07): the band's amount
 * on the day, the outcome and what it entitles the patient to. A record only:
 * nothing is charged or paid through Atria before Phase 3. Rendered as rows
 * of a facts list, so it sits in whichever list the visit page already has.
 */

import { useEffect, useState } from "react";

import { api } from "../api/client";

interface Entry {
  practice: string | null;
  amountMinor: number | null;
  currency: string | null;
  outcome: string;
  entitlement: "FULL" | "PARTIAL" | "NONE";
}

const OUTCOME: Record<string, string> = {
  ATTENDED: "Attended",
  CANCELLED_IN_WINDOW: "Cancelled in time",
  CANCELLED_LATE: "Cancelled late",
  NO_SHOW: "Did not come",
  CLINIC_CANCELLED: "Cancelled by the hospital",
};

const BAND: Record<Entry["entitlement"], string> = { FULL: "Full", PARTIAL: "Partial", NONE: "None" };

const CLOSED = ["COMPLETED", "AWAITING_FEEDBACK", "NO_SHOW", "PATIENT_CANCELLED", "CLINIC_CANCELLED"];

export function FeeRecord({ appointmentId, state }: { appointmentId: string; state: string }) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const closed = CLOSED.includes(state);
  useEffect(() => {
    if (!closed) return;
    let live = true;
    api<{ ledger?: Entry | null }>(`/appointments/${appointmentId}`)
      .then((found) => live && setEntry(found.ledger ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [appointmentId, closed]);
  if (!entry) return null;
  return (
    <>
      <div>
        <dt>Fee record</dt>
        <dd>
          {entry.amountMinor != null
            ? `${new Intl.NumberFormat("en-GB").format(entry.amountMinor)} ${entry.currency ?? "XAF"}`
            : "No fee band"}
          {entry.practice ? `, ${entry.practice.toLowerCase()}` : ""}
        </dd>
      </div>
      <div>
        <dt>Entitlement</dt>
        <dd>
          {BAND[entry.entitlement]} · {OUTCOME[entry.outcome] ?? entry.outcome}. A record only; nothing is paid through Atria.
        </dd>
      </div>
    </>
  );
}
