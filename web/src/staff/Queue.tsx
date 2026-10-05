/**
 * The outpatient queue, for the desk, the doctors and the unit manager (FR-BKG-10, FR-BKG-13).
 *
 * Two tabs. The live queue: today's session in position order, online and
 * walk-in tickets together, each with its arrival window and state; the desk
 * records arrivals and adds walk-ins, and a doctor calls the next patient who
 * has arrived, which is when a doctor is assigned. Planned against actual pace
 * sits on top. Sessions: what is published for the fortnight, and for a unit
 * manager, publishing one (a date, a window and the doctors rostered; the
 * capacity is worked out, never typed) and closing it at the end of the day.
 *
 * Built from the console's parts: Staff accounts' rows, the segmented tabs,
 * the platform's pickers, and the dialogs of Availability.
 */

import { type CSSProperties, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate } from "react-router-dom";

import { api } from "../api/client";
import { useSession } from "../auth/session";
import { Notice } from "../components/controls";
import { Close, Plus, Users } from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { LoadingPane, LoadingRow } from "../components/LoadingPane";
import { Pager, usePages, useRowsThatFit } from "../components/Pager";
import { DatePicker, SelectMenu } from "../components/Pickers";
import { timeOptions } from "../components/WeekHours";
import { MATRIX } from "../generated/permissions";
import { type Appointment, clock, initials, offeredAt } from "../patient/data";
import { doctor, roleOf, useStaffData } from "./data";
import { sentence, staffState } from "./labels";
import { fullName, type RegisterEntry, useRegisterSearch } from "./Patients";
import { Snackbar } from "./Snackbar";

export interface Session {
  sessionId: string;
  clinicId: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  rosteredClinicianCount: number;
  expectedThroughputPerHour: string;
  actualThroughputPerHour: string | null;
  capacity: number;
  issuedTickets: number;
  remaining: number;
  partOfDay: "MORNING" | "AFTERNOON" | "EVENING";
  status: "OPEN" | "RUNNING" | "CLOSED";
}

interface LiveQueue extends Session {
  appointments: Appointment[];
  patients: Record<string, { givenName: string | null; familyName: string | null }>;
  waiting: number;
  arrived: number;
  inConsultation: number;
  seen: number;
  plannedPerHour: number;
  actualPerHour: number | null;
}

const PART = { MORNING: "Morning", AFTERNOON: "Afternoon", EVENING: "Evening" } as const;
const STATUS: Record<Session["status"], { label: string; tone: string }> = {
  OPEN: { label: "Open", tone: "booked" },
  RUNNING: { label: "Running", tone: "confirmed" },
  CLOSED: { label: "Closed", tone: "neutral" },
};

const can = (role: string, permission: keyof typeof MATRIX) => (MATRIX[permission] as Record<string, string>)[role] !== "none";

export function QueuePage() {
  const { state } = useSession();
  const { state: directory } = useStaffData();
  const me = state.status === "signed-in" ? state.me : undefined;
  const role = me ? roleOf(me) : "RECEPTIONIST";
  const clinicId = me?.clinicId ?? null;
  const today = clock.isoDate(new Date());
  const [tab, setTab] = useState<"live" | "sessions">("live");
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [fresh, setFresh] = useState(0);
  const [said, setSaid] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  // Seen once this session, "/console" is the schedule again (StaffShell).
  useEffect(() => {
    try {
      sessionStorage.setItem("atria.queue", "1");
    } catch {
      // Without storage StaffShell keeps the schedule as the landing.
    }
  }, []);

  useEffect(() => {
    if (!clinicId) return;
    let live = true;
    api<{ sessions: Session[] }>(`/clinics/${encodeURIComponent(clinicId)}/sessions`)
      .then((found) => live && setSessions(found.sessions))
      .catch(() => live && setFailure("The sessions could not be loaded. Check your connection and try again."));
    return () => {
      live = false;
    };
  }, [clinicId, fresh]);

  if (state.status !== "signed-in") return null;
  if (!clinicId) return <Navigate to="/console" replace />;

  const unit = directory.status === "ready" ? directory.data.clinics.find((c) => c.clinicId === clinicId) : undefined;
  const todays = (sessions ?? []).filter((s) => s.sessionDate === today);
  const publishes = can(role, "session.publish");
  const done = (message: string) => {
    setSaid(message);
    setFresh((n) => n + 1);
  };

  return (
    <div className="accounts-page queue-console">
      <header className="accounts-top">
        <div>
          <h1>Queue</h1>
          <p>{unit?.name ?? "Your unit"} · general consultations in the order places were taken</p>
        </div>
        {tab === "sessions" && publishes && (
          <button type="button" className="staff-primary accounts-new" onClick={() => setPublishing(true)}>
            <Plus size={16} />
            Publish a session
          </button>
        )}
      </header>
      <div className="segmented settings-tabs" role="tablist" aria-label="Queue">
        {(
          [
            ["live", "Today's queue"],
            ["sessions", "Sessions"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`segment${tab === id ? " segment-on" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {failure && <Notice tone="error">{failure}</Notice>}
      {tab === "live" ? (
        sessions === null ? (
          <LoadingPane label="Loading" />
        ) : todays.length ? (
          <LiveQueueCard key={`${todays[0]!.sessionId}-${fresh}`} sessions={todays} onDone={done} />
        ) : (
          <section className="glass accounts-card">
            <p className="today-empty patients-empty">
              <Users size={20} />
              No session is published for today. {publishes ? "Publish one in Sessions." : "The unit manager publishes sessions."}
            </p>
          </section>
        )
      ) : (
        <SessionsCard sessions={sessions} canClose={publishes} onDone={done} />
      )}
      {publishing && clinicId && (
        <PublishDialog
          clinicId={clinicId}
          onClose={() => setPublishing(false)}
          onDone={(message) => {
            setPublishing(false);
            done(message);
          }}
        />
      )}
      <Snackbar message={said} onDone={() => setSaid(null)} />
    </div>
  );
}

function LiveQueueCard({ sessions, onDone }: { sessions: Session[]; onDone: (message: string) => void }) {
  const { state } = useSession();
  const { state: directory } = useStaffData();
  const me = state.status === "signed-in" ? state.me : undefined;
  const role = me ? roleOf(me) : "RECEPTIONIST";
  const [sessionId, setSessionId] = useState(sessions.find((s) => s.status !== "CLOSED")?.sessionId ?? sessions[0]!.sessionId);
  const [found, setFound] = useState<LiveQueue | null>(null);
  const [fresh, setFresh] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [doctorId, setDoctorId] = useState<string | null>(null);

  const load = useCallback(() => setFresh((n) => n + 1), []);
  const rowsBox = useRef<HTMLUListElement>(null);
  const size = useRowsThatFit(rowsBox, { row: ".queue-row", pitch: 76 });
  const pages = usePages(found?.appointments ?? [], size, sessionId);
  useEffect(() => {
    let live = true;
    api<LiveQueue>(`/sessions/${encodeURIComponent(sessionId)}/queue`)
      .then((data) => {
        if (!live) return;
        setFound(data);
        setFailure(null);
      })
      .catch((error: unknown) => live && setFailure(error instanceof Error ? sentence(error.message) : "The queue could not be loaded."));
    // The queue moves while the desk watches it.
    const every = window.setInterval(load, 30000);
    return () => {
      live = false;
      window.clearInterval(every);
    };
  }, [sessionId, fresh, load]);

  const doctors = useMemo(
    () => (directory.status === "ready" ? directory.data.clinicians.filter((c) => c.clinicId === me?.clinicId) : []),
    [directory, me?.clinicId],
  );
  const iAmDoctor = role === "CLINICIAN";
  const calls = can(role, "queue.assign_next");

  async function step(path: string, message: string, body?: unknown, settle?: (queue: LiveQueue) => LiveQueue) {
    setBusy(path);
    setFailure(null);
    try {
      await api(path, { method: "POST", ...(body ? { json: body } : {}) });
      // Shown at once, so "Call next" is ready without waiting for the
      // queue to be read again (audit 2026-10-05); the read then confirms it.
      if (settle) setFound((shown) => (shown ? settle(shown) : shown));
      onDone(message);
      load();
    } catch (caught) {
      setFailure(`${sentence(caught instanceof Error ? caught.message : "That did not go through")}`);
    } finally {
      setBusy(null);
    }
  }

  const session = found ?? sessions.find((s) => s.sessionId === sessionId);
  return (
    <section className="glass accounts-card queue-live" aria-label="Today's queue" aria-busy={!found || undefined}>
      <div className="settings-card-top queue-live-top">
        {sessions.length > 1 ? (
          <div className="segmented" role="radiogroup" aria-label="Session">
            {sessions.map((s) => (
              <button
                key={s.sessionId}
                type="button"
                role="radio"
                aria-checked={s.sessionId === sessionId}
                className={`segment${s.sessionId === sessionId ? " segment-on" : ""}`}
                onClick={() => setSessionId(s.sessionId)}
              >
                {PART[s.partOfDay]}
              </button>
            ))}
          </div>
        ) : (
          <span className="queue-live-title">
            {session ? `${PART[session.partOfDay]}, ${session.startTime} to ${session.endTime}` : ""}
          </span>
        )}
        {found && (
          <dl className="queue-stats">
            <div>
              <dt>Waiting</dt>
              <dd>{found.waiting}</dd>
            </div>
            <div>
              <dt>Here</dt>
              <dd>{found.arrived}</dd>
            </div>
            <div>
              <dt>Seen</dt>
              <dd>{found.seen}</dd>
            </div>
            <div>
              <dt>Pace</dt>
              <dd>
                {found.actualPerHour == null ? "–" : perHour(found.actualPerHour)} of {perHour(found.plannedPerHour)} an hour
              </dd>
            </div>
          </dl>
        )}
      </div>
      {failure && <Notice tone="error">{failure}</Notice>}
      <div className="queue-actions">
        <button type="button" className="tonal-button" onClick={() => setAdding(true)}>
          <Plus size={15} />
          Add a walk-in
        </button>
        {calls && (
          <span className="queue-call">
            {!iAmDoctor && (
              <SelectMenu
                label="Doctor"
                value={doctorId}
                width={260}
                options={doctors.map((d) => ({ id: d.clinicianProfileId, label: doctor(d) }))}
                onChange={setDoctorId}
              />
            )}
            <button
              type="button"
              className="staff-primary"
              disabled={!found?.arrived || busy !== null || (!iAmDoctor && !doctorId)}
              onClick={() =>
                void step(
                  `/sessions/${sessionId}/next`,
                  "The next patient is called in.",
                  iAmDoctor ? undefined : { clinicianProfileId: doctorId },
                )
              }
            >
              {iAmDoctor ? "Call my next patient" : "Call next patient"}
            </button>
          </span>
        )}
      </div>
      <ul ref={rowsBox} className="accounts-rows queue-rows">
        {!found ? (
          <LoadingRow label="Loading the queue" />
        ) : found.appointments.length ? (
          pages.shown.map((t, index) => {
            const name = found.patients[t.patientProfileId] ?? { givenName: null, familyName: null };
            const shown = staffState(t.state);
            const gone = ["COMPLETED", "NO_SHOW", "PATIENT_CANCELLED", "CLINIC_CANCELLED", "AWAITING_FEEDBACK"].includes(t.state);
            const assigned = doctors.find((d) => d.clinicianProfileId === t.clinicianProfileId);
            return (
              <li
                key={t.appointmentId}
                className={`account-row queue-row${gone ? " account-row-off" : ""}`}
                style={{ "--i": index } as CSSProperties}
              >
                <span className="queue-position">{t.position}</span>
                <span className="account-who">
                  <span className="account-avatar" aria-hidden="true">
                    {initials(name.givenName, name.familyName) || "?"}
                  </span>
                  <span className="account-text">
                    <Link className="account-name" to={`/console/visits/${t.appointmentId}`}>
                      {[name.givenName, name.familyName].filter(Boolean).join(" ") || "Patient"}
                    </Link>
                    <span className="account-sub">
                      {t.channel === "WALK_IN" ? "Walk-in" : t.channel === "PHONE" ? "By phone" : "Online"} · {t.reference}
                    </span>
                  </span>
                </span>
                <span className="account-role">
                  <span>
                    {clock.time(t.arrivalWindowStart ?? t.startAt)} to {clock.time(t.arrivalWindowEnd ?? t.endAt)}
                  </span>
                  <span>{assigned ? doctor(assigned) : "No doctor yet"}</span>
                </span>
                <span>
                  <span className={`chip chip-${shown.tone}`}>
                    {t.state === "BOOKED" || t.state === "CONFIRMED" ? "Waiting" : shown.label}
                  </span>
                </span>
                <span className="account-actions">
                  {["BOOKED", "CONFIRMED"].includes(t.state) && (
                    <button
                      type="button"
                      className="outline-button queue-arrive"
                      disabled={busy !== null}
                      onClick={() =>
                        void step(`/appointments/${t.appointmentId}/arrive`, "Arrival recorded.", undefined, (queue) => ({
                          ...queue,
                          waiting: Math.max(0, queue.waiting - 1),
                          arrived: queue.arrived + 1,
                          appointments: queue.appointments.map((a) => (a.appointmentId === t.appointmentId ? { ...a, state: "ARRIVED" } : a)),
                        }))
                      }
                    >
                      Arrived
                    </button>
                  )}
                  {t.state === "IN_CONSULTATION" && (iAmDoctor || role === "CLINIC_MANAGER") && (
                    <button
                      type="button"
                      className="outline-button queue-arrive"
                      disabled={busy !== null}
                      onClick={() => void step(`/appointments/${t.appointmentId}/complete`, "Consultation closed.")}
                    >
                      Done
                    </button>
                  )}
                </span>
              </li>
            );
          })
        ) : (
          <li className="today-empty">Nobody has a place in this session yet.</li>
        )}
      </ul>
      {found && found.appointments.length > 0 && (
        <Pager
          noun="places"
          first={pages.first}
          last={pages.last}
          total={pages.total}
          page={pages.page}
          pages={pages.pages}
          onPrevious={pages.previous}
          onNext={pages.next}
        />
      )}
      {adding && (
        <WalkInDialog
          sessionId={sessionId}
          onClose={() => setAdding(false)}
          onDone={(message) => {
            setAdding(false);
            onDone(message);
            load();
          }}
        />
      )}
    </section>
  );
}

function WalkInDialog({ sessionId, onClose, onDone }: { sessionId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const { results } = useRegisterSearch(query);
  const [patient, setPatient] = useState<RegisterEntry | null>(null);
  const [channel, setChannel] = useState<"WALK_IN" | "PHONE">("WALK_IN");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!patient) return;
    setBusy(true);
    setFailure(null);
    try {
      const made = await api<{ position: number }>(`/sessions/${sessionId}/tickets`, {
        method: "POST",
        json: { patientProfileId: patient.patientProfileId, channel },
      });
      onDone(`${fullName(patient)} is number ${made.position} in the queue.`);
    } catch (caught) {
      setFailure(`${sentence(caught instanceof Error ? caught.message : "That did not go through")} No place was taken.`);
      setBusy(false);
    }
  }

  return createPortal(
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div
        className="dialog staff-dialog move-dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="walk-in-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="icon-button dialog-close" aria-label="Close" onClick={onClose} disabled={busy}>
          <Close size={16} />
        </button>
        <div className="move-scroll">
          <span className="dialog-icon dialog-icon-blue" aria-hidden="true">
            <Users size={22} />
          </span>
          <h2 id="walk-in-title">Add to the queue</h2>
          <p className="dialog-lede">
            They join the same queue as online places, at the next number. A patient not yet registered is added in Patients first.
          </p>
          <form id="walk-in-form" className="settings-dialog-form" onSubmit={submit}>
            {patient ? (
              <div className="book-patient">
                <span className="account-text">
                  <span className="account-name">{fullName(patient)}</span>
                  <span className="account-sub">{patient.patientNumber}</span>
                </span>
                <button type="button" className="square-button" aria-label="Choose another patient" onClick={() => setPatient(null)}>
                  <Close size={15} />
                </button>
              </div>
            ) : (
              <>
                <label className="find-search">
                  <input
                    type="text"
                    aria-label="Find the patient"
                    placeholder="Name, mobile or patient number"
                    value={query}
                    autoFocus
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <ul className="book-results">
                  {(results ?? []).slice(0, 5).map((p) => (
                    <li key={p.patientProfileId}>
                      <button type="button" className="suggest-item" onClick={() => setPatient(p)}>
                        <span className="suggest-text">
                          <span className="suggest-main">{fullName(p)}</span>
                          <span className="suggest-hint">{p.patientNumber}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="segmented" role="radiogroup" aria-label="How they reached you">
              {(["WALK_IN", "PHONE"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={channel === c}
                  className={`segment${channel === c ? " segment-on" : ""}`}
                  onClick={() => setChannel(c)}
                >
                  {c === "WALK_IN" ? "At the desk" : "By phone"}
                </button>
              ))}
            </div>
            {failure && <Notice tone="error">{failure}</Notice>}
          </form>
        </div>
        <div className="dialog-actions move-actions">
          <button type="button" className="outline-button keep" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="walk-in-form" className="staff-primary" disabled={!patient || busy} aria-busy={busy || undefined}>
            {busy ? <LoadingIndicator size={20} label="Adding" /> : null}
            {busy ? "Adding" : "Give them a place"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SessionsCard({
  sessions,
  canClose,
  onDone,
}: {
  sessions: Session[] | null;
  canClose: boolean;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const rowsBox = useRef<HTMLUListElement>(null);
  const size = useRowsThatFit(rowsBox, { row: ".session-row", pitch: 76 });
  const pages = usePages(sessions ?? [], size, "sessions");
  async function close(session: Session) {
    setBusy(session.sessionId);
    try {
      await api(`/sessions/${session.sessionId}/close`, { method: "POST" });
      onDone("Session closed. Its pace now informs the next sessions' capacity.");
    } catch (caught) {
      setFailure(sentence(caught instanceof Error ? caught.message : "That did not go through"));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="glass accounts-card" aria-label="Sessions">
      {failure && <Notice tone="error">{failure}</Notice>}
      <div className="accounts-head sessions-head" aria-hidden="true">
        <span>DAY</span>
        <span>DOCTORS</span>
        <span>PLACES</span>
        <span>PACE</span>
      </div>
      <ul ref={rowsBox} className="accounts-rows">
        {!sessions ? (
          <LoadingRow label="Loading sessions" />
        ) : sessions.length ? (
          pages.shown.map((s, index) => {
            const status = STATUS[s.status];
            return (
              <li key={s.sessionId} className="account-row session-row" style={{ "--i": index } as CSSProperties}>
                <span className="account-text">
                  <span className="account-name">
                    {clock.day(`${s.sessionDate}T12:00:00Z`)}, {PART[s.partOfDay].toLowerCase()}
                  </span>
                  <span className="account-sub">
                    {s.startTime} to {s.endTime}
                  </span>
                </span>
                <span className="account-role">
                  <span>{s.rosteredClinicianCount} rostered</span>
                </span>
                <span className="account-role">
                  <span>
                    {s.issuedTickets} of {s.capacity} taken
                  </span>
                  <span className={`chip chip-${status.tone}`}>{status.label}</span>
                </span>
                <span className="account-role">
                  <span>{s.expectedThroughputPerHour} planned an hour</span>
                  <span>{s.actualThroughputPerHour ? `${s.actualThroughputPerHour} achieved` : "Not closed yet"}</span>
                </span>
                <span className="account-actions">
                  {canClose && s.status !== "CLOSED" && (
                    <button type="button" className="outline-button queue-arrive" disabled={busy !== null} onClick={() => void close(s)}>
                      Close
                    </button>
                  )}
                </span>
              </li>
            );
          })
        ) : (
          <li className="today-empty">No sessions in the next two weeks.</li>
        )}
      </ul>
      {sessions && sessions.length > 0 && (
        <Pager
          noun="sessions"
          first={pages.first}
          last={pages.last}
          total={pages.total}
          page={pages.page}
          pages={pages.pages}
          onPrevious={pages.previous}
          onNext={pages.next}
        />
      )}
    </section>
  );
}

function PublishDialog({ clinicId, onClose, onDone }: { clinicId: string; onClose: () => void; onDone: (message: string) => void }) {
  const today = clock.isoDate(new Date());
  const [date, setDate] = useState(today);
  const [start, setStart] = useState("07:30");
  const [end, setEnd] = useState("12:00");
  const [rostered, setRostered] = useState("2");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const made = await api<Session>(`/clinics/${encodeURIComponent(clinicId)}/sessions`, {
        method: "POST",
        json: { date, startTime: start, endTime: end, rosteredClinicianCount: Number(rostered) },
      });
      onDone(`Session published with ${made.capacity} places.`);
    } catch (caught) {
      setFailure(`${sentence(caught instanceof Error ? caught.message : "The session could not be published")} Nothing was published.`);
      setBusy(false);
    }
  }

  return createPortal(
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div
        className="dialog staff-dialog move-dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="icon-button dialog-close" aria-label="Close" onClick={onClose} disabled={busy}>
          <Close size={16} />
        </button>
        <div className="move-scroll">
          <span className="dialog-icon dialog-icon-blue" aria-hidden="true">
            <Users size={22} />
          </span>
          <h2 id="publish-title">Publish a session</h2>
          <p className="dialog-lede">
            The number of places is worked out from the doctors rostered and the pace the unit's recent sessions kept. It is never typed.
          </p>
          <form id="publish-form" className="settings-dialog-form" onSubmit={submit}>
            <div className="off-fields">
              <div className="off-field">
                <span>Day</span>
                <DatePicker label="Day" value={date} min={today} onChange={setDate} />
              </div>
              <div className="off-field">
                <span>Doctors rostered</span>
                <SelectMenu
                  label="Doctors rostered"
                  value={rostered}
                  width={200}
                  options={[1, 2, 3, 4, 5, 6].map((n) => ({ id: String(n), label: n === 1 ? "1 doctor" : `${n} doctors` }))}
                  onChange={setRostered}
                />
              </div>
            </div>
            <div className="off-fields">
              <div className="off-field">
                <span>From</span>
                <SelectMenu label="From" value={start} width={160} options={timeOptions(start)} onChange={setStart} />
              </div>
              <div className="off-field">
                <span>Until</span>
                <SelectMenu label="Until" value={end} width={160} options={timeOptions(end)} onChange={setEnd} />
              </div>
            </div>
            {failure && <Notice tone="error">{failure}</Notice>}
          </form>
        </div>
        <div className="dialog-actions move-actions">
          <button type="button" className="outline-button keep" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="publish-form" className="staff-primary" disabled={busy || end <= start} aria-busy={busy || undefined}>
            {busy ? <LoadingIndicator size={20} label="Publishing" /> : null}
            {busy ? "Publishing" : "Publish"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Patients an hour, to one decimal: the API keeps two. */
const perHour = (value: number) => String(Math.round(value * 10) / 10);

/** Whether a unit runs a queue: it offers a general consultation (the outpatient department). */
export function runsQueue(types: { serviceLine: string; clinicIds?: string[] | null }[], clinicId: string | null | undefined): boolean {
  return types.some((t) => t.serviceLine === "GENERAL" && offeredAt(t as never, clinicId));
}
