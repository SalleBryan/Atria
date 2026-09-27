/**
 * Move a visit to another time (FR-VIS-07), for the patient and for the desk.
 *
 * There is no frame for it; it extends the cancel dialog (69:2) and the day
 * and time pickers of Find care, so it reads as the same product. The visit
 * keeps its reference and its clinician; only the time changes. The desk also
 * says why, and whose move it is, because a move the institution makes is
 * recorded against the institution (FR-VIS-05, FR-MSR-06). A patient need
 * not give a reason.
 *
 * Free times come from the same week search Find care uses, so what is
 * offered is what the server would accept. The visit's own time shows as
 * taken, which is true until the move lands.
 */

import { type FormEvent, useEffect, useRef, useState } from "react";

import { api } from "../api/client";
import { type Appointment, type AppointmentType, clock, initials } from "../patient/data";
import { Notice } from "./controls";
import { Clock, Close } from "./icons";
import { LoadingIndicator } from "./LoadingIndicator";
import { type Slot, WeekSlots } from "./WeekSlots";

type MovedBy = "PATIENT" | "CLINIC";


/** What the desk can say; every option names whose move it is, "Other" asks. */
const REASONS: { label: string; by: MovedBy | null }[] = [
  { label: "Patient asked to move it", by: "PATIENT" },
  { label: "Clinician unavailable", by: "CLINIC" },
  { label: "Double booking", by: "CLINIC" },
  { label: "Unit schedule changed", by: "CLINIC" },
  { label: "Other", by: null },
];

function sentence(text: string): string {
  const trimmed = text.trim();
  const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

export function MoveVisit({
  appointment,
  type,
  who,
  withWhom,
  byStaff,
  onClose,
  onMoved,
}: {
  appointment: Appointment;
  type: AppointmentType | undefined;
  /** The patient's name for the desk, or the clinician's for the patient. */
  who: { givenName?: string | null; familyName?: string | null; label: string };
  withWhom: string;
  byStaff: boolean;
  onClose: () => void;
  onMoved: (moved: Appointment) => void;
}) {
  const [fresh, setFresh] = useState(0);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null);
  const [other, setOther] = useState<MovedBy | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  const typeId = appointment.appointmentTypeId;
  const clinicianId = appointment.clinicianProfileId ?? "";

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const by = reason?.by ?? other;
  const ready = Boolean(slot) && (!byStaff || Boolean(reason && by));

  async function move(event: FormEvent) {
    event.preventDefault();
    if (!slot || !ready) return;
    setBusy(true);
    setFailure(null);
    const written = reason ? (note.trim() ? `${reason.label}: ${note.trim()}` : reason.label) : note.trim();
    try {
      const moved = await api<Appointment>(`/appointments/${appointment.appointmentId}/reschedule`, {
        method: "POST",
        json: byStaff
          ? { startAt: slot.startAt, rescheduledBy: by, reason: written }
          : {
              startAt: slot.startAt,
              ...(written ? { reason: written } : {}),
            },
      });
      onMoved(moved);
    } catch (caught) {
      setFailure(`${sentence(caught instanceof Error ? caught.message : "The visit could not be moved")} Nothing was changed.`);
      setBusy(false);
      // The time may have been taken; read the week again.
      setFresh((n) => n + 1);
      setSlot(null);
    }
  }

  return (
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div
        ref={dialog}
        className="dialog staff-dialog move-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="icon-button dialog-close" aria-label="Close" onClick={onClose} disabled={busy}>
          <Close size={16} />
        </button>
        <div className="move-scroll">
          <span className="dialog-icon dialog-icon-blue" aria-hidden="true">
            <Clock size={22} />
          </span>
          <h2 id="move-title">Move this visit</h2>
          <p className="dialog-lede">
            {byStaff
              ? "The new time is held and the old one freed in one step. The patient is emailed the new time and their reminder moves with it."
              : "Your reference stays the same. We hold the new time, free the old one, and move your reminder."}
          </p>
          <div className="dialog-visit">
            <span className="clinician-avatar" style={{ background: "var(--gradient-primary)" }} aria-hidden="true">
              {initials(who.givenName, who.familyName) || "?"}
            </span>
            <span className="dialog-visit-text">
              <span className="clinician-name">{who.label}</span>
              <span className="who-sub">{[appointment.reference, withWhom, type?.name].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="dialog-when">
              <span>Now {clock.time(appointment.startAt)}</span>
              <span>{clock.day(appointment.startAt)}</span>
            </span>
          </div>

          <form id="move-form" onSubmit={move}>
            <WeekSlots
              clinicianId={clinicianId}
              typeId={typeId}
              slot={slot}
              onSlot={setSlot}
              dayLabel="NEW DAY"
              timeLabel="NEW TIME"
              fresh={fresh}
              onFailure={setFailure}
            />

            {byStaff && (
              <>
                <p className="dialog-label" id="move-reason-label">
                  REASON · RECORDED IN THE AUDIT LOG
                </p>
                <div className="chips" role="radiogroup" aria-labelledby="move-reason-label">
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
                  <div className="who-called" role="radiogroup" aria-label="Whose move is it">
                    <span>Whose move is it?</span>
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
                          {choice === "PATIENT" ? "The patient's" : "The institution's"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            <textarea
              className="dialog-text"
              aria-label="Note"
              placeholder={byStaff ? "Optional note, kept with the move" : "Optional: tell the unit why"}
              maxLength={400}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />

            {failure && <Notice tone="error">{failure}</Notice>}
          </form>
        </div>
        <div className="dialog-actions move-actions">
          <button type="button" className="outline-button keep" onClick={onClose} disabled={busy}>
            Keep the current time
          </button>
          <button type="submit" form="move-form" className="staff-primary" disabled={busy || !ready} aria-busy={busy || undefined}>
            {busy ? <LoadingIndicator size={20} label="Moving" /> : null}
            {busy ? "Moving" : slot ? `Move to ${clock.time(slot.startAt)}, ${clock.day(slot.startAt)}` : "Move visit"}
          </button>
        </div>
      </div>
    </div>
  );
}
