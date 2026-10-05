/**
 * "Desktop · Week view" (66:2): a week at the clinic, Monday to Saturday on
 * an hour grid, each visit coloured by its clinician (FR-STF-01).
 *
 * The front desk's week is the clinic's seven days read together, so a
 * suspended clinician's visits still show; a clinician's is their own
 * calendar. Chips narrow the grid to one clinician, which is also where "View
 * schedule" on a visit leads.
 *
 * Where the frame shows what Phase 1 does not have, the nearest true thing
 * stands in: arrivals are Phase 2, so the legend has no "Arrived"; reminders
 * are counted as still to send, from the appointments; and a clinician's load
 * is their booked time against the clinic's opening hours, which Phase 1
 * holds, since rostered availability is Phase 2. The Month and Year views are
 * Phase 2 (D-08).
 *
 * On a phone the grid gives way to Mobile · Staff week (178:2): a strip of
 * days, the chosen one in a hero, and its clinicians (WeekPhone, below).
 */

import { type CSSProperties, type ReactNode, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { useSession } from "../auth/session";
import { Button, Notice } from "../components/controls";
import { DatePickerMenu } from "../components/DatePickerMenu";
import { ChipRow, FilterMenu, type FilterOption } from "../components/FilterMenu";
import { Bell, Calendar, ChevronLeft, ChevronRight, Close } from "../components/icons";
import { SelectMenu } from "../components/Pickers";
import { type Appointment, type Clinic, type Clinician, clock } from "../patient/data";
import {
  CANCELLED_STATES,
  doctor,
  fullName,
  isDate,
  joinDirectory,
  minutesOf,
  mondayOf,
  noonOf,
  patientName,
  readsOwnCalendar,
  roleOf,
  type Schedule,
  shiftDate,
  tally,
  today,
  useSchedules,
  useStaffData,
  ZONE,
} from "./data";
import { useTier } from "../layout/fit";
import { staffState } from "./labels";
import { LoadingIndicator } from "../components/LoadingIndicator";

const HOUR_PX = 56;
const PALETTE = ["blue", "violet", "teal", "amber", "green", "rose"] as const;
const DAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const MONTH = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, month: "long" });

/** Minutes since midnight on the clinic's clock. */
function minutesOfDay(instant: string): number {
  const [hours, minutes] = clock.time(instant).split(":").map(Number) as [number, number];
  return hours * 60 + minutes;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

/** "21 to 26 September 2026", or across a month, "29 September to 4 October 2026". */
function weekTitle(first: string, last: string): string {
  const [year, , firstDay] = first.split("-").map(Number) as [number, number, number];
  const lastDay = Number(last.slice(8));
  const a = MONTH.format(noonOf(first));
  const b = MONTH.format(noonOf(last));
  return a === b ? `${firstDay} to ${lastDay} ${b} ${year}` : `${firstDay} ${a} to ${lastDay} ${b} ${last.slice(0, 4)}`;
}

/** Side by side where visits overlap: each gets a lane, and the lanes share the column. */
function lanes(appointments: Appointment[]) {
  const placed: { appointment: Appointment; lane: number; of: number }[] = [];
  let cluster: typeof placed = [];
  let clusterEnd = 0;
  const ends: number[] = [];
  for (const appointment of appointments) {
    const start = Date.parse(appointment.startAt);
    if (cluster.length && start >= clusterEnd) {
      cluster.forEach((entry) => (entry.of = ends.length));
      cluster = [];
      ends.length = 0;
    }
    let lane = ends.findIndex((end) => end <= start);
    if (lane === -1) lane = ends.push(0) - 1;
    ends[lane] = Date.parse(appointment.endAt);
    const entry = { appointment, lane, of: 1 };
    cluster.push(entry);
    placed.push(entry);
    clusterEnd = Math.max(clusterEnd, ends[lane]!);
  }
  cluster.forEach((entry) => (entry.of = ends.length));
  return placed;
}

export function WeekView() {
  const { state: session } = useSession();
  const { state: directory } = useStaffData();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const me = session.status === "signed-in" ? session.me : undefined;
  const role = me ? roleOf(me) : "RECEPTIONIST";
  const own = readsOwnCalendar(role);
  const data = directory.status === "ready" ? directory.data : undefined;

  const anchor = isDate(params.get("date")) ? (params.get("date") as string) : today();
  const monday = mondayOf(anchor);
  const sunday = shiftDate(monday, 6);
  const clinicId = me?.clinicId ?? params.get("clinic") ?? (role === "TENANT_ADMIN" ? "all" : data?.clinics[0]?.clinicId);
  const clinic = data?.clinics.find((c) => c.clinicId === clinicId);
  const chosen = own ? me?.staffId ?? null : params.get("clinician");

  const urls = me
    ? own
      ? [`/clinicians/${me.staffId}/calendar?from=${monday}&to=${sunday}`]
      : clinicId
        ? // The whole week in one request, not one a day (NFR-PERF-01).
          [`/clinics/${clinicId}/day?from=${monday}&to=${sunday}`]
        : undefined
    : undefined;
  const { state } = useSchedules(urls);
  const schedule = state.status === "ready" ? state.data : undefined;

  const everyone = schedule?.appointments ?? [];
  const shown = chosen ? everyone.filter((a) => a.clinicianProfileId === chosen) : everyone;

  // The clinicians of this clinic, and anyone else who appears on its week (a suspended one, say).
  const clinicians = useMemo(() => {
    const listed = (data?.clinicians ?? []).filter((c) =>
      own ? c.clinicianProfileId === me?.staffId : clinicId === "all" ? true : c.clinicId === clinicId,
    );
    const ids = new Set(listed.map((c) => c.clinicianProfileId));
    const extra = everyone
      .map((a) => a.clinicianProfileId)
      .filter((id): id is string => Boolean(id) && !ids.has(id as string))
      .filter((id, i, all) => all.indexOf(id) === i)
      .map((id) => ({ clinicianProfileId: id, givenName: null, familyName: null }) as unknown as Clinician);
    return [...listed, ...extra];
  }, [data, everyone, clinicId, own, me?.staffId]);
  const colourOf = (id: string | null): string =>
    PALETTE[Math.max(0, clinicians.findIndex((c) => c.clinicianProfileId === id)) % PALETTE.length] ?? "blue";
  // Busiest first, so the chips that fit are the clinicians the desk is likeliest to want.
  const clinicianOptions: FilterOption[] = clinicians
    .map((c) => ({
      id: c.clinicianProfileId,
      label: doctor(c, "Clinician"),
      count: everyone.filter((a) => a.clinicianProfileId === c.clinicianProfileId).length,
      dot: `dot-${colourOf(c.clinicianProfileId)}`,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const [menuOpen, setMenuOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);

  const days = Array.from({ length: 7 }, (_, i) => shiftDate(monday, i)).filter(
    (day, i) => i < 6 || everyone.some((a) => clock.isoDate(a.startAt) === day),
  );

  // The hours the grid spans: the clinic's opening hours, widened to fit any visit outside them.
  const opening =
    clinicId === "all"
      ? (data?.clinics ?? []).flatMap((c) => Object.values(c.openingHours ?? {}))
      : Object.values(clinic?.openingHours ?? {});
  let first = opening.length ? Math.min(...opening.map((h) => toMinutes(h.start))) : 8 * 60;
  let last = opening.length ? Math.max(...opening.map((h) => toMinutes(h.end))) : 17 * 60;
  for (const a of shown) {
    first = Math.min(first, minutesOfDay(a.startAt));
    last = Math.max(last, minutesOfDay(a.startAt) + minutesOf(a));
  }
  const startHour = Math.max(0, Math.floor(first / 60) - 1);
  const endHour = Math.min(24, Math.ceil(last / 60) + 1);
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);

  const figures = tally(shown);
  const inView = new Set(shown.map((a) => a.clinicianProfileId)).size;
  const thisWeek = monday === mondayOf(today());

  function go(next: Record<string, string | null>) {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null) merged.delete(key);
      else merged.set(key, value);
    }
    setParams(merged, { replace: true });
  }

  const phone = useTier() === "mobile";
  const open = (appointment: Appointment) =>
    navigate(`/console/visits/${appointment.appointmentId}?date=${clock.isoDate(appointment.startAt)}`);

  return (
    <div className="staff-week">
      <div className={`week-main${own ? " week-main-own" : ""}`}>
        <header className="glass staff-top">
          <div className="staff-nav">
            <button type="button" className="square-button" aria-label="Previous week" onClick={() => go({ date: shiftDate(monday, -7) })}>
              <ChevronLeft size={16} />
            </button>
            <button type="button" className="square-button" aria-label="Next week" onClick={() => go({ date: shiftDate(monday, 7) })}>
              <ChevronRight size={16} />
            </button>
            <button type="button" className="today-button" disabled={thisWeek} onClick={() => go({ date: null })}>
              This week
            </button>
            <DatePickerMenu
              value={monday}
              label="Pick week"
              onChange={(nextDate) => go({ date: nextDate })}
            />
          </div>
          <div className="staff-title">
            <h1>{weekTitle(monday, days[days.length - 1] ?? shiftDate(monday, 5))}</h1>
            <p>
              {state.status === "ready"
                ? [
                    `${shown.length} appointment${shown.length === 1 ? "" : "s"}`,
                    own ? null : `${inView} clinician${inView === 1 ? "" : "s"}`,
                    clinicId === "all" ? "All units" : clinic?.name,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "Loading the week"}
            </p>
          </div>
          {role === "TENANT_ADMIN" && data && (
            <SelectMenu
              label="Unit"
              value={clinicId ?? null}
              width={300}
              options={[
                { id: "all", label: "All units" },
                ...data.clinics.map((c) => ({ id: c.clinicId, label: c.name })),
              ]}
              onChange={(id) => go({ clinic: id, clinician: null })}
            />
          )}
          <div className="segmented" role="tablist" aria-label="View">
            <button
              type="button"
              role="tab"
              aria-selected="false"
              className="segment"
              onClick={() =>
                navigate(
                  `/console?date=${anchor}${clinicId ? `&clinic=${clinicId}` : ""}${chosen && !own ? `&clinician=${chosen}` : ""}`,
                )
              }
            >
              Day
            </button>
            <button type="button" role="tab" aria-selected="true" className="segment segment-on">
              Week
            </button>
          </div>
        </header>

        {!own && (
          <>
            <ChipRow
              variant="week"
              label="Clinician"
              options={clinicianOptions}
              value={chosen}
              onChange={(id) => go({ clinician: id })}
              allLabel="All clinicians"
              allDot="dot-all"
              onMore={() => setMenuOpen(true)}
              moreRef={more}
              trailing={
                <span className="week-legend">
                  <span className="week-dot dot-cancelled" aria-hidden="true" />
                  Cancelled
                </span>
              }
            />
            <FilterMenu
              open={menuOpen}
              onClose={() => setMenuOpen(false)}
              anchor={more}
              title="Show one clinician"
              sections={[
                {
                  id: "clinician",
                  label: "Clinician",
                  options: clinicianOptions,
                  value: chosen,
                  onChange: (id) => go({ clinician: id }),
                  allLabel: "All clinicians",
                },
              ]}
              results="Show the week"
              onClear={() => go({ clinician: null })}
            />
          </>
        )}

        <section className="glass week-card" aria-label="The week">
          {state.status === "failed" ? (
            <div className="day-empty">
              <Notice tone="error">{state.message} Check your connection and try again.</Notice>
              <Button variant="secondary" onClick={() => window.location.reload()}>
                Try again
              </Button>
            </div>
          ) : (
            <div className="week-scroll">
              <WeekGrid
                days={days}
                hours={hours}
                startHour={startHour}
                appointments={shown}
                loading={state.status === "loading"}
                schedule={schedule}
                colourOf={colourOf}
                onOpen={open}
              />
              {phone ? (
                <WeekPhone days={days} appointments={shown} clinicians={clinicians} clinic={clinic} colourOf={colourOf} />
              ) : (
                <WeekList days={days} appointments={shown} schedule={schedule} loading={state.status === "loading"} own={own} />
              )}
            </div>
          )}
        </section>
      </div>

      <aside className="glass week-side" aria-label="Week at a glance">
        <h2>Week at a glance</h2>
        <div className="week-glance">
          <Glance tone="tone-blue" icon={<Calendar size={19} />} value={figures.booked} label="Appointments booked" />
          <Glance tone="tone-red" icon={<Close size={19} />} value={figures.cancelled} label="Cancelled this week" />
          <Glance tone="tone-amber" icon={<Bell size={19} />} value={figures.reminders} label="Reminders to send" />
        </div>
        <h2>{own ? "Your load" : "Clinician load"}</h2>
        <Load
          clinicians={chosen ? clinicians.filter((c) => c.clinicianProfileId === chosen) : clinicians}
          appointments={everyone}
          clinic={clinic}
          days={days}
          colourOf={colourOf}
        />
        <p className="week-note">Booked time against the unit's opening hours this week.</p>
      </aside>
    </div>
  );
}

function Glance({ tone, icon, value, label }: { tone: string; icon: ReactNode; value: number; label: string }) {
  return (
    <div className="glance">
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

function WeekGrid({
  days,
  hours,
  startHour,
  appointments,
  loading,
  schedule,
  colourOf,
  onOpen,
}: {
  days: string[];
  hours: number[];
  startHour: number;
  appointments: Appointment[];
  loading: boolean;
  schedule: Schedule | undefined;
  colourOf: (id: string | null) => string;
  onOpen: (appointment: Appointment) => void;
}) {
  const now = new Date();
  const todayIs = today();
  const nowTop = ((minutesOfDay(now.toISOString()) - startHour * 60) / 60) * HOUR_PX;

  return (
    <div className="week-grid" style={{ "--days": days.length, "--hours": hours.length } as CSSProperties} aria-busy={loading || undefined}>
      <div className="week-corner" />
      {loading && (
        <div className="week-loading">
          <LoadingIndicator size={44} label="Loading the week" />
        </div>
      )}
      {days.map((day, i) => (
        <div key={day} className={`week-head${day === todayIs ? " week-head-today" : ""}`} style={{ "--i": i } as CSSProperties}>
          <span>{DAY_NAMES[i]}</span>
          <span>{Number(day.slice(8))}</span>
        </div>
      ))}
      <div className="week-body">
        <div className="week-hours" aria-hidden="true">
          {hours.map((hour) => (
            <span key={hour}>{String(hour).padStart(2, "0")}:00</span>
          ))}
        </div>
        {days.map((day, i) => {
          const mine = appointments.filter((a) => clock.isoDate(a.startAt) === day);
          return (
            <div key={day} className="week-day" style={{ "--i": i } as CSSProperties} aria-label={clock.long(noonOf(day))} role="group">
              {lanes(mine).map(({ appointment, lane, of }, index) => {
                const top = ((minutesOfDay(appointment.startAt) - startHour * 60) / 60) * HOUR_PX;
                const height = Math.max(22, (minutesOf(appointment) / 60) * HOUR_PX - 3);
                const cancelled = CANCELLED_STATES.includes(appointment.state);
                const name = schedule ? fullName(patientName(schedule.patients, appointment)) : "";
                const { label } = staffState(appointment.state);
                return (
                  <button
                    key={appointment.appointmentId}
                    type="button"
                    className={`week-block block-${cancelled ? "cancelled" : colourOf(appointment.clinicianProfileId)}`}
                    style={
                      {
                        top,
                        height,
                        left: `calc(${(lane / of) * 100}% + 5px)`,
                        width: `calc(${100 / of}% - 10px)`,
                        "--n": index,
                      } as CSSProperties
                    }
                    aria-label={`${clock.time(appointment.startAt)}, ${name}, ${label}`}
                    onClick={() => onOpen(appointment)}
                  >
                    <span className="week-block-time">{clock.time(appointment.startAt)}</span>
                    {height >= 34 && <span className="week-block-name">{name}</span>}
                  </button>
                );
              })}
              {day === todayIs && nowTop >= 0 && nowTop <= hours.length * HOUR_PX && (
                <span className="week-now" style={{ top: nowTop }} aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekList({
  days,
  appointments,
  schedule,
  loading,
  own,
}: {
  days: string[];
  appointments: Appointment[];
  schedule: Schedule | undefined;
  loading: boolean;
  own: boolean;
}) {
  const { state: directory } = useStaffData();
  if (loading) return <div className="week-list" aria-busy="true" />;
  return (
    <div className="week-list">
      {days.map((day) => {
        const mine = appointments.filter((a) => clock.isoDate(a.startAt) === day);
        const off = mine.filter((a) => CANCELLED_STATES.includes(a.state)).length;
        const count = [mine.length - off ? `${mine.length - off} booked` : null, off ? `${off} cancelled` : null]
          .filter(Boolean)
          .join(" · ");
        return (
          <section key={day} aria-label={clock.long(noonOf(day))}>
            <h3>
              {clock.day(noonOf(day))}
              <span>{count || "Nothing booked"}</span>
            </h3>
            {mine.map((appointment) => {
              const joined = joinDirectory(directory.status === "ready" ? directory.data : undefined, appointment);
              const { label, tone } = staffState(appointment.state);
              return (
                <Link
                  key={appointment.appointmentId}
                  className="week-list-row"
                  to={`/console/visits/${appointment.appointmentId}?date=${day}`}
                >
                  <span className="day-time">{clock.time(appointment.startAt)}</span>
                  <span className={`day-bar bar-${tone}`} aria-hidden="true" />
                  <span className="day-text">
                    <span className="day-name">{schedule ? fullName(patientName(schedule.patients, appointment)) : ""}</span>
                    <span className="day-sub">{[joined.type?.name, own ? null : doctor(joined.clinician, "")].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className={`chip chip-${tone}`}>{label}</span>
                </Link>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function Load({
  clinicians,
  appointments,
  clinic,
  days,
  colourOf,
}: {
  clinicians: Clinician[];
  appointments: Appointment[];
  clinic: Clinic | undefined;
  days: string[];
  colourOf: (id: string | null) => string;
}) {
  const open = days.reduce((sum, day) => {
    const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
    const hours = clinic?.openingHours?.[String(weekday)];
    return sum + (hours ? toMinutes(hours.end) - toMinutes(hours.start) : 0);
  }, 0);
  if (!clinicians.length) return <p className="week-note">No clinicians on this week.</p>;
  return (
    <ul className="week-load">
      {clinicians.map((c, i) => {
        const booked = appointments
          .filter((a) => a.clinicianProfileId === c.clinicianProfileId && !CANCELLED_STATES.includes(a.state))
          .reduce((sum, a) => sum + minutesOf(a), 0);
        const share = open ? Math.min(100, Math.round((booked / open) * 100)) : 0;
        return (
          <li key={c.clinicianProfileId} style={{ "--i": i } as CSSProperties}>
            <span className="week-load-name">{doctor(c, "Clinician")}</span>
            <span className="week-load-value">{open ? `${share}%` : `${Math.round(booked / 60)} h`}</span>
            <span className="week-load-track" aria-hidden="true">
              <span className={`week-load-bar block-${colourOf(c.clinicianProfileId)}`} style={{ width: `${Math.max(share, booked ? 3 : 0)}%` }} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Mobile · Staff week (178:2): the days as a strip with how full each is,
 * the chosen day in the hero, and each clinician's share of it. Capacity is
 * not a Phase 1 figure, so a day's fill is against the week's busiest day and
 * a clinician's against the clinic's opening hours that day.
 */
function WeekPhone({
  days,
  appointments,
  clinicians,
  clinic,
  colourOf,
}: {
  days: string[];
  appointments: Appointment[];
  clinicians: Clinician[];
  clinic: Clinic | undefined;
  colourOf: (id: string | null) => string;
}) {
  const todayIs = today();
  const [pick, setPick] = useState(days.includes(todayIs) ? todayIs : (days[0] ?? todayIs));
  const on = (day: string) => appointments.filter((a) => clock.isoDate(a.startAt) === day);
  const live = (list: Appointment[]) => list.filter((a) => !CANCELLED_STATES.includes(a.state));
  const busiest = Math.max(1, ...days.map((day) => live(on(day)).length));
  const mine = on(pick);
  const figures = tally(mine);
  const weekday = (new Date(`${pick}T12:00:00Z`).getUTCDay() + 6) % 7;
  const hours = clinic?.openingHours?.[String(weekday)];
  const open = hours ? toMinutes(hours.end) - toMinutes(hours.start) : 0;
  const booked = clinicians
    .map((c) => ({ clinician: c, list: live(mine.filter((a) => a.clinicianProfileId === c.clinicianProfileId)) }))
    .filter((row) => row.list.length);

  return (
    <div className="week-phone">
      <div className="week-strip" role="radiogroup" aria-label="Day">
        {days.map((day, i) => {
          const count = live(on(day)).length;
          return (
            <button
              key={day}
              type="button"
              role="radio"
              aria-checked={pick === day}
              className={`strip-day${pick === day ? " strip-day-on" : ""}`}
              onClick={() => setPick(day)}
            >
              <span>{clock.weekday(noonOf(day))}</span>
              <span className="strip-date">{Number(day.slice(8))}</span>
              <span className="strip-fill" aria-hidden="true">
                <span style={{ width: `${(count / busiest) * 100}%` }} />
              </span>
              <span className="strip-count">{count}</span>
              <span className="visually-hidden">{DAY_NAMES[i]}</span>
            </button>
          );
        })}
      </div>

      <section className="week-hero" aria-label="The chosen day">
        <span className="hero-bloom" aria-hidden="true" />
        <span className="week-hero-date">{clock.day(noonOf(pick)).toUpperCase()}</span>
        <h2>
          {figures.booked} booked{figures.cancelled ? ` · ${figures.cancelled} cancelled` : ""}
        </h2>
        <dl className="visit-cells week-hero-cells">
          <div>
            <dt>BOOKED</dt>
            <dd>{figures.booked}</dd>
          </div>
          <div>
            <dt>TO COME</dt>
            <dd>{figures.ahead}</dd>
          </div>
          <div>
            <dt>CANCELLED</dt>
            <dd>{figures.cancelled}</dd>
          </div>
          <div>
            <dt>CLINICIANS</dt>
            <dd>{booked.length}</dd>
          </div>
        </dl>
      </section>

      <div className="today-head">
        <h2>By clinician</h2>
        <Link className="link" to={`/console?date=${pick}`}>
          Open the day
        </Link>
      </div>
      <ul className="week-by">
        {booked.map(({ clinician, list }) => {
          const minutes = list.reduce((sum, a) => sum + minutesOf(a), 0);
          return (
            <li key={clinician.clinicianProfileId}>
              <span className={`week-by-avatar block-${colourOf(clinician.clinicianProfileId)}`} aria-hidden="true">
                {[clinician.givenName, clinician.familyName].map((n) => n?.[0] ?? "").join("")}
              </span>
              <span className="week-by-text">
                <span className="week-by-name">{doctor(clinician, "Clinician")}</span>
                <span className="week-by-sub">
                  {[clinician.specialty, hours ? `${hours.start} to ${hours.end}` : null].filter(Boolean).join(" · ")}
                </span>
                <span className="week-load-track" aria-hidden="true">
                  <span
                    className={`week-load-bar block-${colourOf(clinician.clinicianProfileId)}`}
                    style={{ width: `${open ? Math.min(100, Math.max(4, (minutes / open) * 100)) : 0}%` }}
                  />
                </span>
              </span>
              <span className="week-by-count">{list.length}</span>
            </li>
          );
        })}
        {!booked.length && <li className="today-empty">Nothing booked on this day.</li>}
      </ul>
    </div>
  );
}
