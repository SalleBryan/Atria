import { useCallback, useEffect, useId, useState } from "react";

import { api } from "../api/client";
import { startPolling } from "../api/network";

interface AppointmentPayment {
  appointmentId: string;
  status: string;
  paid: boolean;
  amount: number | null;
  currency: string | null;
  payerPhone?: string;
}

const money = (amount: number, currency: string | null) => `${new Intl.NumberFormat("en-GB").format(amount)} ${currency ?? "XAF"}`;
const OPEN = ["INITIATING", "CREATED", "PENDING", "INITIATION_UNKNOWN"];
const RETRY = ["FAILED", "EXPIRED", "INITIATION_REJECTED"];

function usePayment(appointmentId: string, poll = false) {
  const path = `/appointments/${encodeURIComponent(appointmentId)}/payment`;
  const [loaded, setLoaded] = useState<AppointmentPayment | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const payment = loaded?.appointmentId === appointmentId ? loaded : null;
  const open = !!payment && !payment.paid && OPEN.includes(payment.status);
  const read = useCallback(() => api<AppointmentPayment>(path), [path]);

  useEffect(() => {
    let live = true;
    void read()
      .then((found) => live && setLoaded(found))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [read]);

  useEffect(() => {
    if (!poll || !open) return;
    let live = true;
    const stop = startPolling(async () => {
      const found = await read();
      if (live) setLoaded(found);
    }, 5000);
    return () => {
      live = false;
      stop();
    };
  }, [open, poll, read]);

  async function check() {
    setBusy(true);
    setFailure(null);
    try {
      setLoaded(await read());
    } catch {
      setFailure("We could not check the payment. Try again in a few seconds.");
    } finally {
      setBusy(false);
    }
  }

  async function start(phone: string) {
    setBusy(true);
    setFailure(null);
    try {
      setLoaded(await api<AppointmentPayment>(path, { method: "POST", json: { attemptId: crypto.randomUUID(), phone } }));
    } catch (caught) {
      // A prompt can be sent even when the POST response is lost.
      const found = await read().catch(() => null);
      if (found) setLoaded(found);
      if (!found?.paid && !OPEN.includes(found?.status ?? "")) {
        setFailure(caught instanceof Error && caught.message ? caught.message : "We could not start the payment.");
      }
    } finally {
      setBusy(false);
    }
  }

  return { payment, open, busy, failure, check, start };
}

export function PayFee({ appointmentId }: { appointmentId: string }) {
  const { payment, open, busy, failure, start } = usePayment(appointmentId, true);
  const [phone, setPhone] = useState("");
  const field = useId();
  if (!payment || payment.amount == null || payment.amount <= 0) return null;
  const owed = money(payment.amount, payment.currency);
  if (payment.paid)
    return (
      <p className="pay-fee-paid" role="status">
        Fee paid, {owed}.
      </p>
    );
  if (open) {
    const sent = payment.status === "PENDING" || payment.status === "CREATED";
    return (
      <p className="pay-fee-note" role="status">
        {sent
          ? `Approve the payment on your phone.${payment.payerPhone ? ` We sent a prompt to ${payment.payerPhone}.` : ""}`
          : "We are checking whether the payment prompt was sent."}
      </p>
    );
  }
  if (payment.amount < 100) return null;

  return (
    <form
      className="pay-fee"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) void start(phone.trim());
      }}
    >
      {RETRY.includes(payment.status) && (
        <p className="pay-fee-note" role="status">
          The payment did not go through. You can try again.
        </p>
      )}
      <div className="field">
        <label className="field-label" htmlFor={field}>
          Mobile money number
        </label>
        <input
          className="input"
          id={field}
          type="tel"
          autoComplete="tel"
          required
          disabled={busy}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          aria-describedby={`${field}-hint`}
        />
        <p className="field-hint" id={`${field}-hint`}>
          Enter a Cameroon mobile number, for example 6 70 00 00 00.
        </p>
      </div>
      <button type="submit" className="tonal-button" disabled={busy || !phone.trim()} aria-busy={busy || undefined}>
        {busy ? "Sending payment prompt..." : `Pay ${owed} with mobile money`}
      </button>
      {failure && (
        <p className="field-error" role="alert">
          {failure}
        </p>
      )}
    </form>
  );
}

export function FeePayment({ appointmentId }: { appointmentId: string }) {
  const { payment, open, busy, failure, check } = usePayment(appointmentId);
  if (!payment || payment.amount == null || payment.amount <= 0) return null;
  const owed = money(payment.amount, payment.currency);
  const said = payment.paid
    ? `Paid in full, ${owed} by mobile money${payment.payerPhone ? ` (${payment.payerPhone})` : ""}`
    : open
      ? "Waiting for the payer to approve"
      : `Not paid, ${owed} owed`;
  return (
    <div>
      <dt>Fee payment</dt>
      <dd>
        <span className={payment.paid ? "fee-paid" : undefined}>{said}</span>.{" "}
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
