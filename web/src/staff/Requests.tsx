/**
 * The procedure requests inbox (FR-STF-15): what patients asked for, oldest first,
 * to size and place with a clinician and a time, or to decline with a reason
 * the patient reads. For unit managers and clinicians of a unit that runs
 * procedures. Placing locks the time; the patient then confirms it.
 *
 * Staff accounts' rows and Availability's dialogs, with the Move dialog's
 * day and time choice.
 */

import { type CSSProperties, type FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Navigate } from "react-router-dom";

import { api } from "../api/client";
import { useSession } from "../auth/session";
import { Notice } from "../components/controls";
import { Alert, Close, Stethoscope } from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { LoadingRow } from "../components/LoadingPane";
import { SelectMenu } from "../components/Pickers";
import { type Slot, WeekSlots } from "../components/WeekSlots";
import { type Appointment, clock, initials } from "../patient/data";
import { doctor, roleOf, useStaffData } from "./data";
import { sentence } from "./labels";
import { Snackbar } from "./Snackbar";

interface Inbox {
  count: number;
  appointments: Appointment[];
  patients: Record<string, { givenName: string | null; familyName: string | null }>;
}

export function RequestsPage() {
  const { state } = useSession();
  const { state: directory } = useStaffData();
  const me = state.status === "signed-in" ? state.me : undefined;
  const role = me ? roleOf(me) : "RECEPTIONIST";
  const clinicId = me?.clinicId ?? null;
  const [found, setFound] = useState<Inbox | null>(null);
  const [fresh, setFresh] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [placing, setPlacing] = useState<Appointment | null>(null);
  const [declining, setDeclining] = useState<Appointment | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    if (!clinicId) return;
    let live = true;
    api<Inbox>(`/clinics/${encodeURIComponent(clinicId)}/requests`)
      .then((data) => live && setFound(data))
      .catch((error: unknown) => live && setFailure(error instanceof Error ? sentence(error.message) : "The inbox could not be loaded."));
    return () => {
      live = false;
    };
  }, [clinicId, fresh]);

  if (state.status !== "signed-in") return null;
  if (!clinicId || !(role === "CLINIC_MANAGER" || role === "CLINICIAN")) return <Navigate to="/console" replace />;

  const types = directory.status === "ready" ? directory.data.types : [];
  const done = (message: string) => {
    setSaid(message);
    setFresh((n) => n + 1);
  };

  return (
    <div className="accounts-page requests-page">
      <header className="accounts-top">
        <div>
          <h1>Requests</h1>
          <p>Procedures patients asked for. Size and place each one, or decline it with a reason.</p>
        </div>
      </header>
      <section className="glass accounts-card" aria-label="Procedure requests" aria-busy={!found || undefined}>
        {failure && <Notice tone="error">{failure}</Notice>}
        <div className="accounts-head requests-head" aria-hidden="true">
          <span>PATIENT</span>
          <span>PROCEDURE</span>
          <span>ASKED</span>
        </div>
        <ul className="accounts-rows">
          {!found ? (
            <LoadingRow label="Loading requests" />
          ) : found.appointments.length ? (
            found.appointments.map((a, index) => {
              const name = found.patients[a.patientProfileId] ?? { givenName: null, familyName: null };
              const type = types.find((t) => t.appointmentTypeId === a.appointmentTypeId);
              return (
                <li key={a.appointmentId} className="account-row request-row" style={{ "--i": index } as CSSProperties}>
                  <span className="account-who">
                    <span className="account-avatar" aria-hidden="true">
                      {initials(name.givenName, name.familyName) || "?"}
                    </span>
                    <span className="account-text">
                      <span className="account-name">{[name.givenName, name.familyName].filter(Boolean).join(" ") || "Patient"}</span>
                      <span className="account-sub">{a.reference}</span>
                    </span>
                  </span>
                  <span className="account-role">
                    <span>{type?.name ?? "Procedure"}</span>
                    <span>{a.requestNote ? `“${a.requestNote}”` : "No note"}</span>
                  </span>
                  <span className="account-role">
                    <span>{clock.day(a.createdAt)}</span>
                  </span>
                  <span className="account-actions request-actions">
                    <button type="button" className="outline-button queue-arrive" onClick={() => setDeclining(a)}>
                      Decline
                    </button>
                    <button type="button" className="staff-primary queue-arrive" onClick={() => setPlacing(a)}>
                      Place
                    </button>
                  </span>
                </li>
              );
            })
          ) : (
            <li className="today-empty">No requests are waiting.</li>
          )}
        </ul>
      </section>
      {placing && (
        <PlaceDialog
          appointment={placing}
          onClose={() => setPlacing(null)}
          onDone={(message) => {
            setPlacing(null);
            done(message);
          }}
        />
      )}
      {declining && (
        <DeclineDialog
          appointment={declining}
          onClose={() => setDeclining(null)}
          onDone={(message) => {
            setDeclining(null);
            done(message);
          }}
        />
      )}
      <Snackbar message={said} onDone={() => setSaid(null)} />
    </div>
  );
}

function PlaceDialog({
  appointment,
  onClose,
  onDone,
}: {
  appointment: Appointment;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { state } = useSession();
  const { state: directory } = useStaffData();
  const me = state.status === "signed-in" ? state.me : undefined;
  const role = me ? roleOf(me) : "CLINICIAN";
  const clinicians = useMemo(
    () =>
      directory.status === "ready"
        ? directory.data.clinicians.filter((c) =>
            role === "CLINICIAN" ? c.clinicianProfileId === me?.staffId : c.clinicId === appointment.clinicId,
          )
        : [],
    [directory, role, me?.staffId, appointment.clinicId],
  );
  const type =
    directory.status === "ready" ? directory.data.types.find((t) => t.appointmentTypeId === appointment.appointmentTypeId) : undefined;
  const [clinicianId, setClinicianId] = useState<string | null>(clinicians[0]?.clinicianProfileId ?? null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [fresh, setFresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!slot || !clinicianId) return;
    setBusy(true);
    setFailure(null);
    try {
      await api(`/appointments/${appointment.appointmentId}/place`, {
        method: "POST",
        json: { clinicianProfileId: clinicianId, startAt: slot.startAt, durationUnits: type?.durationUnits },
      });
      onDone(`${appointment.reference} placed. The patient is emailed to confirm.`);
    } catch (caught) {
      setFailure(`${sentence(caught instanceof Error ? caught.message : "That did not go through")} Nothing was placed.`);
      setSlot(null);
      setFresh((n) => n + 1);
      setBusy(false);
    }
  }

  return createPortal(
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div
        className="dialog staff-dialog move-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="place-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="move-scroll">
          <button type="button" className="icon-button dialog-close" aria-label="Close" onClick={onClose} disabled={busy}>
            <Close size={16} />
          </button>
          <span className="dialog-icon dialog-icon-blue" aria-hidden="true">
            <Stethoscope size={22} />
          </span>
          <h2 id="place-title">Place {type?.name.toLowerCase() ?? "the procedure"}</h2>
          <p className="dialog-lede">
            {appointment.requestNote ? `“${appointment.requestNote}” ` : ""}The time is held now; the patient confirms it.
          </p>
          <form id="place-form" className="settings-dialog-form" onSubmit={submit}>
            <SelectMenu
              label="Clinician"
              value={clinicianId}
              width={320}
              options={clinicians.map((c) => ({ id: c.clinicianProfileId, label: doctor(c), hint: c.specialty ?? undefined }))}
              onChange={(id) => {
                setClinicianId(id);
                setSlot(null);
              }}
            />
            {clinicianId && (
              <WeekSlots
                clinicianId={clinicianId}
                typeId={appointment.appointmentTypeId}
                slot={slot}
                onSlot={setSlot}
                fresh={fresh}
                onFailure={setFailure}
              />
            )}
            {failure && <Notice tone="error">{failure}</Notice>}
          </form>
        </div>
        <div className="dialog-actions move-actions">
          <button type="button" className="outline-button keep" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="place-form" className="staff-primary" disabled={!slot || busy} aria-busy={busy || undefined}>
            {busy ? <LoadingIndicator size={20} label="Placing" /> : null}
            {busy ? "Placing" : "Place it"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function DeclineDialog({
  appointment,
  onClose,
  onDone,
}: {
  appointment: Appointment;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      await api(`/appointments/${appointment.appointmentId}/decline`, { method: "POST", json: { reason: reason.trim() } });
      onDone(`${appointment.reference} declined. The patient is told why.`);
    } catch (caught) {
      setFailure(`${sentence(caught instanceof Error ? caught.message : "That did not go through")} Nothing was changed.`);
      setBusy(false);
    }
  }

  return createPortal(
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div
        className="dialog staff-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="decline-title"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="dialog-icon" aria-hidden="true">
          <Alert size={22} />
        </span>
        <h2 id="decline-title">Decline {appointment.reference}?</h2>
        <p className="dialog-lede">The patient reads the reason in their visits and by email. Keep it plain and kind.</p>
        <form id="decline-form" onSubmit={submit}>
          <textarea
            className="dialog-text"
            aria-label="Reason"
            placeholder="Reason, required"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
          />
          {failure && <Notice tone="error">{failure}</Notice>}
        </form>
        <div className="dialog-actions">
          <button type="button" className="outline-button keep" onClick={onClose} disabled={busy}>
            Keep it
          </button>
          <button
            type="submit"
            form="decline-form"
            className="danger-button"
            disabled={!reason.trim() || busy}
            aria-busy={busy || undefined}
          >
            {busy ? <LoadingIndicator size={20} label="Declining" /> : null}
            {busy ? "Declining" : "Decline"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
