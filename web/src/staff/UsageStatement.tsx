/**
 * The month's message usage (ADR 0031): how many messages went out, by unit,
 * kind, channel and what became of them. Counts only. No price, and nothing
 * here claims what messaging saved (FR-MSR-04).
 */

import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { Notice } from "../components/controls";
import { LoadingPane } from "../components/LoadingPane";
import { SelectMenu } from "../components/Pickers";
import { useStaffData } from "./data";
import { sentence } from "./labels";

interface Usage {
  month: string;
  from: string;
  to: string;
  messages: number;
  lines: { clinicId: string; kind: string; channel: string; state: string; count: number }[];
  byKind: Record<string, number>;
  byChannel: Record<string, number>;
  byState: Record<string, number>;
}

const KIND: Record<string, string> = {
  BOOKING_CONFIRMATION: "Booking confirmed",
  BOOKING_CANCELLATION: "Visit cancelled",
  APPOINTMENT_REMINDER: "Reminder",
  BOOKING_RESCHEDULED: "Visit moved",
  BOOKING_DISRUPTED: "Visit disrupted",
  QUEUE_MOVED: "Queue moved",
  BOOKING_DECLINED: "Request declined",
  TICKET_CONFIRMATION: "Queue ticket",
  EARLY_CALL_INVITE: "Early call invitation",
};
const CHANNEL: Record<string, string> = { SMS: "Text message", EMAIL: "Email", VOICE: "Voice call" };
const STATE: Record<string, string> = { SENT: "Sent", DELIVERED: "Delivered", FAILED: "Failed", CANCELLED: "Cancelled" };

/** This month and the two before it, newest first, as YYYY-MM. */
function recentMonths(): { id: string; label: string }[] {
  const now = new Date();
  return [0, 1, 2].map((back) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    return {
      id: d.toISOString().slice(0, 7),
      label: new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(d),
    };
  });
}

export function UsageStatement() {
  const months = useMemo(recentMonths, []);
  const { state: directory } = useStaffData();
  const [month, setMonth] = useState(months[0]?.id ?? "");
  const [found, setFound] = useState<Usage | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setFound(null);
    api<Usage>(`/messages/usage?month=${month}`)
      .then((data) => {
        if (!live) return;
        setFound(data);
        setFailure(null);
      })
      .catch(
        (error: unknown) => live && setFailure(error instanceof Error ? sentence(error.message) : "The statement could not be loaded."),
      );
    return () => {
      live = false;
    };
  }, [month]);

  const names = Object.fromEntries((directory.status === "ready" ? directory.data.clinics : []).map((c) => [c.clinicId, c.name]));
  const perUnit: Record<string, number> = {};
  for (const line of found?.lines ?? []) perUnit[line.clinicId] = (perUnit[line.clinicId] ?? 0) + line.count;

  return (
    <>
      <SelectMenu label="Month" value={month} width={220} options={months} onChange={setMonth} />
      {failure && <Notice tone="error">{failure}</Notice>}
      {!found && !failure && <LoadingPane label="Loading the statement" />}
      {found && (
        <>
          <section className="reports-tiles" aria-label="Usage in numbers">
            <div className="glass reports-tile reports-tile-accent">
              <span className="reports-tile-label">Messages</span>
              <span className="reports-tile-value">{found.messages}</span>
            </div>
            {Object.entries(found.byState).map(([state, n]) => (
              <div key={state} className="glass reports-tile">
                <span className="reports-tile-label">{STATE[state] ?? state}</span>
                <span className="reports-tile-value">{n}</span>
              </div>
            ))}
          </section>
          <div className="reports-cols">
            <Breakdown title="By kind" rows={found.byKind} labels={KIND} />
            <Breakdown title="By channel" rows={found.byChannel} labels={CHANNEL} />
            <Breakdown title="By unit" rows={perUnit} labels={names} />
          </div>
          <p className="availability-note">
            Counted from {found.from} to {found.to}, once each, in the state they ended in. Messages still waiting to go are not counted
            yet. These are counts, not charges.
          </p>
        </>
      )}
    </>
  );
}

function Breakdown({ title, rows, labels }: { title: string; rows: Record<string, number>; labels: Record<string, string> }) {
  const entries = Object.entries(rows);
  return (
    <section className="glass availability-card" aria-label={title}>
      <h2>{title}</h2>
      {entries.length ? (
        <dl className="reports-list">
          {entries.map(([id, n]) => (
            <div key={id}>
              <dt>{labels[id] ?? (id === "-" ? "No unit" : id)}</dt>
              <dd>{n}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="today-empty">No messages in this month.</p>
      )}
    </section>
  );
}
