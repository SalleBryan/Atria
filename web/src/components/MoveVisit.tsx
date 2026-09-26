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

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../api/client";
import { type Appointment, type AppointmentType, clock, initials } from "../patient/data";
import { Notice } from "./controls";
import { ChevronLeft, ChevronRight, Clock, Close } from "./icons";
import { LoadingIndicator } from "./LoadingIndicator";

interface Slot {
  startAt: string;
  endAt: string;
}

type MovedBy = "PATIENT" | "CLINIC";

const WEEK = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What the desk can say; every option names whose move it is, "Other" asks. */
const REASONS: { label: string; by: MovedBy | null }[] = [
  { label: "Patient asked to move it", by: "PATIENT" },
  { label: "Clinician unavailable", by: "CLINIC" },
  { label: "Double booking", by: "CLINIC" },
  { label: "Unit schedule changed", by: "CLINIC" },
  { label: "Other", by: null },
];

function shift(date: string, byDays: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + byDays * DAY_MS).toISOString().slice(0, 10);
}

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
  const today = clock.isoDate(new Date());
  const [weekStart, setWeekStart] = useState(today);
  const [counts, setCounts] = useState<Record<string, Slot[] | undefined>>({});
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null);
  const [other, setOther] = useState<MovedBy | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  const week = useMemo(() => Array.from({ length: WEEK }, (_, n) => shift(weekStart, n)), [weekStart]);
  const typeId = appointment.appointmentTypeId;
  const clinicianId = appointment.clinicianProfileId ?? "";

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  useEffect(() => {
    let live = true;
    const from = week[0] as string;
    const to = week[WEEK - 1] as string;
    setCounts({});
    api<{ days: Record<string, Slot[]> }>(
      `/clinicians/${encodeURIComponent(clinicianId)}/slots?from=${from}&to=${to}&typeId=${encodeURIComponent(typeId)}`,
    )
      .then((found) => {
        if (!live) return;
        const next: Record<string, Slot[]> = {};
        for (const date of week) next[date] = date < today ? [] : (found.days[date] ?? []);
        setCounts(next);
        setDay((current) => current ?? week.find((date) => (next[date] ?? []).length) ?? null);
      })
      .catch(() => live && setFailure("Free times could not be loaded. Check your connection and try again."));
    return () => {
      live = false;
    };
  }, [clinicianId, typeId, week, today]);

  const by = reason?.by ?? other;
  const slots = day ? counts[day] : undefined;
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
      setWeekStart((start) => `${start}`);
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
            <div className="row-head">
              <p className="dialog-label">NEW DAY</p>
              <div className="week-nav">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Previous week"
                  disabled={weekStart <= today}
                  onClick={() => setWeekStart((start) => (shift(start, -WEEK) < today ? today : shift(start, -WEEK)))}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Next week"
                  onClick={() => setWeekStart((start) => shift(start, WEEK))}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
            <div className="days" role="radiogroup" aria-label="Day">
              {week.map((date) => {
                const free = counts[date];
                const on = date === day;
                return (
                  <button
                    key={date}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={`day${on ? " day-on" : ""}${free && !free.length ? " day-closed" : ""}`}
                    disabled={!free?.length}
                    onClick={() => {
                      setDay(date);
                      setSlot(null);
                    }}
                  >
                    <span className="day-name">{clock.weekday(`${date}T12:00:00Z`)}</span>
                    <span className="day-number">{Number(date.slice(8))}</span>
                    <span className="day-free">
                      {free === undefined ? <LoadingIndicator size={12} label="Checking" /> : free.length ? `${free.length} free` : "None"}
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="dialog-label">NEW TIME</p>
            <div className="slots move-slots" role="radiogroup" aria-label="Time">
              {slots?.map((option) => {
                const on = option.startAt === slot?.startAt;
                return (
                  <button
                    key={option.startAt}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={`slot${on ? " slot-on" : ""}`}
                    onClick={() => setSlot(option)}
                  >
                    {clock.time(option.startAt)}
                  </button>
                );
              })}
              {slots && !slots.length && <p className="empty">No times left on this day.</p>}
              {!slots && day && <LoadingIndicator size={24} label="Finding free times" />}
              {!day && counts[week[0] as string] !== undefined && <p className="empty">No free times this week. Try the next one.</p>}
            </div>

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
