/**
 * "Desktop · Booked" (141:2): the moment a booking succeeds.
 *
 * It covers the whole app, as the frame does, over the shell that stays
 * mounted beneath it. What happens next is what Atria actually does: the
 * confirmation email goes now, and the text reminder a day before the visit,
 * or a confirmation text straight away when the visit is sooner than that
 * (FR-REM-06). The frame's "Remind me 2h before instead" is a reminder
 * preference, which is Phase 2, so the first action is to see the visit; and
 * the ticket shows the visit's kind where the frame shows a fee.
 */

import { Link, Navigate, useLocation, useParams } from "react-router-dom";

import { CheckMark, Clock, Download, Mail, User } from "../components/icons";
import { type Appointment, clinicianName, clock, initials, join, stateLabel, usePatientData } from "./data";
import { downloadCalendarEntry } from "./calendar";

const DAY_MS = 24 * 60 * 60 * 1000;

export function Booked() {
  const { id } = useParams();
  const location = useLocation();
  const { state } = usePatientData();
  const passed = (location.state as { appointment?: Appointment } | null)?.appointment;
  if (state.status !== "ready") return null;
  const appointment = state.data.appointments.find((a) => a.appointmentId === id) ?? passed;
  if (!appointment) return <Navigate to="/visits" replace />;

  const joined = join(state.data, appointment);
  const minutes = (joined.type?.durationUnits ?? 0) * state.data.gridUnitMinutes;
  const reminderAt = new Date(Date.parse(appointment.startAt) - DAY_MS);
  const remindedLater = reminderAt.getTime() > Date.now();

  return (
    <div className="booked-screen" role="dialog" aria-labelledby="booked-title">
      <span className="orb booked-orb-a" aria-hidden="true" />
      <span className="orb booked-orb-b" aria-hidden="true" />
      <div className="booked-copy">
        <span className="booked-tile" aria-hidden="true">
          <CheckMark size={40} />
        </span>
        <h1 id="booked-title">You are booked.</h1>
        <p className="booked-lede">A confirmation is on its way to your email address.</p>

        <div className="booked-next">
          <p className="booked-next-title">What happens next</p>
          <ol>
            <li>
              <span className="booked-dot dot-done">
                <Mail size={12} />
              </span>
              <span>
                <span className="booked-step">Confirmation email</span>
                <span className="booked-step-sub">Sent now, with your reference {appointment.reference}</span>
              </span>
            </li>
            <li>
              <span className="booked-dot dot-amber">
                <Clock size={12} />
              </span>
              <span>
                <span className="booked-step">{remindedLater ? "SMS reminder" : "SMS confirmation"}</span>
                <span className="booked-step-sub">
                  {remindedLater
                    ? `${clock.day(reminderAt)}, ${clock.time(reminderAt)} · 24 hours before`
                    : "Sent now, as the visit is less than a day away"}
                </span>
              </span>
            </li>
            <li>
              <span className="booked-dot dot-blue">
                <User size={12} />
              </span>
              <span>
                <span className="booked-step">Arrive 10 minutes early</span>
                <span className="booked-step-sub">Bring your ID and any referral letter</span>
              </span>
            </li>
          </ol>
        </div>

        <div className="booked-actions">
          <Link className="booked-button booked-solid" to={`/visits/${appointment.appointmentId}`}>
            View my visit
          </Link>
          <button type="button" className="booked-button" onClick={() => downloadCalendarEntry(appointment, joined)}>
            <Download size={15} />
            Add to calendar
          </button>
          <Link className="booked-button" to="/home">
            Done
          </Link>
        </div>
      </div>

      <article className="ticket" aria-label="Your booking">
        <header className="ticket-head">
          <span className="ticket-avatar" aria-hidden="true">
            {initials(joined.clinician?.givenName, joined.clinician?.familyName)}
          </span>
          <span>
            <span className="ticket-name">{clinicianName(joined.clinician)}</span>
            <span className="ticket-sub">{[joined.clinician?.specialty, joined.clinic?.name].filter(Boolean).join(" · ")}</span>
          </span>
        </header>
        <dl className="ticket-grid">
          <div>
            <dt>DATE</dt>
            <dd>{clock.day(appointment.startAt)}</dd>
          </div>
          <div>
            <dt>TIME</dt>
            <dd>
              {clock.time(appointment.startAt)} to {clock.time(appointment.endAt)}
            </dd>
          </div>
          <div>
            <dt>WHERE</dt>
            <dd>{joined.clinic?.name ?? "The clinic"}</dd>
          </div>
          <div>
            <dt>DURATION</dt>
            <dd>{minutes} minutes</dd>
          </div>
          <div className="ticket-wide">
            <dt>VISIT</dt>
            <dd>{joined.type?.name ?? "Consultation"}</dd>
          </div>
        </dl>
        <footer className="ticket-foot">
          <span className="ticket-ref">{appointment.reference}</span>
          <span className="chip chip-confirmed">{stateLabel(appointment.state).label.toUpperCase()}</span>
        </footer>
      </article>
    </div>
  );
}
