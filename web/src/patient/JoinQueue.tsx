/**
 * Seeing a doctor in the outpatient queue, and asking for a procedure (FR-BKG-09, FR-BKG-11, FR-BKG-14).
 *
 * The general line is a place in a session, not a time with a named doctor:
 * the patient chooses a day and a part of the day, the server gives the next
 * place, and the ticket shows when to arrive. A procedure is asked for, not
 * booked: the unit sizes and places it, and the patient confirms the time.
 *
 * Both extend Find care's Rev A look: the glass panel, its header, Find care's
 * day chips, the platform's pickers and the booking dock.
 */

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "../api/client";
import { Notice } from "../components/controls";
import { ArrowLeft, Clock, Stethoscope, Users } from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { SelectMenu } from "../components/Pickers";
import { type Appointment, clock, offeredAt, usePatientData } from "./data";

interface Session {
  sessionId: string;
  clinicId: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  capacity: number;
  issuedTickets: number;
  remaining: number;
  partOfDay: "MORNING" | "AFTERNOON" | "EVENING";
  status: string;
}

const PART = { MORNING: "Morning", AFTERNOON: "Afternoon", EVENING: "Evening" } as const;

function sentence(text: string): string {
  const trimmed = text.trim();
  const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

export function JoinQueue() {
  const { state, reload } = usePatientData();
  const navigate = useNavigate();
  const data = state.status === "ready" ? state.data : undefined;
  // The units that run a general consultation queue.
  const units = useMemo(
    () => (data?.clinics ?? []).filter((c) => (data?.types ?? []).some((t) => t.serviceLine === "GENERAL" && offeredAt(t, c.clinicId))),
    [data],
  );
  const unit = units[0];
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!unit) return;
    let live = true;
    api<{ sessions: Session[] }>(`/clinics/${encodeURIComponent(unit.clinicId)}/sessions`)
      .then((found) => {
        if (!live) return;
        setSessions(found.sessions);
        setDay((current) => current ?? found.sessions.find((s) => s.remaining > 0)?.sessionDate ?? null);
      })
      .catch(() => live && setFailure("The sessions could not be loaded. Check your connection and try again."));
    return () => {
      live = false;
    };
  }, [unit]);

  const days = useMemo(() => [...new Set((sessions ?? []).map((s) => s.sessionDate))], [sessions]);
  const onDay = (sessions ?? []).filter((s) => s.sessionDate === day);
  const session = onDay.find((s) => s.sessionId === chosen);

  async function take(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setFailure(null);
    try {
      const made = await api<Appointment>(`/sessions/${encodeURIComponent(session.sessionId)}/tickets`, { method: "POST" });
      await reload();
      navigate(`/visits/${made.appointmentId}`);
    } catch (caught) {
      setFailure(`${sentence(caught instanceof Error ? caught.message : "That did not go through")} No place was taken.`);
      setBusy(false);
    }
  }

  return (
    <div className="find-care queue-page">
      <form className="find-list glass queue-panel" aria-labelledby="queue-title" onSubmit={take}>
        <header className="find-head">
          <Link to="/find-care" className="square-button" aria-label="Back to Find care">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <h1 id="queue-title">See a doctor</h1>
            <p>{unit ? `A general consultation at the ${unit.name}` : "Loading"}</p>
          </div>
        </header>
        <p className="queue-explain">
          <Users size={17} />
          Take a place in a session. You are told when to arrive, and a doctor sees you in the order places were taken. We text you if the
          queue moves.
        </p>

        {!unit ? (
          state.status === "ready" ? (
            <Notice tone="info">No unit runs a queue at the moment.</Notice>
          ) : (
            <LoadingIndicator size={28} label="Loading" />
          )
        ) : sessions === null ? (
          <LoadingIndicator size={28} label="Loading sessions" />
        ) : !days.length ? (
          <p className="today-empty">No sessions are published for the next two weeks yet. The desk can add you when you arrive.</p>
        ) : (
          <>
            <p className="dialog-label">DAY</p>
            <div className="days" role="radiogroup" aria-label="Day">
              {days.slice(0, 7).map((date) => {
                const places = (sessions ?? []).filter((s) => s.sessionDate === date).reduce((n, s) => n + s.remaining, 0);
                const on = date === day;
                return (
                  <button
                    key={date}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={!places}
                    className={`day${on ? " day-on" : ""}${places ? "" : " day-closed"}`}
                    onClick={() => {
                      setDay(date);
                      setChosen(null);
                    }}
                  >
                    <span className="day-name">{clock.weekday(`${date}T12:00:00Z`)}</span>
                    <span className="day-number">{Number(date.slice(8))}</span>
                    <span className="day-free">{places ? `${places} places` : "Full"}</span>
                  </button>
                );
              })}
            </div>
            <p className="dialog-label">PART OF THE DAY</p>
            <ul className="queue-sessions" role="radiogroup" aria-label="Session">
              {onDay.map((s) => {
                const on = s.sessionId === chosen;
                return (
                  <li key={s.sessionId}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={!s.remaining}
                      className={`queue-session${on ? " queue-session-on" : ""}`}
                      onClick={() => setChosen(s.sessionId)}
                    >
                      <span className="queue-session-part">{PART[s.partOfDay]}</span>
                      <span className="queue-session-time">
                        <Clock size={14} />
                        {s.startTime} to {s.endTime}
                      </span>
                      <span className={`chip ${s.remaining ? "chip-confirmed" : "chip-neutral"}`}>
                        {s.remaining ? `${s.remaining} of ${s.capacity} places left` : "Full"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {failure && <Notice tone="error">{failure}</Notice>}
        <div className="dock queue-dock">
          <div className="dock-row">
            <span className="dock-selection">
              <span className="dock-label">{session ? "Your place" : "No session chosen"}</span>
              <span className="dock-title">
                {session
                  ? `${clock.day(`${session.sessionDate}T12:00:00Z`)}, ${PART[session.partOfDay].toLowerCase()}, place ${session.issuedTickets + 1}`
                  : "Choose a day and a part of the day"}
              </span>
            </span>
            <button type="submit" className="dock-button" disabled={!session || busy} aria-busy={busy || undefined}>
              {busy ? "Taking a place" : "Take a place"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function RequestProcedure() {
  const { state, reload } = usePatientData();
  const navigate = useNavigate();
  const data = state.status === "ready" ? state.data : undefined;
  const procedures = (data?.types ?? []).filter((t) => t.serviceLine === "PROCEDURE" && t.patientRequestable);
  const [typeId, setTypeId] = useState<string | null>(null);
  const type = procedures.find((t) => t.appointmentTypeId === typeId) ?? procedures[0];
  const units = (data?.clinics ?? []).filter((c) => type && offeredAt(type, c.clinicId));
  const [clinicId, setClinicId] = useState<string | null>(null);
  const unit = units.find((c) => c.clinicId === clinicId) ?? units[0];
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!type || !unit) return;
    setBusy(true);
    setFailure(null);
    try {
      const made = await api<Appointment>("/procedure-requests", {
        method: "POST",
        json: { appointmentTypeId: type.appointmentTypeId, clinicId: unit.clinicId, note: note.trim() },
      });
      await reload();
      navigate(`/visits/${made.appointmentId}`);
    } catch (caught) {
      setFailure(`${sentence(caught instanceof Error ? caught.message : "That did not go through")} Nothing was sent.`);
      setBusy(false);
    }
  }

  return (
    <div className="find-care queue-page">
      <form className="find-list glass queue-panel" aria-labelledby="request-title" onSubmit={send}>
        <header className="find-head">
          <Link to="/find-care" className="square-button" aria-label="Back to Find care">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <h1 id="request-title">Request a procedure</h1>
            <p>No time is held yet. The unit sizes it and offers you a time to confirm.</p>
          </div>
        </header>
        <div className="off-fields">
          <div className="off-field">
            <span>Procedure</span>
            <SelectMenu
              label="Procedure"
              value={type?.appointmentTypeId ?? null}
              width={320}
              icon={<Stethoscope size={15} />}
              options={procedures.map((t) => ({ id: t.appointmentTypeId, label: t.name }))}
              onChange={(id) => {
                setTypeId(id);
                setClinicId(null);
              }}
            />
          </div>
          <div className="off-field">
            <span>Unit</span>
            <SelectMenu
              label="Unit"
              value={unit?.clinicId ?? null}
              width={320}
              options={units.map((c) => ({ id: c.clinicId, label: c.name }))}
              onChange={setClinicId}
            />
          </div>
        </div>
        <label className="settings-label" htmlFor="request-note">
          What it is for
        </label>
        <textarea
          id="request-note"
          className="dialog-text"
          maxLength={500}
          placeholder="A few words for the unit, for example what the doctor who referred you said"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <p className="queue-explain">
          <Clock size={17} />
          You can follow the request in your visits. Nothing is charged, and nothing happens until you confirm a time.
        </p>
        {failure && <Notice tone="error">{failure}</Notice>}
        <div className="dock queue-dock">
          <div className="dock-row">
            <span className="dock-selection">
              <span className="dock-label">Request</span>
              <span className="dock-title">{type && unit ? `${type.name}, ${unit.name}` : "Choose a procedure"}</span>
            </span>
            <button type="submit" className="dock-button" disabled={!type || !unit || busy} aria-busy={busy || undefined}>
              {busy ? "Sending" : "Send request"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
