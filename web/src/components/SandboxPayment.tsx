/**
 * Paying a visit's fee in the Fapshi sandbox (development only), and the desk
 * confirming it was paid.
 *
 * The patient starts a test checkout for exactly the fee the booking page, the
 * desk and the reminder state, opens Fapshi's test page, then checks. The desk
 * sees the same record on the visit page: paid in full, owed, or started and not
 * confirmed. Paid is only ever true for the full amount, as the API verified it.
 *
 * Nothing shows where the sandbox is not deployed, or the visit has no fee: the
 * read fails or says nothing is owed, and this stays out of the way. Synthetic
 * money only; bookings and the fee ledger are not touched (ADR 0007, 0030).
 */

import { useCallback, useEffect, useState } from "react";

import { api } from "../api/client";
import { LoadingIndicator } from "./LoadingIndicator";

export interface AppointmentPayment {
  appointmentId: string;
  sandbox: true;
  status: string;
  paid: boolean;
  amount: number | null;
  currency: string | null;
  attemptId?: string;
  checkoutUrl?: string;
  startedAt?: string;
}

const money = (amount: number, currency: string | null) => `${new Intl.NumberFormat("en-GB").format(amount)} ${currency ?? "XAF"}`;

const OPEN = ["INITIATING", "CREATED", "PENDING", "INITIATION_UNKNOWN"];

function usePayment(appointmentId: string) {
  const [payment, setPayment] = useState<AppointmentPayment | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const check = useCallback(async () => {
    setBusy(true);
    setFailure(null);
    try {
      setPayment(await api<AppointmentPayment>(`/appointments/${encodeURIComponent(appointmentId)}/payment`));
    } catch {
      setFailure("The payment could not be checked. Try again in a few seconds.");
    } finally {
      setBusy(false);
    }
  }, [appointmentId]);

  useEffect(() => {
    let live = true;
    api<AppointmentPayment>(`/appointments/${encodeURIComponent(appointmentId)}/payment`)
      .then((found) => live && setPayment(found))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [appointmentId]);

  async function start() {
    setBusy(true);
    setFailure(null);
    try {
      setPayment(
        await api<AppointmentPayment>(`/appointments/${encodeURIComponent(appointmentId)}/payment`, {
          method: "POST",
          json: { attemptId: crypto.randomUUID() },
        }),
      );
    } catch (caught) {
      setFailure(caught instanceof Error && caught.message ? caught.message : "The test checkout could not be started.");
    } finally {
      setBusy(false);
    }
  }

  return { payment, busy, failure, check, start };
}

/** The patient's side: pay the fee in the sandbox, then check it went through. */
export function PayFee({ appointmentId }: { appointmentId: string }) {
  const { payment, busy, failure, check, start } = usePayment(appointmentId);
  if (!payment || payment.amount == null || payment.amount <= 0) return null;
  const owed = money(payment.amount, payment.currency);

  if (payment.paid) {
    return (
      <p className="pay-fee-paid" role="status">
        Fee paid, {owed}. Test payment.
      </p>
    );
  }
  const open = OPEN.includes(payment.status) && payment.checkoutUrl;
  return (
    <div className="pay-fee">
      {open ? (
        <>
          <a className="tonal-button" href={payment.checkoutUrl} target="_blank" rel="noreferrer">
            Open the test checkout
          </a>
          <button type="button" className="outline-button" disabled={busy} aria-busy={busy || undefined} onClick={() => void check()}>
            {busy ? <LoadingIndicator size={20} label="Checking" /> : null}
            {busy ? "Checking" : "I have paid, check"}
          </button>
        </>
      ) : (
        <button type="button" className="tonal-button" disabled={busy} aria-busy={busy || undefined} onClick={() => void start()}>
          {busy ? <LoadingIndicator size={20} label="Starting" /> : null}
          {busy ? "Starting" : `Pay ${owed} now`}
        </button>
      )}
      <small className="pay-fee-note">Test payment in the Fapshi sandbox. No real money moves.</small>
      {failure && (
        <small className="pay-fee-note" role="alert">
          {failure}
        </small>
      )}
    </div>
  );
}

/** The desk's side: rows for the visit page's facts list. */
export function FeePayment({ appointmentId }: { appointmentId: string }) {
  const { payment, busy, failure, check } = usePayment(appointmentId);
  if (!payment || payment.amount == null || payment.amount <= 0) return null;
  const owed = money(payment.amount, payment.currency);
  const said = payment.paid
    ? `Paid in full, ${owed}`
    : payment.status === "NONE"
      ? `Not paid, ${owed} owed`
      : OPEN.includes(payment.status)
        ? `Started, not confirmed yet (${owed})`
        : `Not paid (${payment.status.toLowerCase().replace(/_/g, " ")}), ${owed} owed`;
  return (
    <div>
      <dt>Fee payment</dt>
      <dd>
        <span className={payment.paid ? "fee-paid" : undefined}>{said}</span>. Fapshi sandbox, test money.{" "}
        {!payment.paid && (
          <button type="button" className="link-button" disabled={busy} onClick={() => void check()}>
            {busy ? "Checking" : "Check again"}
          </button>
        )}
        {failure ? ` ${failure}` : null}
      </dd>
    </div>
  );
}
