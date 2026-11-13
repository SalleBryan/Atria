import { useState } from "react";

import { ApiError, api } from "../api/client";
import { Button, Notice } from "../components/controls";

interface PaymentAttempt {
  checkoutUrl?: string;
  status: keyof typeof statusLabel;
}

const statusLabel = {
  CREATED: "Awaiting payment",
  PENDING: "Payment pending",
  SUCCESSFUL: "Payment simulated successfully",
  FAILED: "Payment failed",
  EXPIRED: "Link expired",
  INITIATING: "Creating checkout",
  INITIATION_UNKNOWN: "Checkout creation unconfirmed",
  INITIATION_REJECTED: "Checkout creation refused",
};

const finished = new Set(["SUCCESSFUL", "EXPIRED", "INITIATION_REJECTED"]);

export function PaymentSandbox() {
  const [id, setId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<PaymentAttempt | null>(null);
  const [busy, setBusy] = useState<"create" | "status" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(attemptId: string, action: "create" | "status") {
    setBusy(action);
    setError(null);
    try {
      setAttempt(await api<PaymentAttempt>(`/admin/payment-sandbox/${attemptId}`, action === "create" ? { method: "POST" } : undefined));
    } catch (failure) {
      if (action === "status" && failure instanceof ApiError && failure.status === 404) {
        setError("This checkout attempt could not be found. Retry creation with the same attempt.");
      } else {
        setError(failure instanceof Error ? failure.message : "The sandbox request failed.");
      }
    } finally {
      setBusy(null);
    }
  }

  function create() {
    const next = id && !attempt ? id : crypto.randomUUID();
    setId(next);
    setAttempt(null);
    void send(next, "create");
  }

  return (
    <section className="glass accounts-card settings-card" aria-labelledby="payment-sandbox-heading">
      <div className="settings-row">
        <div className="settings-row-text">
          <h2 className="settings-row-title" id="payment-sandbox-heading">
            Fapshi payment sandbox
          </h2>
          <p className="settings-row-help">Create a 500 XAF test checkout. Use Fapshi’s sandbox numbers to simulate a payment.</p>
        </div>
        <div className="settings-row-control">
          <Button busy={busy === "create"} disabled={busy !== null || Boolean(attempt && !finished.has(attempt.status))} onClick={create}>
            {id && !attempt ? "Retry checkout creation" : "Create test checkout"}
          </Button>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {id && (
        <div className="settings-row">
          <div className="settings-row-text">
            <p className="settings-row-title" role="status">
              {attempt ? statusLabel[attempt.status] : "Checkout status unavailable"}
            </p>
            {attempt?.checkoutUrl && !finished.has(attempt.status) && (
              <a href={attempt.checkoutUrl} target="_blank" rel="noopener noreferrer">
                Open test checkout
              </a>
            )}
          </div>
          <div className="settings-row-control">
            <Button variant="secondary" busy={busy === "status"} disabled={busy !== null} onClick={() => void send(id, "status")}>
              Check status
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
