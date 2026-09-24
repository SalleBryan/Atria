/**
 * "Desktop · Visits + detail" (142:2) and "Desktop · Cancel dialog" (147:2):
 * a patient's visits, one in detail, and cancelling it (FR-VIS-01, FR-VIS-02,
 * FR-VIS-03).
 *
 * Where the frame shows what Phase 1 does not have, the nearest true thing
 * stands in: the room and the fee give way to the visit's length; messaging
 * the clinic and choosing the reminder's lead time (48h, 24h, 2h) are Phase 2,
 * so the reminder is stated rather than chosen; and rescheduling is not in
 * Phase 1, so a visit is kept or cancelled.
 *
 * Cancelling tells the patient, before they confirm, whether it falls inside
 * the appointment type's cancellation window, which is what decides a late
 * cancellation (D-07). The reason they pick is recorded with it.
 */

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { api } from "../api/client";
import { Notice } from "../components/controls";
import { Alert, Bell, CheckMark, Close, Mail } from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import {
  ACTIVE_STATES,
  type Appointment,
  clinicianName,
  clock,
  initials,
  join,
  past,
  stateLabel,
  upcoming,
  usePatientData,
} from "./data";

const DAY_MS = 24 * 60 * 60 * 1000;
const REASONS = ["Feeling better", "Schedule clash", "Cost", "Booked elsewhere", "Other"] as const;
const BOOKED_VIA: Record<string, string> = {
  ONLINE: "Atria web",
  WEB: "Atria web",
  APP: "Atria app",
  PHONE: "Clinic, by phone",
  WALK_IN: "Clinic front desk",
};

function hoursUntil(instant: string, now = Date.now()): number {
  return (Date.parse(instant) - now) / 3600000;
}

export function Visits() {
  const { state, reload } = usePatientData();
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [done, setDone] = useState<string | null>(null);

  const data = state.status === "ready" ? state.data : undefined;
  const ahead = data ? upcoming(data.appointments) : [];
  const behind = data ? past(data.appointments) : [];
  // A cancelled visit that was still ahead belongs with the past: it is over.
  const cancelledAhead = data
    ? data.appointments.filter((a) => !ACTIVE_STATES.includes(a.state) && Date.parse(a.startAt) > Date.now())
    : [];
  const earlier = [...cancelledAhead, ...behind];
  const selectedVisit = data?.appointments.find((a) => a.appointmentId === id);
  const tab = params.get("show") === "past" || (selectedVisit && !ahead.includes(selectedVisit)) ? "past" : "upcoming";
  const shown = tab === "past" ? earlier : ahead;
  const selected = selectedVisit ?? shown[0];
  const cancelling = params.get("cancel") === "1" && selected && ACTIVE_STATES.includes(selected.state);

  function choose(which: "upcoming" | "past") {
    setDone(null);
    navigate(which === "past" ? "/visits?show=past" : "/visits");
  }

  if (state.status === "failed") return <Notice tone="error">{state.message}</Notice>;
  if (!data) {
    return (
      <div className="find-care" aria-busy="true">
        <span className="skeleton find-list-skeleton" />
        <span className="skeleton find-detail-skeleton" />
      </div>
    );
  }

  return (
    <div className="find-care visits">
      <section className="find-list glass" aria-labelledby="visits-title">
        <header className="find-head">
          <h1 id="visits-title">Your visits</h1>
          <p>
            {ahead.length} upcoming · {behind.filter((a) => ["COMPLETED", "AWAITING_FEEDBACK"].includes(a.state)).length} completed
          </p>
        </header>
        <div className="visits-tabs" role="tablist" aria-label="Visits">
          <span className="visits-pill" aria-hidden="true" style={{ transform: tab === "past" ? "translateX(calc(100% + 5px))" : "none" }} />
          <button type="button" role="tab" aria-selected={tab === "upcoming"} onClick={() => choose("upcoming")}>
            Upcoming
          </button>
          <button type="button" role="tab" aria-selected={tab === "past"} onClick={() => choose("past")}>
            Past visits
          </button>
        </div>
        <ul className="clinicians visit-list" aria-label={tab === "past" ? "Past visits" : "Upcoming visits"} key={tab}>
          {shown.map((appointment) => {
            const { clinician, clinic } = join(data, appointment);
            const status = stateLabel(appointment.state);
            const on = appointment === selected;
            return (
              <li key={appointment.appointmentId}>
                <Link
                  className={`visit-item${on ? " visit-item-on" : ""}`}
                  to={`/visits/${appointment.appointmentId}`}
                  aria-current={on ? "true" : undefined}
                >
                  <span className="date-tile" aria-hidden="true">
                    <span>{clock.month(appointment.startAt)}</span>
                    <span>{clock.date(appointment.startAt)}</span>
                  </span>
                  <span className="visit-text">
                    <span className="visit-name">{clinicianName(clinician)}</span>
                    <span className="visit-sub">
                      {[clinician?.specialty, clinic?.name, clock.time(appointment.startAt)].filter(Boolean).join(" · ")}
                    </span>
                    <span className={`chip chip-${status.tone}`}>{status.label}</span>
                  </span>
                </Link>
              </li>
            );
          })}
          {!shown.length && (
            <li className="empty">
              {tab === "past" ? "Past visits will be listed here." : "Nothing booked."}{" "}
              {tab === "upcoming" && (
                <Link className="link" to="/find-care">
                  Find care
                </Link>
              )}
            </li>
          )}
        </ul>
      </section>

      <section className="find-detail glass visit-detail" aria-label="Visit details">
        {done && <Notice tone="success">{done}</Notice>}
        {selected ? (
          <VisitDetail
            key={selected.appointmentId}
            appointment={selected}
            onCancel={() => setParams({ cancel: "1" })}
          />
        ) : (
          <p className="empty">Choose a visit to see its details.</p>
        )}
      </section>

      {cancelling && selected && (
        <CancelDialog
          appointment={selected}
          onClose={() => setParams({})}
          onCancelled={async (message) => {
            await reload();
            setParams({});
            setDone(message);
          }}
        />
      )}
    </div>
  );
}

function VisitDetail({ appointment, onCancel }: { appointment: Appointment; onCancel: () => void }) {
  const { state } = usePatientData();
  if (state.status !== "ready") return null;
  const { clinician, clinic, type } = join(state.data, appointment);
  const status = stateLabel(appointment.state);
  const minutes = (type?.durationUnits ?? 0) * state.data.gridUnitMinutes;
  const active = ACTIVE_STATES.includes(appointment.state) && Date.parse(appointment.startAt) > Date.now();
  const reminderAt = new Date(Date.parse(appointment.startAt) - DAY_MS);
  const directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    [clinic?.name, clinic?.address].filter(Boolean).join(", "),
  )}`;

  return (
    <>
      <div className={`visit-hero${active ? "" : ` visit-hero-${status.tone}`}`}>
        <span className="hero-bloom" aria-hidden="true" />
        <span className="hero-tag">{status.label.toUpperCase()}</span>
        <h2>{clock.long(appointment.startAt)}</h2>
        <p>{[type?.name, `${minutes} minutes`, clinic?.name].filter(Boolean).join(" · ")}</p>
        <dl className="visit-cells">
          <div>
            <dt>STARTS</dt>
            <dd>{clock.time(appointment.startAt)}</dd>
          </div>
          <div>
            <dt>ENDS</dt>
            <dd>{clock.time(appointment.endAt)}</dd>
          </div>
          <div>
            <dt>DURATION</dt>
            <dd>{minutes} min</dd>
          </div>
          <div>
            <dt>REF</dt>
            <dd>{appointment.reference}</dd>
          </div>
        </dl>
      </div>

      <div className="visit-cols">
        <section className="panel inner-card" aria-labelledby="who-title">
          <h3 id="who-title">Clinician and clinic</h3>
          <div className="who">
            <span className="clinician-avatar" style={{ background: "var(--gradient-primary)" }} aria-hidden="true">
              {initials(clinician?.givenName, clinician?.familyName)}
            </span>
            <span>
              <span className="clinician-name">{clinicianName(clinician)}</span>
              <span className="who-sub">{clinician?.specialty}</span>
            </span>
          </div>
          <dl className="facts-list">
            <div>
              <dt>Clinic</dt>
              <dd>{clinic?.name ?? "Not listed"}</dd>
            </div>
            <div>
              <dt>Address</dt>
              <dd>{clinic?.address ?? "Ask the clinic"}</dd>
            </div>
            <div>
              <dt>Booked</dt>
              <dd>{clock.day(appointment.createdAt)}</dd>
            </div>
            <div>
              <dt>Booked via</dt>
              <dd>{BOOKED_VIA[appointment.channel ?? ""] ?? "Atria"}</dd>
            </div>
            {active && (
              <div>
                <dt>Reminder</dt>
                <dd>{reminderAt.getTime() > Date.now() ? "SMS, 24 hours before" : "SMS sent at booking"}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className="panel inner-card" aria-labelledby="activity-title">
          <h3 id="activity-title">Activity</h3>
          <ol className="timeline">
            <li>
              <span className="timeline-dot dot-done">
                <CheckMark size={11} />
              </span>
              <span>
                <span className="timeline-title">Booked in Atria</span>
                <span className="timeline-sub">
                  {clock.day(appointment.createdAt)}, {clock.time(appointment.createdAt)}
                </span>
              </span>
            </li>
            <li>
              <span className="timeline-dot dot-blue-tint">
                <Mail size={11} />
              </span>
              <span>
                <span className="timeline-title">Confirmation email sent</span>
                <span className="timeline-sub">
                  {clock.day(appointment.createdAt)}, {clock.time(appointment.createdAt)}
                </span>
              </span>
            </li>
            {appointment.state.endsWith("CANCELLED") ? (
              <li>
                <span className="timeline-dot dot-red">
                  <Close size={11} />
                </span>
                <span>
                  <span className="timeline-title">{status.label}</span>
                  <span className="timeline-sub">The time went back to the clinic and the reminder was removed</span>
                </span>
              </li>
            ) : (
              <li>
                <span className="timeline-dot dot-amber-tint">
                  <Bell size={11} />
                </span>
                <span>
                  <span className="timeline-title">
                    {reminderAt.getTime() > Date.parse(appointment.createdAt) ? "SMS reminder scheduled" : "SMS confirmation sent"}
                  </span>
                  <span className="timeline-sub">
                    {reminderAt.getTime() > Date.parse(appointment.createdAt)
                      ? `${clock.day(reminderAt)}, ${clock.time(reminderAt)} · 24h before`
                      : "The visit was less than a day away when booked"}
                  </span>
                </span>
              </li>
            )}
          </ol>
          <div className="visit-actions">
            {active && (
              <button type="button" className="outline-danger" onClick={onCancel}>
                Cancel visit
              </button>
            )}
            <a className="dock-button directions" href={directions} target="_blank" rel="noreferrer">
              Get directions
            </a>
          </div>
        </section>
      </div>
    </>
  );
}

function CancelDialog({
  appointment,
  onClose,
  onCancelled,
}: {
  appointment: Appointment;
  onClose: () => void;
  onCancelled: (message: string) => Promise<void>;
}) {
  const { state } = usePatientData();
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  // Escape closes it, and focus starts inside it.
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  if (state.status !== "ready") return null;
  const { clinician, clinic, type } = join(state.data, appointment);
  const windowHours = (type?.cancellationWindowMinutes ?? 1440) / 60;
  const away = hoursUntil(appointment.startAt);
  const late = away < windowHours;
  const awayText = away >= 48 ? `${Math.round(away / 24)} days` : `${Math.max(1, Math.round(away))} hours`;

  async function cancel(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const result = await api<{ outcome: string }>(`/appointments/${appointment.appointmentId}`, {
        method: "DELETE",
        json: reason ? { reason } : {},
      });
      await onCancelled(
        result.outcome === "CANCELLED_LATE"
          ? `Visit ${appointment.reference} cancelled. It was inside ${windowHours} hours, so the clinic records it as late.`
          : `Visit ${appointment.reference} cancelled. The time is free for someone else, and your reminder is removed.`,
      );
    } catch (caught) {
      setFailure(caught instanceof Error ? caught.message : "The visit could not be cancelled. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div
        ref={dialog}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-title"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="dialog-icon" aria-hidden="true">
          <Close size={22} />
        </span>
        <h2 id="cancel-title">Cancel this visit?</h2>
        <p className="dialog-lede">
          The time goes back to the clinic straight away, your reminder is removed, and a cancellation notice is emailed to
          you.
        </p>
        <div className="dialog-visit">
          <span className="clinician-avatar" style={{ background: "var(--gradient-primary)" }} aria-hidden="true">
            {initials(clinician?.givenName, clinician?.familyName)}
          </span>
          <span className="dialog-visit-text">
            <span className="clinician-name">{clinicianName(clinician)}</span>
            <span className="who-sub">{[clinician?.specialty, clinic?.name].filter(Boolean).join(" · ")}</span>
          </span>
          <span className="dialog-when">
            <span>{clock.time(appointment.startAt)}</span>
            <span>{clock.day(appointment.startAt)}</span>
          </span>
        </div>
        <form onSubmit={cancel}>
          <p className="dialog-label" id="reason-label">
            REASON (OPTIONAL)
          </p>
          <div className="chips" role="radiogroup" aria-labelledby="reason-label">
            {REASONS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={reason === option}
                className={`chip-choice${reason === option ? " chip-on" : ""}`}
                onClick={() => setReason((current) => (current === option ? null : option))}
              >
                {option}
              </button>
            ))}
          </div>
          <div className={`dialog-note${late ? " dialog-note-late" : ""}`}>
            <Alert size={15} />
            <p>
              {late
                ? `This visit is ${awayText} away, inside the ${windowHours} hour cancellation window, so the clinic will record a late cancellation.`
                : `Cancelling inside ${windowHours} hours of a visit is recorded by the clinic. This one is ${awayText} away, so nothing is flagged.`}
            </p>
          </div>
          {failure && <Notice tone="error">{failure}</Notice>}
          <div className="dialog-actions">
            <button type="button" className="outline-button keep" onClick={onClose} disabled={busy}>
              Keep appointment
            </button>
            <button type="submit" className="danger-button" disabled={busy} aria-busy={busy || undefined}>
              {busy ? <LoadingIndicator size={20} label="Cancelling" /> : null}
              {busy ? "Cancelling" : "Cancel visit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
