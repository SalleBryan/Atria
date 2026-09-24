/**
 * "Desktop · Home" (123:2): the next visit, what to do next, what is coming
 * up and what has happened (FR-VIS-01).
 *
 * The frame's layout is kept; its content is Atria's own data. Where the
 * frame shows something Phase 1 does not have, the space holds the nearest
 * true thing instead:
 *   Reschedule is not in Phase 1, so the next visit offers details, cancel
 *   and add to calendar.
 *   My records becomes My visits: past visits are what Phase 1 records.
 *   Recent activity is built from the patient's own bookings, cancellations
 *   and the reminder due before their next visit, since the message log has
 *   no patient endpoint until Phase 2.
 *   The clinic card is the next visit's clinic, with its hours today and a
 *   link to directions; the map is a drawing, not a live map.
 */

import { type FormEvent, type ReactElement, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useSession } from "../auth/session";
import { Notice } from "../components/controls";
import {
  Bell,
  Calendar,
  CheckMark,
  Clipboard,
  Download,
  Mail,
  Pin,
  Plus,
  Repeat,
  Search,
} from "../components/icons";
import {
  type Appointment,
  type Clinic,
  clinicianName,
  clock,
  greeting,
  hoursOn,
  initials,
  join,
  past,
  stateLabel,
  until,
  upcoming,
  usePatientData,
} from "./data";
import { downloadCalendarEntry } from "./calendar";

const DAY_MS = 24 * 60 * 60 * 1000;

export function PatientHome() {
  const { state: session } = useSession();
  const { state, reload } = usePatientData();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const me = session.status === "signed-in" ? session.me : undefined;

  function search(event: FormEvent) {
    event.preventDefault();
    navigate(query.trim() ? `/find-care?q=${encodeURIComponent(query.trim())}` : "/find-care");
  }

  if (state.status === "failed") {
    return (
      <div className="page">
        <Notice tone="error">
          {state.message}{" "}
          <button type="button" className="link" onClick={() => void reload()}>
            Try again
          </button>
        </Notice>
      </div>
    );
  }

  const data = state.status === "ready" ? state.data : undefined;
  const ahead = data ? upcoming(data.appointments) : [];
  const behind = data ? past(data.appointments) : [];
  const next = ahead[0];
  const nextJoined = data && next ? join(data, next) : undefined;
  const reminderAt = next ? new Date(new Date(next.startAt).getTime() - DAY_MS) : undefined;
  const reminderDue = reminderAt && reminderAt > new Date();
  const lastAttended = behind.find((a) => ["COMPLETED", "AWAITING_FEEDBACK"].includes(a.state));
  // Book again suggests the clinician last seen, or else the one booked
  // next; never one whose visit was cancelled.
  const lastSeen = behind.find((a) => !a.state.endsWith("CANCELLED")) ?? next;
  const lastClinician = data
    ? data.clinicians.find((c) => c.clinicianProfileId === lastSeen?.clinicianProfileId)
    : undefined;

  const summary = data
    ? [
        ahead.length === 1 ? "1 upcoming visit" : `${ahead.length} upcoming visits`,
        reminderDue && reminderAt ? `reminder ${clock.day(reminderAt)}` : null,
        lastAttended ? `last visit ${clock.day(lastAttended.startAt)}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Loading your visits";

  return (
    <div className="page home" data-loading={data ? undefined : ""}>
      <header className="top-bar glass">
        <div className="greeting">
          <h1>
            {greeting()}
            {me?.givenName ? `, ${me.givenName}` : ""}
          </h1>
          <p>{summary}</p>
        </div>
        <form className="top-search" role="search" onSubmit={search}>
          <Search size={16} />
          <input
            aria-label="Search clinicians or specialties"
            placeholder="Search clinicians or specialties"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </form>
        <Link className="pill-button pill-primary" to="/find-care">
          <Plus size={16} />
          Book a visit
        </Link>
      </header>

      {!data ? (
        <HomeSkeleton />
      ) : (
        <>
          {next && nextJoined ? (
            <section className="hero" aria-label="Your next visit">
              <span className="hero-bloom" aria-hidden="true" />
              <div className="hero-row">
                <span className="hero-avatar" aria-hidden="true">
                  {initials(nextJoined.clinician?.givenName, nextJoined.clinician?.familyName) || "DR"}
                </span>
                <div className="hero-copy">
                  <span className="hero-tag">
                    <CheckMark size={11} />
                    NEXT VISIT · {stateLabel(next.state).label.toUpperCase()}
                  </span>
                  <h2>{clinicianName(nextJoined.clinician)}</h2>
                  <p>
                    {[nextJoined.clinician?.specialty, nextJoined.clinic?.name, nextJoined.type?.name]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <dl className="hero-when">
                  <div>
                    <dt>DATE</dt>
                    <dd>{clock.day(next.startAt)}</dd>
                  </div>
                  <div>
                    <dt>TIME</dt>
                    <dd>{clock.time(next.startAt)}</dd>
                  </div>
                  <div>
                    <dt>IN</dt>
                    <dd>{until(next.startAt)}</dd>
                  </div>
                  <div>
                    <dt>REF</dt>
                    <dd>{next.reference}</dd>
                  </div>
                </dl>
              </div>
              <div className="hero-actions">
                <Link className="hero-button hero-button-solid" to={`/visits/${next.appointmentId}`}>
                  View details
                </Link>
                <Link className="hero-button" to={`/visits/${next.appointmentId}?cancel=1`}>
                  Cancel
                </Link>
                <button
                  type="button"
                  className="hero-button"
                  onClick={() => downloadCalendarEntry(next, nextJoined)}
                >
                  <Download size={15} />
                  Add to calendar
                </button>
              </div>
            </section>
          ) : (
            <section className="hero hero-empty" aria-label="Your next visit">
              <span className="hero-bloom" aria-hidden="true" />
              <div className="hero-copy">
                <span className="hero-tag">NO VISIT BOOKED</span>
                <h2>Find a time that suits you.</h2>
                <p>Choose a clinician, pick a day and hold a time. A text reminds you the day before.</p>
              </div>
              <div className="hero-actions">
                <Link className="hero-button hero-button-solid" to="/find-care">
                  Find care
                </Link>
              </div>
            </section>
          )}

          <div className="home-cols">
            <div className="home-left">
              <nav className="quick-actions" aria-label="Quick actions">
                <Link className="quick glass-tile" to="/find-care">
                  <span className="quick-icon tone-blue">
                    <Plus size={20} />
                  </span>
                  <span className="quick-title">Book a visit</span>
                  <span className="quick-sub">Find an opening</span>
                </Link>
                {lastClinician ? (
                  <Link className="quick glass-tile" to={`/find-care?clinician=${lastClinician.clinicianProfileId}`}>
                    <span className="quick-icon tone-green">
                      <Repeat size={20} />
                    </span>
                    <span className="quick-title">Book again</span>
                    <span className="quick-sub">
                      {clinicianName(lastClinician)}, {lastClinician.specialty}
                    </span>
                  </Link>
                ) : (
                  <Link className="quick glass-tile" to="/find-care">
                    <span className="quick-icon tone-green">
                      <Repeat size={20} />
                    </span>
                    <span className="quick-title">Book again</span>
                    <span className="quick-sub">After your first visit</span>
                  </Link>
                )}
                <Link className="quick glass-tile" to="/visits?show=past">
                  <span className="quick-icon tone-violet">
                    <Clipboard size={20} />
                  </span>
                  <span className="quick-title">My visits</span>
                  <span className="quick-sub">
                    {behind.length === 1 ? "1 past visit" : `${behind.length} past visits`}
                  </span>
                </Link>
                <Link className="quick glass-tile" to="/account">
                  <span className="quick-icon tone-amber">
                    <Bell size={20} />
                  </span>
                  <span className="quick-title">Reminders</span>
                  <span className="quick-sub">24h before, SMS</span>
                </Link>
              </nav>

              <section className="panel glass" aria-labelledby="upcoming-title">
                <div className="panel-head">
                  <h2 id="upcoming-title">Upcoming visits</h2>
                  <Link className="link" to="/visits">
                    See all
                  </Link>
                </div>
                {ahead.length ? (
                  <ul className="visit-rows">
                    {ahead.slice(0, 3).map((appointment) => (
                      <VisitRow key={appointment.appointmentId} appointment={appointment} />
                    ))}
                  </ul>
                ) : (
                  <p className="empty">Nothing booked yet. Your visits will be listed here.</p>
                )}
              </section>
            </div>

            <div className="home-right">
              <section className="panel glass" aria-labelledby="activity-title">
                <h2 id="activity-title" className="panel-title">
                  Recent activity
                </h2>
                <Activity appointments={data.appointments} next={next} reminderAt={reminderDue ? reminderAt : undefined} />
              </section>
              <ClinicCard clinic={nextJoined?.clinic ?? data.clinics[0]} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function VisitRow({ appointment, action = "Manage" }: { appointment: Appointment; action?: string }) {
  const { state } = usePatientData();
  if (state.status !== "ready") return null;
  const { clinician, clinic } = join(state.data, appointment);
  const status = stateLabel(appointment.state);
  return (
    <li className="visit-row">
      <span className="date-tile" aria-hidden="true">
        <span>{clock.month(appointment.startAt)}</span>
        <span>{clock.date(appointment.startAt)}</span>
      </span>
      <span className="visit-text">
        <span className="visit-name">{clinicianName(clinician)}</span>
        <span className="visit-sub">
          {[clinician?.specialty, clinic?.name, `${clock.time(appointment.startAt)} to ${clock.time(appointment.endAt)}`]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <span className={`chip chip-${status.tone}`}>{status.label}</span>
      <Link className="link row-link" to={`/visits/${appointment.appointmentId}`}>
        {action}
        <span className="visually-hidden"> the visit on {clock.long(appointment.startAt)}</span>
      </Link>
    </li>
  );
}

function Activity({
  appointments,
  next,
  reminderAt,
}: {
  appointments: Appointment[];
  next?: Appointment;
  reminderAt?: Date;
}) {
  const items: { key: string; tone: string; icon: ReactElement; title: string; body: string; foot: string }[] = [];
  if (next && reminderAt) {
    items.push({
      key: "reminder",
      tone: "tone-amber",
      icon: <Bell size={17} />,
      title: "Reminder scheduled",
      body: `SMS goes out ${clock.day(reminderAt)} at ${clock.time(reminderAt)}`,
      foot: "24 hours before your visit",
    });
  }
  const recent = [...appointments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const appointment of recent) {
    if (items.length >= 3) break;
    const cancelled = appointment.state.endsWith("CANCELLED");
    items.push({
      key: appointment.appointmentId,
      tone: cancelled ? "tone-red" : "tone-blue",
      icon: cancelled ? <Calendar size={17} /> : <Mail size={17} />,
      title: cancelled ? "Visit cancelled" : "Visit booked",
      body: `${appointment.reference} for ${clock.day(appointment.startAt)} at ${clock.time(appointment.startAt)}`,
      foot: `Booked ${clock.day(appointment.createdAt)}, ${clock.time(appointment.createdAt)}`,
    });
  }
  if (!items.length) return <p className="empty">Bookings, cancellations and reminders will show here.</p>;
  return (
    <ul className="activity">
      {items.map((item) => (
        <li key={item.key}>
          <span className={`activity-icon ${item.tone}`} aria-hidden="true">
            {item.icon}
          </span>
          <span>
            <span className="activity-title">{item.title}</span>
            <span className="activity-body">{item.body}</span>
            <span className="activity-foot">{item.foot}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function ClinicCard({ clinic }: { clinic?: Clinic }) {
  if (!clinic) return null;
  const today = hoursOn(clinic);
  const directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    [clinic.name, clinic.address].filter(Boolean).join(", "),
  )}`;
  return (
    <section className="panel glass clinic-card" aria-label="Your clinic">
      <div className="map" aria-hidden="true">
        <svg viewBox="0 0 312 69" preserveAspectRatio="xMidYMid slice">
          <rect width="312" height="69" className="map-ground" />
          <path className="map-road" d="M-10 44 L120 44 L160 20 L330 20" />
          <path className="map-road map-road-thin" d="M60 -5 L60 80 M210 -5 L240 80 M-5 12 L110 12" />
          <path className="map-route" d="M40 58 L60 44 L120 44 L160 20 L232 20" pathLength={1} />
        </svg>
        <span className="map-pin">
          <Pin size={16} />
        </span>
      </div>
      <p className="clinic-name">{clinic.name}</p>
      <p className="clinic-sub">
        {[clinic.address, today ? `open ${today.start} to ${today.end} today` : "closed today"]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <a className="outline-button" href={directions} target="_blank" rel="noreferrer">
        Get directions
      </a>
    </section>
  );
}

function HomeSkeleton() {
  return (
    <div className="skeleton-home" aria-hidden="true">
      <span className="skeleton skeleton-hero" />
      <div className="home-cols">
        <div className="home-left">
          <div className="quick-actions">
            {[0, 1, 2, 3].map((index) => (
              <span key={index} className="skeleton skeleton-quick" />
            ))}
          </div>
          <span className="skeleton skeleton-panel" />
        </div>
        <div className="home-right">
          <span className="skeleton skeleton-panel" />
        </div>
      </div>
    </div>
  );
}
