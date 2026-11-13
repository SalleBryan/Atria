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

import { type CSSProperties, type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate } from "react-router-dom";

import { api } from "../api/client";
import { startPolling } from "../api/network";
import { useSession } from "../auth/session";
import { Notice } from "../components/controls";
import { Close, Plus, Users } from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { LoadingPane, LoadingRow } from "../components/LoadingPane";
import { PAGE_ROWS, Pager, usePages } from "../components/Pager";
import { DatePicker, SelectMenu } from "../components/Pickers";
import { timeOptions } from "../components/WeekHours";
import { MATRIX } from "../generated/permissions";
import { type Appointment, clock, feeText, initials, offeredAt } from "../patient/data";
import { doctor, roleOf, useStaffData } from "./data";
import { sentence, staffState } from "./labels";
import { fullName, type RegisterEntry, useRegisterSearch } from "./Patients";
import { type QueuePolicy, QueueRulesDialog } from "./QueueRules";
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

/** The fee a place will be asked for at the hospital, in whole currency units. Null when the visit has no fee band. */
interface DeskFee {
  amountMinor: number;
  currency: string;
}

/** "Fee 5,000 XAF", "Free", or nothing when the visit's type has no fee band. Nothing is collected in Atria. */
export function deskFee(fee: DeskFee | null | undefined): string | null {
  if (!fee) return null;
  if (fee.amountMinor === 0) return "Free";
  return `Fee ${feeText({ feeAmountMinor: fee.amountMinor, feeCurrency: fee.currency })}`;
}

/** What the desk needs to see about a ticket beside its state (ADR 0022). */
interface TicketFlags {
  fee?: DeskFee | null;
  due?: boolean;
  late?: boolean;
  bypassCount?: number;
  urgent?: boolean;
  invite?: EarlyCallInvite | null;
}

/** An early-call invitation on a ticket (ADR 0022 R4). Replying moves nobody. */
export interface EarlyCallInvite {
  status: "open" | "accepted" | "declined" | "expired";
  sentAt: string;
  expiresAt: string;
  answer: "YES" | "NO" | null;
  eta: string | null;
}

/** What the desk may do about invitations now. */
interface InviteOutlook {
  mode: "desk" | "auto";
  fanout: number;
  openMinutes: number;
  open: number;
  eligible: string[];
}

/** What calling the next patient would do now, so the desk sees the cost first. */
interface CallPreview {
  candidate: string | null;
  bypassed: { appointmentId: string; position: number; windowEnd: string | null }[];
  hold: { appointmentId: string; position: number; until: string } | null;
  expectedConsultMinutes: number;
  wouldBreachWindow: boolean;
}

type Asking = { kind: "urgent"; appointmentId: string; name: string } | { kind: "override" } | { kind: "confirm" };

interface LiveQueue extends Session {
  appointments: (Appointment & TicketFlags)[];
  callPreview?: CallPreview;
  /** The fee a walk-in will be asked for, from the unit's general consultation. */
  walkInFee?: DeskFee | null;
  policy?: QueuePolicy;
  invites?: InviteOutlook;
  patients: Record<string, { givenName: string | null; familyName: string | null }>;
  waiting: number;
  arrived: number;
  inConsultation: number;
  seen: number;
  plannedPerHour: number;
  actualPerHour: number | null;
}

const INVITE_CHIP: Record<EarlyCallInvite["status"], { label: string; tone: string }> = {
  open: { label: "Invited", tone: "booked" },
  accepted: { label: "Coming", tone: "confirmed" },
  declined: { label: "Said no", tone: "neutral" },
  expired: { label: "Invite ended", tone: "neutral" },
};

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
  const [unitRules, setUnitRules] = useState(false);

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
        <span className="queue-header-actions">
          {clinicId && can(role, "queue.configure") && (
            <button type="button" className="outline-button" onClick={() => setUnitRules(true)}>
              Queue rules
            </button>
          )}
          {tab === "sessions" && publishes && (
            <button type="button" className="staff-primary accounts-new" onClick={() => setPublishing(true)}>
              <Plus size={16} />
              Publish a session
            </button>
          )}
        </span>
      </header>
      {unitRules && clinicId && (
        <QueueRulesDialog
          level="unit"
          path={`/clinics/${encodeURIComponent(clinicId)}/queue-policy`}
          title={`Queue rules for ${unit?.name ?? "this unit"}`}
          onClose={() => setUnitRules(false)}
          onDone={(message) => {
            setUnitRules(false);
            done(message);
          }}
        />
      )}
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
  const [rules, setRules] = useState(false);
  const [doctorId, setDoctorId] = useState<string | null>(null);
  // A dialog that asks for a reason, or a confirm, before a call or an urgent mark.
  const [asking, setAsking] = useState<Asking | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const every = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(every);
  }, []);

  const load = useCallback(() => setFresh((n) => n + 1), []);
  const pages = usePages(found?.appointments ?? [], PAGE_ROWS, sessionId);
  useEffect(() => {
    let live = true;
    api<LiveQueue>(`/sessions/${encodeURIComponent(sessionId)}/queue`)
      .then((data) => {
        if (!live) return;
        setFound(data);
        setFailure(null);
      })
      .catch((error: unknown) => live && setFailure(error instanceof Error ? sentence(error.message) : "The queue could not be loaded."));
    // The queue moves while the desk watches it. Paused offline or in a hidden tab (audit F16).
    const stopPolling = startPolling(load, 30000);
    return () => {
      live = false;
      stopPolling();
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

  const preview = found?.callPreview;
  const hold = preview?.hold ?? null;
  const holdMinutes = hold ? Math.max(0, Math.ceil((Date.parse(hold.until) - now) / 60000)) : 0;
  const marksUrgent = can(role, "queue.mark_urgent");
  const nameOf = (appointmentId: string) => {
    const ticket = found?.appointments.find((a) => a.appointmentId === appointmentId);
    const who = ticket ? found?.patients[ticket.patientProfileId] : undefined;
    return [who?.givenName, who?.familyName].filter(Boolean).join(" ") || "A booked patient";
  };
  const passed = preview?.bypassed ?? [];
  const callBody = (extra?: { overrideHold: true; reason: string }) => (iAmDoctor ? extra : { clinicianProfileId: doctorId, ...extra });
  const callNext = (extra?: { overrideHold: true; reason: string }) =>
    step(`/sessions/${sessionId}/next`, "The next patient is called in.", callBody(extra));

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
              <dt>With a doctor</dt>
              <dd>{found.inConsultation}</dd>
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
        {can(role, "queue.tune_session") && found && session?.status !== "CLOSED" && (
          <button type="button" className="outline-button" onClick={() => setRules(true)}>
            Rules for today
          </button>
        )}
        {can(role, "queue.invite") && found?.invites && session?.status !== "CLOSED" && (
          <button
            type="button"
            className="outline-button"
            disabled={busy !== null || found.invites.eligible.length === 0}
            title={
              found.invites.eligible.length === 0
                ? "Nobody can be invited now: someone is here, every doctor is busy, or the invitations are already out."
                : undefined
            }
            onClick={() =>
              void step(
                `/sessions/${sessionId}/invites`,
                `${found.invites?.eligible.length === 1 ? "1 patient is" : `${found.invites?.eligible.length} patients are`} invited to come earlier.`,
                {},
              )
            }
          >
            Invite to come earlier
          </button>
        )}
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
              disabled={!found?.arrived || busy !== null || (!iAmDoctor && !doctorId) || hold !== null}
              onClick={() => (preview?.wouldBreachWindow ? setAsking({ kind: "confirm" }) : void callNext())}
            >
              {iAmDoctor ? "Call my next patient" : "Call next patient"}
            </button>
          </span>
        )}
      </div>
      {calls && hold && (
        <Notice tone="info">
          <strong>The doctor is held for {nameOf(hold.appointmentId)}</strong>, place {hold.position}, who was passed over once and has not
          arrived. {holdMinutes > 0 ? `${holdMinutes} min left.` : "The hold is ending."} Phone them. If they are not coming, call the next
          patient anyway.{" "}
          <button
            type="button"
            className="outline-button queue-arrive"
            disabled={busy !== null || (!iAmDoctor && !doctorId)}
            onClick={() => setAsking({ kind: "override" })}
          >
            Call anyway
          </button>
        </Notice>
      )}
      {calls && !hold && passed.length > 0 && (
        <Notice tone="info">
          Calling the next patient passes over{" "}
          {passed
            .map((p) => `${nameOf(p.appointmentId)} (place ${p.position}${p.windowEnd ? `, window ends ${clock.time(p.windowEnd)}` : ""})`)
            .join(", ")}
          . A consultation here takes about {preview?.expectedConsultMinutes} min.
          {preview?.wouldBreachWindow ? " That runs past their window, so you will be asked to confirm." : ""} They are called next when
          they arrive.
        </Notice>
      )}
      <ul className="accounts-rows queue-rows">
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
                    {deskFee(t.fee) && <span className="account-sub">{deskFee(t.fee)}</span>}
                  </span>
                </span>
                <span className="account-role">
                  <span>
                    {clock.time(t.arrivalWindowStart ?? t.startAt)} to {clock.time(t.arrivalWindowEnd ?? t.endAt)}
                  </span>
                  <span>{assigned ? doctor(assigned) : "No doctor yet"}</span>
                </span>
                <span className="queue-marks">
                  <span className={`chip chip-${shown.tone}`}>
                    {t.state === "BOOKED" || t.state === "CONFIRMED" ? "Waiting" : shown.label}
                  </span>
                  {t.urgent && <span className="chip chip-cancelled">Urgent</span>}
                  {t.late && <span className="chip chip-awaiting">Late</span>}
                  {t.due && !t.late && ["BOOKED", "CONFIRMED"].includes(t.state) && (
                    <span className="chip chip-awaiting">Not here yet</span>
                  )}
                  {!!t.bypassCount && <span className="chip chip-neutral">Passed over</span>}
                  {t.invite && ["BOOKED", "CONFIRMED", "RESCHEDULED"].includes(t.state) && (
                    <span className={`chip chip-${INVITE_CHIP[t.invite.status].tone}`}>
                      {t.invite.status === "accepted" && t.invite.eta
                        ? `Coming by ${clock.time(t.invite.eta)}`
                        : INVITE_CHIP[t.invite.status].label}
                    </span>
                  )}
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
                          appointments: queue.appointments.map((a) =>
                            a.appointmentId === t.appointmentId ? { ...a, state: "ARRIVED" } : a,
                          ),
                        }))
                      }
                    >
                      Arrived
                    </button>
                  )}
                  {marksUrgent && ["BOOKED", "CONFIRMED", "ARRIVED"].includes(t.state) && (
                    <button
                      type="button"
                      className="outline-button queue-arrive"
                      disabled={busy !== null}
                      onClick={() =>
                        t.urgent
                          ? void step(`/appointments/${t.appointmentId}/urgent`, "Urgent mark cleared.", { urgent: false })
                          : setAsking({
                              kind: "urgent",
                              appointmentId: t.appointmentId,
                              name: [name.givenName, name.familyName].filter(Boolean).join(" ") || "this patient",
                            })
                      }
                    >
                      {t.urgent ? "Clear urgent" : "Urgent"}
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
      {asking?.kind === "urgent" && (
        <ReasonDialog
          title={`Mark ${asking.name} urgent`}
          lede="An urgent place is called before anyone else who is here. Say why; it is kept with your name and the time."
          confirm="Mark urgent"
          onClose={() => setAsking(null)}
          onSubmit={async (reason) => {
            await step(`/appointments/${asking.appointmentId}/urgent`, `${asking.name} is marked urgent.`, { reason });
            setAsking(null);
          }}
        />
      )}
      {asking?.kind === "override" && (
        <ReasonDialog
          title="Call the next patient anyway"
          lede="The doctor is held for a booked patient who has not arrived. Say why the doctor is not waiting; it is kept on the consultation."
          confirm="Call anyway"
          onClose={() => setAsking(null)}
          onSubmit={async (reason) => {
            await callNext({ overrideHold: true, reason });
            setAsking(null);
          }}
        />
      )}
      {asking?.kind === "confirm" && (
        <ReasonDialog
          title="This call runs past a booked patient's window"
          lede={`The next consultation takes about ${preview?.expectedConsultMinutes} minutes and the patient passed over is due sooner. They will be called next when they arrive. Call the next patient now?`}
          confirm="Call now"
          reason={false}
          onClose={() => setAsking(null)}
          onSubmit={async () => {
            await callNext();
            setAsking(null);
          }}
        />
      )}
      {rules && found?.policy && (
        <QueueRulesDialog
          level="session"
          path={`/sessions/${encodeURIComponent(sessionId)}/policy`}
          title="Queue rules for this session"
          initial={found.policy}
          onClose={() => setRules(false)}
          onDone={(message) => {
            setRules(false);
            onDone(message);
            load();
          }}
        />
      )}
      {adding && (
        <WalkInDialog
          sessionId={sessionId}
          fee={deskFee(found?.walkInFee)}
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

/** Asks the desk for a reason (or only a confirm) before an act that others will see on the record. */
function ReasonDialog({
  title,
  lede,
  confirm,
  reason: needsReason = true,
  onClose,
  onSubmit,
}: {
  title: string;
  lede: string;
  confirm: string;
  reason?: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = !needsReason || reason.trim().length > 0;
  async function go() {
    if (!ready) return;
    setBusy(true);
    await onSubmit(reason.trim());
    setBusy(false);
  }
  return createPortal(
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div
        className="dialog staff-dialog move-dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reason-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="move-scroll">
          <button type="button" className="icon-button dialog-close" aria-label="Close" onClick={onClose} disabled={busy}>
            <Close size={16} />
          </button>
          <span className="dialog-icon dialog-icon-blue" aria-hidden="true">
            <Users size={22} />
          </span>
          <h2 id="reason-title">{title}</h2>
          <p className="dialog-lede">{lede}</p>
          {needsReason && (
            <div className="settings-dialog-form">
              <label className="settings-label" htmlFor="queue-reason">
                Reason
              </label>
              <textarea
                id="queue-reason"
                className="dialog-text"
                maxLength={200}
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}
        </div>
        <div className="dialog-actions move-actions">
          <button type="button" className="outline-button keep" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="staff-primary" disabled={!ready || busy} aria-busy={busy || undefined} onClick={() => void go()}>
            {busy ? <LoadingIndicator size={20} label="Working" /> : null}
            {busy ? "Working" : confirm}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function WalkInDialog({
  sessionId,
  fee,
  onClose,
  onDone,
}: {
  sessionId: string;
  fee: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
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
        <div className="move-scroll">
          <button type="button" className="icon-button dialog-close" aria-label="Close" onClick={onClose} disabled={busy}>
            <Close size={16} />
          </button>
          <span className="dialog-icon dialog-icon-blue" aria-hidden="true">
            <Users size={22} />
          </span>
          <h2 id="walk-in-title">Add to the queue</h2>
          <p className="dialog-lede">
            They join the same queue as online places, at the next number. A patient not yet registered is added in Patients first.
          </p>
          {fee && <p className="dialog-lede">{fee === "Free" ? "This visit is free." : `${fee}, asked for at the hospital.`}</p>}
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
  const pages = usePages(sessions ?? [], PAGE_ROWS, "sessions");
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
      <ul className="accounts-rows">
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
                  <span>{s.expectedThroughputPerHour} an hour per doctor, planned</span>
                  <span>{s.actualThroughputPerHour ? `${s.actualThroughputPerHour} an hour per doctor, achieved` : "Not closed yet"}</span>
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
        <div className="move-scroll">
          <button type="button" className="icon-button dialog-close" aria-label="Close" onClick={onClose} disabled={busy}>
            <Close size={16} />
          </button>
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
