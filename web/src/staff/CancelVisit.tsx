/**
 * "Desktop · Cancel dialog" (69:2): the desk cancels a visit (FR-VIS-03).
 *
 * Staff must say who called the visit off, because the two land in different
 * states and owe the patient different things (D-07): a clinic cancellation
 * keeps the patient's full entitlement, and a patient's is late inside the
 * type's cancellation window. So every reason on the frame carries its
 * answer, "Other" asks outright, and the dialog states the outcome before the
 * desk confirms it.
 *
 * The frame's "Tell the patient" switches are Phase 2 preferences, and the
 * waitlist is Phase 2 too. What Phase 1 does is stated instead: the reminder
 * is removed and a cancellation email goes to the patient (FR-VIS-04).
 */

import { type FormEvent, useEffect, useRef, useState } from "react";

import { api } from "../api/client";
import { Notice } from "../components/controls";
import { Alert, Close, Mail } from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { type Appointment, type AppointmentType, type Clinician, clock, initials } from "../patient/data";
import { doctor, fullName, noonOf, type PatientName } from "./data";

type CancelledBy = "PATIENT" | "CLINIC";

/** The API words its errors as fragments ("that appointment is already cancelled"); the desk reads sentences. */
function sentence(text: string): string {
  const trimmed = text.trim();
  const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

const REASONS: { label: string; by: CancelledBy | null }[] = [
  { label: "Clinician unavailable", by: "CLINIC" },
  { label: "Patient called to cancel", by: "PATIENT" },
  { label: "Double booking", by: "CLINIC" },
  { label: "Clinic closure", by: "CLINIC" },
  { label: "No longer needed", by: "PATIENT" },
  { label: "Other", by: null },
];

export function CancelVisit({
  appointment,
  patient,
  clinician,
  type,
  onClose,
  onCancelled,
}: {
  appointment: Appointment;
  patient: PatientName;
  clinician: Clinician | undefined;
  type: AppointmentType | undefined;
  onClose: () => void;
  onCancelled: (message: string) => void;
}) {
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null);
  const [other, setOther] = useState<CancelledBy | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const by = reason?.by ?? other;
  const windowHours = (type?.cancellationWindowMinutes ?? 1440) / 60;
  const late = (Date.parse(appointment.startAt) - Date.now()) / 3600000 < windowHours;
  const name = fullName(patient);

  async function cancel(event: FormEvent) {
    event.preventDefault();
    if (!reason || !by) return;
    setBusy(true);
    setFailure(null);
    const written = note.trim() ? `${reason.label}: ${note.trim()}` : reason.label;
    try {
      await api(`/appointments/${appointment.appointmentId}`, {
        method: "DELETE",
        json: { cancelledBy: by, reason: written },
      });
      onCancelled(`${appointment.reference} cancelled. The time is free again and ${name} has been emailed.`);
    } catch (caught) {
      setFailure(
        `${sentence(caught instanceof Error ? caught.message : "The visit could not be cancelled")} Nothing was changed; try again.`,
      );
      setBusy(false);
    }
  }

  return (
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div
        ref={dialog}
        className="dialog staff-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-cancel-title"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="dialog-icon" aria-hidden="true">
          <Close size={22} />
        </span>
        <h2 id="staff-cancel-title">Cancel this appointment?</h2>
        <p className="dialog-lede">
          The time returns to the clinic's calendar straight away and the patient's reminder is removed. This is recorded
          against your account.
        </p>
        <div className="dialog-visit">
          <span className="clinician-avatar" style={{ background: "var(--gradient-primary)" }} aria-hidden="true">
            {initials(patient.givenName, patient.familyName) || "?"}
          </span>
          <span className="dialog-visit-text">
            <span className="clinician-name">{name}</span>
            <span className="who-sub">{[appointment.reference, doctor(clinician, "")].filter(Boolean).join(" · ")}</span>
          </span>
          <span className="dialog-when">
            <span>
              {clock.time(appointment.startAt)} to {clock.time(appointment.endAt)}
            </span>
            <span>{clock.long(noonOf(clock.isoDate(appointment.startAt)))}</span>
          </span>
        </div>

        <form onSubmit={cancel}>
          <p className="dialog-label" id="staff-reason-label">
            REASON · RECORDED IN THE AUDIT LOG
          </p>
          <div className="chips" role="radiogroup" aria-labelledby="staff-reason-label">
            {REASONS.map((option) => (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={reason?.label === option.label}
                className={`chip-choice${reason?.label === option.label ? " chip-on" : ""}`}
                onClick={() => setReason(option)}
              >
                {option.label}
              </button>
            ))}
          </div>

          {reason?.by === null && (
            <div className="who-called" role="radiogroup" aria-label="Who called it off">
              <span>Who called it off?</span>
              <div className="segmented">
                {(["PATIENT", "CLINIC"] as const).map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    role="radio"
                    aria-checked={other === choice}
                    className={`segment${other === choice ? " segment-on" : ""}`}
                    onClick={() => setOther(choice)}
                  >
                    {choice === "PATIENT" ? "The patient" : "The clinic"}
                  </button>
                ))}
              </div>
            </div>
          )}

          <textarea
            className="dialog-text"
            aria-label="Note"
            placeholder="Optional note, kept with the cancellation"
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />

          {by && (
            <div className={`dialog-note${by === "PATIENT" && late ? " dialog-note-late" : ""}`}>
              <Alert size={15} />
              <p>
                {by === "CLINIC"
                  ? "Recorded as cancelled by the clinic, so the patient keeps their full entitlement."
                  : late
                    ? `Recorded as cancelled by the patient inside the ${windowHours} hour window, so it counts as a late cancellation.`
                    : `Recorded as cancelled by the patient, more than ${windowHours} hours ahead, so nothing is flagged.`}
              </p>
            </div>
          )}

          <div className="tell-box">
            <p className="tell-title">Tell the patient</p>
            <div className="tell-row">
              <span className="activity-icon tone-blue" aria-hidden="true">
                <Mail size={16} />
              </span>
              <span className="setting-text">
                <span className="timeline-title">Cancellation email</span>
                <span className="timeline-sub">Sent automatically once the visit is cancelled</span>
              </span>
              <span className="chip chip-booked">Always</span>
            </div>
          </div>

          {failure && <Notice tone="error">{failure}</Notice>}
          <div className="dialog-actions">
            <button type="button" className="outline-button keep" onClick={onClose} disabled={busy}>
              Keep appointment
            </button>
            <button type="submit" className="danger-button" disabled={busy || !by} aria-busy={busy || undefined}>
              {busy ? <LoadingIndicator size={20} label="Cancelling" /> : null}
              {busy ? "Cancelling" : "Cancel appointment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
