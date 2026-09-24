/**
 * "Desktop · Appointment" (68:2): one visit, as the desk sees it (FR-VIS-02),
 * and cancelling it from here (FR-VIS-03).
 *
 * Where the frame shows what Phase 1 does not have, the nearest true thing
 * stands in: there is no room, so the hero's cells are the date and times;
 * there is no visit reason or fee yet, so the facts give the type and the
 * clinic; front desk notes, the patient record, rescheduling and marking an
 * arrival are Phase 2, so they are left out rather than offered and refused.
 *
 * The visit is read by id; its patient's name comes from the day it sits on,
 * which is the list the caller's role can read anyway.
 */

import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { api, ApiError } from "../api/client";
import { useSession } from "../auth/session";
import { Notice } from "../components/controls";
import { ArrowLeft, Bell, CheckMark, Clock, Close } from "../components/icons";
import { ACTIVE_STATES, type Appointment, clock, initials } from "../patient/data";
import { CancelVisit } from "./CancelVisit";
import {
  CANCELLED_STATES,
  doctor,
  fullName,
  isDate,
  joinDirectory,
  type Loading,
  minutesOf,
  noonOf,
  patientName,
  readsOwnCalendar,
  reminderAt,
  roleOf,
  scheduleUrl,
  useSchedule,
  useStaffData,
  ZONE,
} from "./data";
import { BOOKED_BY, CHANNEL, staffState } from "./labels";
import { Snackbar } from "./Snackbar";

/** "Wed 10 September", as the frame's breadcrumb writes a date. */
const CRUMB_DATE = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, weekday: "short", day: "numeric", month: "long" });

export function VisitPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { state: session } = useSession();
  const { state: directory } = useStaffData();
  const [visit, setVisit] = useState<Loading<Appointment>>({ status: "loading" });
  const [fresh, setFresh] = useState(0);
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<Appointment>(`/appointments/${id}`)
      .then((data) => live && setVisit({ status: "ready", data }))
      .catch(
        (error: unknown) =>
          live &&
          setVisit({
            status: "failed",
            message:
              error instanceof ApiError && (error.status === 403 || error.status === 404)
                ? "This visit is not on a list you can see."
                : "The visit could not be loaded. Check your connection and try again.",
          }),
      );
    return () => {
      live = false;
    };
  }, [id, fresh]);

  const me = session.status === "signed-in" ? session.me : undefined;
  const role = me ? roleOf(me) : "RECEPTIONIST";
  const appointment = visit.status === "ready" ? visit.data : undefined;
  const date = isDate(params.get("date"))
    ? (params.get("date") as string)
    : appointment
      ? clock.isoDate(appointment.startAt)
      : undefined;
  const { state: day } = useSchedule(me && date ? scheduleUrl(role, me, appointment?.clinicId ?? me.clinicId ?? undefined, date) : undefined);

  const back = `/console${date ? `?date=${date}` : ""}`;
  const crumb = [
    "Schedule",
    date ? CRUMB_DATE.format(noonOf(date)).replace(",", "") : null,
    appointment?.reference,
  ]
    .filter(Boolean)
    .join(" · ");

  if (visit.status === "failed") {
    return (
      <div className="visit-page">
        <Crumbs back={back} text="Schedule" />
        <div className="glass visit-missing">
          <Notice tone="error">{visit.message}</Notice>
          <Link className="staff-primary" to={back}>
            Back to the day
          </Link>
        </div>
      </div>
    );
  }
  if (!appointment) {
    return (
      <div className="visit-page" aria-busy="true">
        <Crumbs back={back} text="Schedule" />
        <span className="skeleton visit-skeleton-hero" />
        <span className="skeleton visit-skeleton-body" />
      </div>
    );
  }

  const joined = joinDirectory(directory.status === "ready" ? directory.data : undefined, appointment);
  const name = day.status === "ready" ? patientName(day.data.patients, appointment) : { givenName: null, familyName: null };
  const { label, tone } = staffState(appointment.state);
  const cancelled = CANCELLED_STATES.includes(appointment.state);
  const canCancel = ACTIVE_STATES.includes(appointment.state) && Date.parse(appointment.startAt) > Date.now();
  const reminder = reminderAt(appointment);
  const own = readsOwnCalendar(role);
  const booked = BOOKED_BY[appointment.bookedByRole ?? "PATIENT"] ?? "Booked";

  return (
    <div className="visit-page">
      <Crumbs back={back} text={crumb} />

      <section className={`staff-hero staff-hero-${tone}`} aria-label="Visit">
        <span className="hero-bloom" aria-hidden="true" />
        <span className="hero-avatar" aria-hidden="true">
          {initials(name.givenName, name.familyName) || "?"}
        </span>
        <div className="staff-hero-copy">
          <span className="hero-tag">{label.toUpperCase()}</span>
          <h1>{day.status === "loading" ? "Loading" : fullName(name)}</h1>
          <p>
            {[joined.type?.name ?? "Appointment", `${minutesOf(appointment)} minutes`, booked.replace(/^Booked/, "booked")].join(
              " · ",
            )}
          </p>
        </div>
        <dl className="visit-cells staff-hero-cells">
          <div>
            <dt>DATE</dt>
            <dd>{clock.day(appointment.startAt)}</dd>
          </div>
          <div>
            <dt>START</dt>
            <dd>{clock.time(appointment.startAt)}</dd>
          </div>
          <div>
            <dt>END</dt>
            <dd>{clock.time(appointment.endAt)}</dd>
          </div>
        </dl>
      </section>

      <div className="visit-page-cols">
        <section className="glass visit-page-main" aria-labelledby="visit-facts">
          <h2 id="visit-facts">Appointment</h2>
          <dl className="panel-facts visit-page-facts">
            <div>
              <dt>Status</dt>
              <dd>
                <span className={`chip chip-${tone}`}>{label}</span>
              </dd>
            </div>
            <div>
              <dt>Reference</dt>
              <dd>{appointment.reference}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{joined.type?.name ?? "Appointment"}</dd>
            </div>
            <div>
              <dt>Clinic</dt>
              <dd>{joined.clinic?.name ?? "Not named"}</dd>
            </div>
            <div>
              <dt>Booked</dt>
              <dd>
                {clock.day(appointment.createdAt)}, {clock.time(appointment.createdAt)}
              </dd>
            </div>
            <div>
              <dt>Channel</dt>
              <dd>{appointment.channel ? (CHANNEL[appointment.channel] ?? appointment.channel) : "Not recorded"}</dd>
            </div>
          </dl>

          <h2>People</h2>
          <div className="person-card">
            <span className="person-avatar person-avatar-clinician" aria-hidden="true">
              {initials(joined.clinician?.givenName, joined.clinician?.familyName) || "?"}
            </span>
            <span className="person-text">
              <span className="person-name">{doctor(joined.clinician)}</span>
              <span className="person-sub">{[joined.clinician?.specialty, joined.clinic?.name].filter(Boolean).join(" · ")}</span>
            </span>
            {appointment.clinicianProfileId && (
              <Link className="person-link" to={`/console/week?date=${clock.isoDate(appointment.startAt)}${own ? "" : `&clinician=${appointment.clinicianProfileId}`}`}>
                {own ? "Your week" : "View schedule"}
              </Link>
            )}
          </div>
          <div className="person-card">
            <span className="person-avatar" aria-hidden="true">
              {initials(name.givenName, name.familyName) || "?"}
            </span>
            <span className="person-text">
              <span className="person-name">{fullName(name)}</span>
              <span className="person-sub">Patient · {appointment.reference}</span>
            </span>
          </div>
        </section>

        <section className="glass visit-page-side" aria-labelledby="visit-activity">
          <h2 id="visit-activity">Activity</h2>
          <ol className="timeline visit-page-timeline">
            <li>
              <span className="timeline-dot dot-done" aria-hidden="true">
                <CheckMark size={10} />
              </span>
              <span>
                <span className="timeline-title">{booked}</span>
                <span className="timeline-sub">
                  {appointment.channel ? `${CHANNEL[appointment.channel] ?? appointment.channel} · ` : ""}
                  {clock.day(appointment.createdAt)}, {clock.time(appointment.createdAt)}
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
          <div className="visit-page-actions">
            <Link className="outline-button visit-back" to={back}>
              Back to the day
            </Link>
            {canCancel && (
              <button type="button" className="outline-danger" onClick={() => setParams({ ...(date ? { date } : {}), cancel: "1" }, { replace: true })}>
                Cancel visit
              </button>
            )}
          </div>
        </section>
      </div>

      {params.get("cancel") === "1" && canCancel && (
        <CancelVisit
          appointment={appointment}
          patient={name}
          clinician={joined.clinician}
          type={joined.type}
          onClose={() => setParams(date ? { date } : {}, { replace: true })}
          onCancelled={(message) => {
            setParams(date ? { date } : {}, { replace: true });
            setSaid(message);
            setFresh((n) => n + 1);
          }}
        />
      )}
      <Snackbar message={said} onDone={() => setSaid(null)} />
    </div>
  );
}

function Crumbs({ back, text }: { back: string; text: string }) {
  return (
    <nav className="visit-crumbs" aria-label="Breadcrumb">
      <Link className="square-button" to={back} aria-label="Back to the schedule">
        <ArrowLeft size={16} />
      </Link>
      <span>{text}</span>
    </nav>
  );
}
