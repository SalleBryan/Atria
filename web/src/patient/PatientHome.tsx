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

import { type ReactElement, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { useSession } from "../auth/session";
import { Notice } from "../components/controls";
import { LoadingPane } from "../components/LoadingPane";
import { SearchSuggest } from "../components/SearchSuggest";
import { Bell, Calendar, CheckMark, Clipboard, Mail, Pin, Plus, Repeat } from "../components/icons";
import {
  type Appointment,
  type Clinic,
  clinicianName,
  clock,
  hoursOn,
  initials,
  join,
  past,
  stateLabel,
  ticketWaits,
  upcoming,
  usePatientData,
  directionsTo,
} from "./data";
import { useTier } from "../layout/fit";
import { AvailableToday } from "./AvailableToday";
import { AddToCalendar } from "./AddToCalendar";
import { careChoices, careSuggestions } from "./careSearch";
import { dayLong, dayShort, greetingText, monthTile, untilText } from "./homeText";

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Dr Name", or the neutral phrase when the directory has no such clinician. */
function useDoctor() {
  const { t } = useTranslation("home");
  return (clinician: Parameters<typeof clinicianName>[0]) => (clinician ? clinicianName(clinician) : t("hero.yourClinician"));
}

/** The state's words in the active language, with its tone from the shared table. */
function useStatus() {
  const { t } = useTranslation("home");
  return (state: string) => {
    const { label, tone } = stateLabel(state);
    return { label: t(`state.${state}`, { defaultValue: label }), tone };
  };
}

export function PatientHome() {
  const { t, i18n } = useTranslation("home");
  const lng = i18n.resolvedLanguage ?? i18n.language;
  const status = useStatus();
  const doctor = useDoctor();
  const { state: session } = useSession();
  const { state, reload } = usePatientData();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const me = session.status === "signed-in" ? session.me : undefined;
  const phone = useTier() === "mobile";

  function search(words: string) {
    navigate(words.trim() ? `/find-care?q=${encodeURIComponent(words.trim())}` : "/find-care");
  }

  // Guesses from everything Find care can narrow by, and goes there already narrowed.
  const ready = state.status === "ready" ? state.data : undefined;
  const suggestions = useMemo(() => {
    const clinicians = ready?.bookable ?? [];
    const clinics = ready?.clinics ?? [];
    const go = (name: string, value: string) => navigate(`/find-care?${name}=${encodeURIComponent(value)}`);
    return careSuggestions(clinicians, clinics, careChoices(clinicians, clinics), {
      clinician: (id) => go("clinician", id),
      specialty: (name) => go("specialty", name),
      clinic: (id) => go("clinic", id),
      language: (code) => go("language", code),
    });
  }, [ready, navigate]);

  if (state.status === "failed") {
    return (
      <div className="page">
        <Notice tone="error">
          {state.message}{" "}
          <button type="button" className="link" onClick={() => void reload()}>
            {t("tryAgain")}
          </button>
        </Notice>
      </div>
    );
  }

  const data = state.status === "ready" ? state.data : undefined;
  const ahead = data ? upcoming(data.appointments) : [];
  const behind = data ? past(data.appointments) : [];
  // The hero is the next visit with a time. A procedure request has none
  // yet: its "start" is when it was asked, which read "15:06, in Now" here
  // (audit 2026-10-06). Requests stay in the list below.
  const next = ahead.find((a) => a.state !== "REQUESTED");
  const nextJoined = data && next ? join(data, next) : undefined;
  const reminderAt = next ? new Date(new Date(next.startAt).getTime() - DAY_MS) : undefined;
  const reminderDue = reminderAt && reminderAt > new Date();
  const lastAttended = behind.find((a) => ["COMPLETED", "AWAITING_FEEDBACK"].includes(a.state));
  // Book again suggests the clinician last seen, or else the one booked
  // next; never one whose visit was cancelled.
  const lastSeen = behind.find((a) => !a.state.endsWith("CANCELLED")) ?? next;
  const lastClinician = data ? data.clinicians.find((c) => c.clinicianProfileId === lastSeen?.clinicianProfileId) : undefined;

  const summary = data
    ? [
        t("summary.upcoming", { count: ahead.length }),
        reminderDue && reminderAt ? t("summary.reminder", { day: dayShort(reminderAt, lng) }) : null,
        lastAttended ? t("summary.lastVisit", { day: dayShort(lastAttended.startAt, lng) }) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : t("summary.loading");

  return (
    <div className="page home" data-loading={data ? undefined : ""}>
      {phone && (
        <header className="phone-head">
          <span className="side-avatar phone-avatar" aria-hidden="true">
            {initials(me?.givenName, me?.familyName) || "A"}
          </span>
          <span>
            <span className="phone-hello">{greetingText(t)}</span>
            <span className="phone-name">{[me?.givenName, me?.familyName].filter(Boolean).join(" ") || t("welcome")}</span>
          </span>
        </header>
      )}
      <header className="top-bar glass">
        <div className="greeting">
          <h1>
            {greetingText(t)}
            {me?.givenName ? `, ${me.givenName}` : ""}
          </h1>
          <p>{summary}</p>
        </div>
        <SearchSuggest
          form
          className="top-search"
          label={t("search")}
          placeholder={t("search")}
          value={query}
          onChange={setQuery}
          onSubmit={search}
          groups={suggestions}
        />
        <Link className="pill-button pill-primary" to="/find-care">
          <Plus size={16} />
          {t("book")}
        </Link>
      </header>

      {!data ? (
        <LoadingPane label={t("summary.loading")} />
      ) : (
        <>
          {phone && (
            <div className="today-head">
              <h2>{t("nextAppointment")}</h2>
              <Link className="link" to="/visits">
                {t("seeAll")}
              </Link>
            </div>
          )}
          {next && nextJoined ? (
            <section className="hero" aria-label={t("hero.label")}>
              <span className="hero-bloom" aria-hidden="true" />
              <div className="hero-row">
                <span className="hero-avatar" aria-hidden="true">
                  {initials(nextJoined.clinician?.givenName, nextJoined.clinician?.familyName) || "DR"}
                </span>
                <div className="hero-copy">
                  <span className="hero-tag">
                    <CheckMark size={11} />
                    {t("hero.tag", { status: status(next.state).label.toUpperCase() })}
                  </span>
                  {/* A queue place reads as the web's other lists put it: the queue and the place. */}
                  <h2>{next.sessionId ? t("hero.queue", { place: next.position ?? "" }) : doctor(nextJoined.clinician)}</h2>
                  <p>{[nextJoined.clinician?.specialty, nextJoined.clinic?.name, nextJoined.type?.name].filter(Boolean).join(" · ")}</p>
                </div>
                <dl className="hero-when">
                  <div>
                    <dt>{t("hero.date")}</dt>
                    <dd>{dayShort(next.startAt, lng)}</dd>
                  </div>
                  <div>
                    <dt>{t("hero.time")}</dt>
                    <dd>{clock.time(next.startAt)}</dd>
                  </div>
                  <div>
                    <dt>{t("hero.in")}</dt>
                    <dd>{untilText(t, next.startAt)}</dd>
                  </div>
                  <div>
                    <dt>{t("hero.ref")}</dt>
                    <dd>{next.reference}</dd>
                  </div>
                </dl>
              </div>
              <div className="hero-actions">
                <Link className="hero-button hero-button-solid" to={`/visits/${next.appointmentId}`}>
                  {t("hero.details")}
                </Link>
                <Link className="hero-button" to={`/visits/${next.appointmentId}?cancel=1`}>
                  {t("hero.cancel")}
                </Link>
                <AddToCalendar appointment={next} joined={nextJoined} className="hero-button">
                  <Calendar size={15} />
                  {t("hero.calendar")}
                </AddToCalendar>
              </div>
            </section>
          ) : (
            <section className="hero hero-empty" aria-label={t("hero.label")}>
              <span className="hero-bloom" aria-hidden="true" />
              <div className="hero-copy">
                <span className="hero-tag">{t("hero.emptyTag")}</span>
                <h2>{t("hero.emptyTitle")}</h2>
                <p>{t("hero.emptyBody")}</p>
              </div>
              <div className="hero-actions">
                <Link className="hero-button hero-button-solid" to="/find-care">
                  {t("hero.findCare")}
                </Link>
              </div>
            </section>
          )}

          {phone && <AvailableToday />}

          <div className="home-cols">
            <div className="home-left">
              <nav className="quick-actions" aria-label={t("quick.label")}>
                <Link className="quick glass-tile" to="/find-care">
                  <span className="quick-icon tone-blue">
                    <Plus size={20} />
                  </span>
                  <span className="quick-title">{t("book")}</span>
                  <span className="quick-sub">{t("quick.findSub")}</span>
                </Link>
                {lastClinician ? (
                  <Link className="quick glass-tile" to={`/find-care?clinician=${lastClinician.clinicianProfileId}`}>
                    <span className="quick-icon tone-green">
                      <Repeat size={20} />
                    </span>
                    <span className="quick-title">{t("quick.again")}</span>
                    <span className="quick-sub">
                      {doctor(lastClinician)}, {lastClinician.specialty}
                    </span>
                  </Link>
                ) : (
                  <Link className="quick glass-tile" to="/find-care">
                    <span className="quick-icon tone-green">
                      <Repeat size={20} />
                    </span>
                    <span className="quick-title">{t("quick.again")}</span>
                    <span className="quick-sub">{t("quick.againFirst")}</span>
                  </Link>
                )}
                <Link className="quick glass-tile" to="/visits?show=past">
                  <span className="quick-icon tone-violet">
                    <Clipboard size={20} />
                  </span>
                  <span className="quick-title">{t("quick.visits")}</span>
                  <span className="quick-sub">{t("quick.pastVisits", { count: behind.length })}</span>
                </Link>
                <Link className="quick glass-tile" to="/account">
                  <span className="quick-icon tone-amber">
                    <Bell size={20} />
                  </span>
                  <span className="quick-title">{t("quick.reminders")}</span>
                  <span className="quick-sub">{t("quick.remindersSub")}</span>
                </Link>
              </nav>

              <section className="panel glass" aria-labelledby="upcoming-title">
                <div className="panel-head">
                  <h2 id="upcoming-title">{t("upcoming.title")}</h2>
                  <Link className="link" to="/visits">
                    {t("seeAll")}
                  </Link>
                </div>
                {ahead.length ? (
                  <ul className="visit-rows">
                    {ahead.slice(0, 3).map((appointment) => (
                      <VisitRow key={appointment.appointmentId} appointment={appointment} />
                    ))}
                  </ul>
                ) : (
                  <p className="empty">{t("upcoming.empty")}</p>
                )}
              </section>
            </div>

            <div className="home-right">
              <section className="panel glass" aria-labelledby="activity-title">
                <h2 id="activity-title" className="panel-title">
                  {t("activity.title")}
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

export function VisitRow({ appointment, action }: { appointment: Appointment; action?: string }) {
  const { t, i18n } = useTranslation("home");
  const lng = i18n.resolvedLanguage ?? i18n.language;
  const status = useStatus();
  const doctor = useDoctor();
  const { state } = usePatientData();
  if (state.status !== "ready") return null;
  const { clinician, clinic, type } = join(state.data, appointment);
  const requested = appointment.state === "REQUESTED";
  // As ticketSubtitle in data.tsx words it, driven by state so a given-back place never says arrive.
  const ticketText = (a: Appointment) =>
    ticketWaits(a.state)
      ? t("row.arrive", { time: clock.time(a.startAt) })
      : a.state.endsWith("CANCELLED")
        ? t("row.givenBack")
        : clock.time(a.startAt);
  const label = status(appointment.state);
  return (
    <li className="visit-row">
      <span className="date-tile" aria-hidden="true">
        <span>{monthTile(appointment.startAt, lng)}</span>
        <span>{clock.date(appointment.startAt)}</span>
      </span>
      <span className="visit-text">
        <span className="visit-name">
          {appointment.sessionId
            ? t("hero.queue", { place: appointment.position ?? "" })
            : requested
              ? (type?.name ?? t("row.procedure"))
              : doctor(clinician)}
        </span>
        <span className="visit-sub">
          {/* As My visits words them: a request has no time, a queue place an arrival. */}
          {(appointment.sessionId
            ? [clinic?.name, ticketText(appointment)]
            : requested
              ? [clinic?.name, t("row.asked", { day: dayShort(appointment.startAt, lng) })]
              : [
                  clinician?.specialty,
                  clinic?.name,
                  t("row.timeRange", { start: clock.time(appointment.startAt), end: clock.time(appointment.endAt) }),
                ]
          )
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <span className={`chip chip-${label.tone}`}>{label.label}</span>
      <Link className="link row-link" to={`/visits/${appointment.appointmentId}`}>
        {action ?? t("row.manage")}
        <span className="visually-hidden">
          {requested ? t("row.theRequest") : t("row.theVisit")}
          {dayLong(appointment.startAt, lng)}
        </span>
      </Link>
    </li>
  );
}

function Activity({ appointments, next, reminderAt }: { appointments: Appointment[]; next?: Appointment; reminderAt?: Date }) {
  const { t, i18n } = useTranslation("home");
  const lng = i18n.resolvedLanguage ?? i18n.language;
  const items: { key: string; tone: string; icon: ReactElement; title: string; body: string; foot: string }[] = [];
  if (next && reminderAt) {
    items.push({
      key: "reminder",
      tone: "tone-amber",
      icon: <Bell size={17} />,
      title: t("activity.reminder"),
      body: t("activity.reminderBody", { day: dayShort(reminderAt, lng), time: clock.time(reminderAt) }),
      foot: t("activity.reminderFoot"),
    });
  }
  const recent = [...appointments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const appointment of recent) {
    if (items.length >= 3) break;
    const cancelled = appointment.state.endsWith("CANCELLED");
    const requested = appointment.state === "REQUESTED";
    items.push({
      key: appointment.appointmentId,
      tone: cancelled ? "tone-red" : "tone-blue",
      icon: cancelled ? <Calendar size={17} /> : <Mail size={17} />,
      title: cancelled ? t("activity.cancelled") : requested ? t("activity.requested") : t("activity.booked"),
      body: requested
        ? t("activity.requestedBody", { reference: appointment.reference })
        : t("activity.bookedBody", {
            reference: appointment.reference,
            day: dayShort(appointment.startAt, lng),
            time: clock.time(appointment.startAt),
          }),
      foot: t("activity.foot", { day: dayShort(appointment.createdAt, lng), time: clock.time(appointment.createdAt) }),
    });
  }
  if (!items.length) return <p className="empty">{t("activity.empty")}</p>;
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
  const { t } = useTranslation("home");
  if (!clinic) return null;
  const today = hoursOn(clinic);
  const directions = directionsTo(clinic);
  return (
    <section className="panel glass clinic-card" aria-label={t("clinic.label")}>
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
        {[clinic.address, today ? t("clinic.open", { start: today.start, end: today.end }) : t("clinic.closed")]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <a className="outline-button" href={directions} target="_blank" rel="noreferrer">
        {t("clinic.directions")}
      </a>
    </section>
  );
}
