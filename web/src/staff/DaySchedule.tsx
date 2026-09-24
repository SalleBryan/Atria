/**
 * "Desktop · Day schedule" (65:2): one day at the clinic, and the visit the
 * desk has selected (FR-STF-01, FR-VIS-02).
 *
 * A receptionist or clinic manager reads the clinic's whole day; a clinician
 * reads their own; an administrator picks a clinic. Where the frame shows
 * what Phase 1 does not have, the nearest true thing stands in:
 *
 * - Open slots and queued reminders are not figures Phase 1 can know for a
 *   whole clinic, so the tiles count what is still to come and which
 *   reminders are still to be sent, both from the appointments themselves.
 * - The Month, Year and Clinician views are Phase 2 (D-08), and so are search
 *   and the notification bell, so they are left out.
 * - Marking an arrival is Phase 2 (check-in), so the panel's first action
 *   opens the visit instead.
 *
 * Times are the clinic's, on the 24-hour clock (NFR-L10N-02).
 */

import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { useSession } from "../auth/session";
import { Button, Notice } from "../components/controls";
import { Bell, Calendar, CheckMark, ChevronLeft, ChevronRight, Clock, Close } from "../components/icons";
import { ACTIVE_STATES, type Appointment, clock, initials } from "../patient/data";
import {
  CANCELLED_STATES,
  doctor,
  fullName,
  isDate,
  joinDirectory,
  minutesOf,
  noonOf,
  patientName,
  readsOwnCalendar,
  reminderAt,
  roleOf,
  type Schedule,
  scheduleUrl,
  shiftDate,
  tally,
  today,
  useSchedule,
  useStaffData,
} from "./data";
import { CancelVisit } from "./CancelVisit";
import { BOOKED_BY, CHANNEL, staffState } from "./labels";
import { Snackbar } from "./Snackbar";

export function DaySchedule() {
  const { state: session } = useSession();
  const { state: directory } = useStaffData();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const me = session.status === "signed-in" ? session.me : undefined;
  const role = me ? roleOf(me) : "RECEPTIONIST";
  const own = readsOwnCalendar(role);
  const data = directory.status === "ready" ? directory.data : undefined;

  const date = isDate(params.get("date")) ? (params.get("date") as string) : today();
  const clinicId = me?.clinicId ?? params.get("clinic") ?? data?.clinics[0]?.clinicId;
  const url = me ? scheduleUrl(role, me, clinicId, date) : undefined;
  const { state, reload } = useSchedule(url);
  const [said, setSaid] = useState<string | null>(null);

  const schedule = state.status === "ready" ? state.data : undefined;
  const appointments = useMemo(
    () => [...(schedule?.appointments ?? [])].sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [schedule],
  );
  const figures = tally(appointments);
  const clinicians = new Set(appointments.map((a) => a.clinicianProfileId).filter(Boolean)).size;
  const selected =
    appointments.find((a) => a.appointmentId === params.get("visit")) ??
    appointments.find((a) => ACTIVE_STATES.includes(a.state) && Date.parse(a.endAt) > Date.now()) ??
    appointments[0];

  function go(next: Record<string, string | null>) {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null) merged.delete(key);
      else merged.set(key, value);
    }
    setParams(merged, { replace: true });
  }

  const cancelling =
    params.get("cancel") === "1" && selected && ACTIVE_STATES.includes(selected.state) ? selected : undefined;
  const joinedCancelling = cancelling ? joinDirectory(data, cancelling) : undefined;

  const isToday = date === today();
  const heading = clock.long(noonOf(date));
  const count = `${appointments.length} appointment${appointments.length === 1 ? "" : "s"}`;

  return (
    <div className="staff-day">
      <header className="glass staff-top">
        <div className="staff-nav">
          <button type="button" className="square-button" aria-label="Previous day" onClick={() => go({ date: shiftDate(date, -1), visit: null })}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" className="square-button" aria-label="Next day" onClick={() => go({ date: shiftDate(date, 1), visit: null })}>
            <ChevronRight size={16} />
          </button>
          <button type="button" className="today-button" disabled={isToday} onClick={() => go({ date: null, visit: null })}>
            Today
          </button>
        </div>
        <div className="staff-title">
          <h1>{heading}</h1>
          <p>
            {state.status === "ready"
              ? own
                ? `${count} on your calendar`
                : `${count} · ${clinicians} clinician${clinicians === 1 ? "" : "s"} booked`
              : "Loading the day"}
          </p>
        </div>
        {role === "TENANT_ADMIN" && data && (
          <label className="clinic-picker">
            <span>Clinic</span>
            <select value={clinicId} onChange={(event) => go({ clinic: event.target.value, visit: null })}>
              {data.clinics.map((clinic) => (
                <option key={clinic.clinicId} value={clinic.clinicId}>
                  {clinic.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <section className="staff-tiles" aria-label="The day in figures">
        <Tile tone="tone-blue" icon={<Calendar size={21} />} value={figures.booked} label={isToday ? "Booked today" : "Booked"} />
        <Tile tone="tone-green" icon={<Clock size={21} />} value={figures.ahead} label="Still to come" />
        <Tile tone="tone-red" icon={<Close size={21} />} value={figures.cancelled} label={isToday ? "Cancelled today" : "Cancelled"} />
        <Tile tone="tone-amber" icon={<Bell size={21} />} value={figures.reminders} label="Reminders to send" />
      </section>

      <div className="staff-cols">
        <section className="glass staff-card" aria-labelledby="day-title">
          <div className="staff-card-head">
            <h2 id="day-title">{own ? "Your day" : "Day schedule"}</h2>
            <div className="segmented" role="tablist" aria-label="View">
              <button type="button" role="tab" aria-selected="true" className="segment segment-on">
                Day
              </button>
              <button
                type="button"
                role="tab"
                aria-selected="false"
                className="segment"
                onClick={() => navigate(`/console/week?date=${date}${params.get("clinic") ? `&clinic=${params.get("clinic")}` : ""}`)}
              >
                Week
              </button>
            </div>
          </div>
          <DayList
            state={state}
            appointments={appointments}
            selected={selected}
            own={own}
            onSelect={(visit) =>
              // On a phone the panel gives way to the visit's own page, as the mobile frames have it.
              window.matchMedia("(max-width: 959px)").matches
                ? navigate(`/console/visits/${visit}?date=${date}`)
                : go({ visit })
            }
          />
        </section>

        <section className="glass staff-panel" aria-label="Selected visit">
          {selected && schedule ? (
            <VisitPanel
              key={selected.appointmentId}
              appointment={selected}
              schedule={schedule}
              date={date}
              onCancel={() => go({ visit: selected.appointmentId, cancel: "1" })}
            />
          ) : (
            <div className="staff-panel-empty">
              <span className="activity-icon tone-blue" aria-hidden="true">
                <Calendar size={18} />
              </span>
              <p>{state.status === "loading" ? "Loading the day" : "Pick a visit to see it here."}</p>
            </div>
          )}
        </section>
      </div>

      {cancelling && schedule && (
        <CancelVisit
          appointment={cancelling}
          patient={patientName(schedule.patients, cancelling)}
          clinician={joinedCancelling?.clinician}
          type={joinedCancelling?.type}
          onClose={() => go({ cancel: null })}
          onCancelled={(message) => {
            go({ cancel: null });
            setSaid(message);
            reload();
          }}
        />
      )}
      <Snackbar message={said} onDone={() => setSaid(null)} />
    </div>
  );
}

function Tile({ tone, icon, value, label }: { tone: string; icon: ReactNode; value: number; label: string }) {
  return (
    <div className="glass-tile staff-tile">
      <span className={`staff-tile-icon ${tone}`} aria-hidden="true">
        {icon}
      </span>
      <span>
        <span className="staff-tile-value">{value}</span>
        <span className="staff-tile-label">{label}</span>
      </span>
    </div>
  );
}

function DayList({
  state,
  appointments,
  selected,
  own,
  onSelect,
}: {
  state: ReturnType<typeof useSchedule>["state"];
  appointments: Appointment[];
  selected: Appointment | undefined;
  own: boolean;
  onSelect: (visit: string) => void;
}) {
  const { state: directory } = useStaffData();

  if (state.status === "loading") {
    return (
      <div className="day-rows" aria-busy="true">
        {[0, 1, 2, 3, 4].map((n) => (
          <span key={n} className="skeleton day-row-skeleton" style={{ animationDelay: `${n * 80}ms` }} />
        ))}
      </div>
    );
  }
  if (state.status === "failed") {
    return (
      <div className="day-empty">
        <Notice tone="error">{state.message} Check your connection and try again.</Notice>
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    );
  }
  if (appointments.length === 0) {
    return (
      <div className="day-empty">
        <span className="activity-icon tone-blue" aria-hidden="true">
          <Calendar size={18} />
        </span>
        <p className="day-empty-title">{own ? "Your calendar is clear." : "Nothing booked on this day."}</p>
        <p className="day-empty-sub">Use the arrows to look at another day.</p>
      </div>
    );
  }

  return (
    <ol className="day-rows" aria-label="Appointments">
      {appointments.map((appointment, index) => {
        const name = patientName(state.data.patients, appointment);
        const joined = joinDirectory(directory.status === "ready" ? directory.data : undefined, appointment);
        const { label, tone } = staffState(appointment.state);
        const who = [
          joined.type?.name ?? "Appointment",
          !own && joined.clinician ? doctor(joined.clinician) : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const on = selected?.appointmentId === appointment.appointmentId;
        return (
          <li key={appointment.appointmentId} style={{ "--i": index } as CSSProperties}>
            <button
              type="button"
              className={`day-row${on ? " day-row-on" : ""}${CANCELLED_STATES.includes(appointment.state) ? " day-row-off" : ""}`}
              aria-current={on ? "true" : undefined}
              onClick={() => onSelect(appointment.appointmentId)}
            >
              <span className="day-when">
                <span className="day-time">{clock.time(appointment.startAt)}</span>
                <span className="day-length">{minutesOf(appointment)} min</span>
              </span>
              <span className={`day-bar bar-${tone}`} aria-hidden="true" />
              <span className="day-avatar" aria-hidden="true">
                {initials(name.givenName, name.familyName) || "?"}
              </span>
              <span className="day-text">
                <span className="day-name">{fullName(name)}</span>
                <span className="day-sub">{who}</span>
              </span>
              <span className={`chip chip-${tone}`}>{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function VisitPanel({
  appointment,
  schedule,
  date,
  onCancel,
}: {
  appointment: Appointment;
  schedule: Schedule;
  date: string;
  onCancel: () => void;
}) {
  const { state: directory } = useStaffData();
  const name = patientName(schedule.patients, appointment);
  const joined = joinDirectory(directory.status === "ready" ? directory.data : undefined, appointment);
  const { label, tone } = staffState(appointment.state);
  const cancelled = CANCELLED_STATES.includes(appointment.state);
  const canCancel = ACTIVE_STATES.includes(appointment.state) && Date.parse(appointment.startAt) > Date.now();
  const reminder = reminderAt(appointment);
  const clinician = doctor(joined.clinician);

  return (
    <>
      <div className="panel-person">
        <span className="panel-avatar" aria-hidden="true">
          {initials(name.givenName, name.familyName) || "?"}
        </span>
        <span>
          <span className="panel-name">{fullName(name)}</span>
          <span className="panel-sub">Patient · {appointment.reference}</span>
        </span>
      </div>

      <dl className="panel-facts">
        <div>
          <dt>Appointment</dt>
          <dd>
            {clock.time(appointment.startAt)} to {clock.time(appointment.endAt)}
          </dd>
        </div>
        <div>
          <dt>Clinician</dt>
          <dd>{clinician}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{joined.type?.name ?? "Appointment"}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd className={`status-${tone}`}>{label}</dd>
        </div>
        <div>
          <dt>Reference</dt>
          <dd>{appointment.reference}</dd>
        </div>
      </dl>

      <p className="panel-label">ACTIVITY</p>
      <ol className="timeline panel-timeline">
        <li>
          <span className="timeline-dot dot-done" aria-hidden="true">
            <CheckMark size={10} />
          </span>
          <span>
            <span className="timeline-title">{BOOKED_BY[appointment.bookedByRole ?? "PATIENT"] ?? "Booked"}</span>
            <span className="timeline-sub">
              {clock.day(appointment.createdAt)}, {clock.time(appointment.createdAt)}
              {appointment.channel ? ` · ${CHANNEL[appointment.channel] ?? appointment.channel}` : ""}
            </span>
          </span>
        </li>
        {cancelled ? (
          <li>
            <span className="timeline-dot dot-red" aria-hidden="true">
              <Close size={10} />
            </span>
            <span>
              <span className="timeline-title">{label}</span>
              <span className="timeline-sub">The time was freed and the patient emailed</span>
            </span>
          </li>
        ) : reminder ? (
          <li>
            <span className="timeline-dot dot-amber-tint" aria-hidden="true">
              <Clock size={10} />
            </span>
            <span>
              <span className="timeline-title">SMS reminder</span>
              <span className="timeline-sub">
                Scheduled for {clock.day(reminder)}, {clock.time(reminder)} · 24h ahead
              </span>
            </span>
          </li>
        ) : (
          <li>
            <span className="timeline-dot dot-amber-tint" aria-hidden="true">
              <Bell size={10} />
            </span>
            <span>
              <span className="timeline-title">Confirmed by SMS</span>
              <span className="timeline-sub">Booked inside 24 hours, so no reminder</span>
            </span>
          </li>
        )}
      </ol>

      <div className="panel-actions">
        <Link className="staff-primary" to={`/console/visits/${appointment.appointmentId}?date=${date}`}>
          Open visit
        </Link>
        {canCancel && (
          <button type="button" className="outline-danger" onClick={onCancel}>
            Cancel this visit
          </button>
        )}
      </div>
    </>
  );
}
