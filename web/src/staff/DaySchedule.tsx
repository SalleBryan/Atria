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
 * - The Month and Year views are Phase 2 (FR-STF-03), and so is the
 *   notification bell, so they are left out. The list can be searched and
 *   narrowed to one clinician or to what is booked or cancelled, and it is
 *   paged rather than scrolled (feedback 2026-09-25). The clinician chosen is
 *   kept in the address, so it carries across to the week and back.
 * - Marking an arrival is Phase 2 (check-in), so the panel's first action
 *   opens the visit instead.
 *
 * Times are the clinic's, on the 24-hour clock (NFR-L10N-02).
 */

import { type CSSProperties, type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { useSession } from "../auth/session";
import { Button, Notice } from "../components/controls";
import { SelectMenu } from "../components/Pickers";
import { LoadingRow } from "../components/LoadingPane";
import { DatePickerMenu } from "../components/DatePickerMenu";
import { ChipRow, FilterMenu, type FilterOption } from "../components/FilterMenu";
import { Bell, Calendar, CheckMark, ChevronLeft, ChevronRight, Clock, Close, Filter, Info, User } from "../components/icons";
import { Pager, usePages, useRowsThatFit } from "../components/Pager";
import { rank, SearchSuggest, type SuggestionGroup } from "../components/SearchSuggest";
import { ACTIVE_STATES, type Appointment, clock, initials } from "../patient/data";
import {
  can,
  CANCELLED_STATES,
  doctor,
  ROLE_LABEL,
  fullName,
  isDate,
  joinDirectory,
  minutesOf,
  noShowDue,
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
import { useTier } from "../layout/fit";
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
  const phone = useTier() === "mobile";
  const data = directory.status === "ready" ? directory.data : undefined;

  const date = isDate(params.get("date")) ? (params.get("date") as string) : today();
  const clinicId = me?.clinicId ?? params.get("clinic") ?? (role === "TENANT_ADMIN" ? "all" : data?.clinics[0]?.clinicId);
  const url = me ? scheduleUrl(role, me, clinicId, date) : undefined;
  const { state, reload } = useSchedule(url);
  const [said, setSaid] = useState<string | null>(null);

  const schedule = state.status === "ready" ? state.data : undefined;
  const appointments = useMemo(
    () => [...(schedule?.appointments ?? [])].sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [schedule],
  );
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const filterButton = useRef<HTMLButtonElement>(null);
  const rowsBox = useRef<HTMLOListElement>(null);

  // One clinician's day, when one is chosen; the figures follow the choice.
  const chosen = own ? null : params.get("clinician");
  const theirs = chosen ? appointments.filter((a) => a.clinicianProfileId === chosen) : appointments;
  const statusOf = (a: Appointment) => (CANCELLED_STATES.includes(a.state) ? "cancelled" : "booked");
  const searchText = (a: Appointment) => {
    const joined = joinDirectory(data, a);
    return [
      fullName(patientName(schedule?.patients ?? {}, a)),
      a.reference,
      joined.clinician ? doctor(joined.clinician) : "",
      joined.type?.name ?? "",
    ].join(" ");
  };
  const found = theirs.filter(
    (a) => (!status || statusOf(a) === status) && (!query.trim() || rank(searchText(a), query) > 0),
  );
  const figures = tally(theirs);
  const clinicians = new Set(theirs.map((a) => a.clinicianProfileId).filter(Boolean)).size;
  const selected =
    appointments.find((a) => a.appointmentId === params.get("visit")) ??
    found.find((a) => ACTIVE_STATES.includes(a.state) && Date.parse(a.endAt) > Date.now()) ??
    found[0];

  const size = useRowsThatFit(rowsBox, { row: ".day-row", pitch: 75, gap: 9 });
  const pages = usePages(found, size, `${date}|${chosen}|${status}|${query}`);
  const { reveal } = pages;
  const selectedIndex = found.findIndex((a) => a.appointmentId === selected?.appointmentId);
  // The selected visit's page is the one shown, so choosing one never leaves it off screen.
  useEffect(() => {
    reveal(selectedIndex);
  }, [selected?.appointmentId, date, chosen, status, query, size]);

  // The busiest clinician first, of those at this clinic and anyone else on the day.
  const clinicianOptions: FilterOption[] = useMemo(() => {
    const listed = (data?.clinicians ?? []).filter((c) => c.clinicId === clinicId);
    const ids = new Set([...listed.map((c) => c.clinicianProfileId), ...appointments.map((a) => a.clinicianProfileId)]);
    return [...ids]
      .filter((id): id is string => Boolean(id))
      .map((id) => {
        const clinician = data?.clinicians.find((c) => c.clinicianProfileId === id);
        return {
          id,
          label: clinician ? doctor(clinician) : "Clinician",
          count: appointments.filter((a) => a.clinicianProfileId === id).length,
        };
      })
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [data, appointments, clinicId]);
  const statusOptions: FilterOption[] = [
    { id: "booked", label: "Booked", count: theirs.filter((a) => statusOf(a) === "booked").length },
    { id: "cancelled", label: "Cancelled", count: theirs.filter((a) => statusOf(a) === "cancelled").length },
  ];
  const suggestions: SuggestionGroup[] = [
    {
      id: "patients",
      label: "Patients",
      icon: User,
      items: theirs.map((a) => ({
        id: a.appointmentId,
        label: fullName(patientName(schedule?.patients ?? {}, a)),
        hint: `${clock.time(a.startAt)} · ${a.reference}`,
        also: [a.reference],
        onPick: () => {
          setQuery("");
          go({ visit: a.appointmentId });
        },
      })),
    },
    ...(own
      ? []
      : [
          {
            id: "clinicians",
            label: "Clinicians",
            icon: User,
            items: clinicianOptions.map((o) => ({
              id: o.id,
              label: o.label,
              hint: `${o.count} on this day`,
              onPick: () => {
                setQuery("");
                go({ clinician: o.id, visit: null });
              },
            })),
          },
        ]),
    {
      id: "status",
      label: "Status",
      icon: Info,
      items: statusOptions.map((o) => ({
        id: o.id,
        label: o.label,
        hint: `${o.count} on this day`,
        onPick: () => {
          setQuery("");
          setStatus(o.id);
        },
      })),
    },
  ];

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
      {phone && me && (
        // Mobile · Staff today (174:2): who is signed in, and where.
        <header className="phone-head">
          <span className="side-avatar phone-avatar" aria-hidden="true">
            {initials(me.givenName, me.familyName) || "A"}
          </span>
          <span>
            <span className="phone-hello">
              {[ROLE_LABEL[role], data?.clinics.find((c) => c.clinicId === me.clinicId)?.name].filter(Boolean).join(" · ")}
            </span>
            <span className="phone-name">{[me.givenName, me.familyName].filter(Boolean).join(" ")}</span>
          </span>
        </header>
      )}
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
          <DatePickerMenu
            value={date}
            label="Pick date"
            onChange={(nextDate) => go({ date: nextDate, visit: null })}
          />
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
          <SelectMenu
            label="Unit"
            value={clinicId ?? null}
            width={300}
            options={[
              { id: "all", label: "All units" },
              ...data.clinics.map((clinic) => ({ id: clinic.clinicId, label: clinic.name })),
            ]}
            onChange={(id) => go({ clinic: id, visit: null })}
          />
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
                onClick={() =>
                  navigate(
                    `/console/week?date=${date}${params.get("clinic") ? `&clinic=${params.get("clinic")}` : ""}${chosen ? `&clinician=${chosen}` : ""}`,
                  )
                }
              >
                Week
              </button>
            </div>
          </div>
          <div className="day-tools">
            <SearchSuggest
              className="find-search day-search"
              label="Search the day"
              placeholder="Patient, reference or clinician"
              value={query}
              onChange={setQuery}
              groups={suggestions}
              trailing={
                <button
                  ref={filterButton}
                  type="button"
                  className={`filter-button${menuOpen || status ? " filter-on" : ""}`}
                  aria-label="Filters"
                  aria-haspopup="dialog"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen(true)}
                >
                  <Filter size={17} />
                </button>
              }
            />
            {!own && (
              <ChipRow
                variant="week"
                className="day-chips"
                label="Clinician"
                options={clinicianOptions}
                value={chosen}
                onChange={(id) => go({ clinician: id, visit: null })}
                allLabel="All clinicians"
                onMore={() => setMenuOpen(true)}
                moreActive={status ? 1 : 0}
              />
            )}
          </div>
          <FilterMenu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            anchor={filterButton}
            title="Filter the day"
            sections={[
              ...(own
                ? []
                : [
                    {
                      id: "clinician",
                      label: "Clinician",
                      options: clinicianOptions,
                      value: chosen,
                      onChange: (id: string | null) => go({ clinician: id, visit: null }),
                      allLabel: "All clinicians",
                    },
                  ]),
              { id: "status", label: "Status", options: statusOptions, value: status, onChange: setStatus, allLabel: "Any status" },
            ]}
            results={found.length === 1 ? "Show 1 visit" : `Show ${found.length} visits`}
            onClear={() => {
              setStatus(null);
              go({ clinician: null });
            }}
          />
          <DayList
            state={state}
            appointments={pages.shown}
            filtered={theirs.length > 0 && found.length === 0}
            rowsBox={rowsBox}
            selected={selected}
            own={own}
            onSelect={(visit) =>
              // On a phone the panel gives way to the visit's own page, as the mobile frames have it.
              window.matchMedia("(max-width: 767px)").matches
                ? navigate(`/console/visits/${visit}?date=${date}`)
                : go({ visit })
            }
          />
          {state.status === "ready" && found.length > 0 && (
            <Pager
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
  filtered,
  rowsBox,
  selected,
  own,
  onSelect,
}: {
  state: ReturnType<typeof useSchedule>["state"];
  appointments: Appointment[];
  /** Something is booked, but nothing matches the search or filters. */
  filtered: boolean;
  rowsBox: RefObject<HTMLOListElement | null>;
  selected: Appointment | undefined;
  own: boolean;
  onSelect: (visit: string) => void;
}) {
  const { state: directory } = useStaffData();

  if (state.status === "loading") {
    return (
      <ol ref={rowsBox} className="day-rows" aria-busy="true">
        <LoadingRow label="Loading the day" />
      </ol>
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
  if (filtered) {
    return (
      <div className="day-empty">
        <span className="activity-icon tone-blue" aria-hidden="true">
          <Filter size={18} />
        </span>
        <p className="day-empty-title">Nothing matches.</p>
        <p className="day-empty-sub">Try another name, or clear the filters.</p>
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
    <ol ref={rowsBox} className="day-rows" aria-label="Appointments">
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
              {noShowDue(appointment) ? (
                <span className="chip chip-awaiting">No-show?</span>
              ) : (
                <span className={`chip chip-${tone}`}>{label}</span>
              )}
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
  const { state } = useSession();
  const role = state.status === "signed-in" ? roleOf(state.me) : "RECEPTIONIST";
  const name = patientName(schedule.patients, appointment);
  const joined = joinDirectory(directory.status === "ready" ? directory.data : undefined, appointment);
  const { label, tone } = staffState(appointment.state);
  const cancelled = CANCELLED_STATES.includes(appointment.state);
  const canCancel = can(role, "appointment.cancel") && ACTIVE_STATES.includes(appointment.state) && Date.parse(appointment.startAt) > Date.now();
  const reminder = reminderAt(appointment);
  const clinician = doctor(joined.clinician);

  return (
    <>
      {/* The details scroll when the panel is shorter than they are; the actions stay in view. */}
      <div className="panel-scroll">
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
                  {reminder.getTime() > Date.now() ? "Scheduled for" : "Due"} {clock.day(reminder)}, {clock.time(reminder)} · 24h ahead
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

      </div>

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
