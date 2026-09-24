/**
 * "Desktop · Find care + book" (130:2) and "Desktop · Slot conflict 409"
 * (135:2): choose a clinician, a day and a time, and book it (FR-DIR-01,
 * FR-DIR-02, FR-BKG-01, FR-BKG-02, FR-BKG-04).
 *
 * The directory, the free starts and the booking are the API's own. Where the
 * frame shows something Phase 1 does not have, the nearest true thing stands
 * in: the clinician's card says where and in which languages they consult
 * rather than carrying a written biography, the fee (Phase 2) gives way to the
 * visit's length, and the time grid lists free starts only, because the API
 * returns only those; the struck-through held times and their legend go.
 *
 * A time is the patient's only once it is booked. If somebody else books it
 * first the API answers 409 and nothing is written; the conflict view then
 * offers the closest openings instead. Every booking carries an
 * Idempotency-Key, kept while the same time stays selected, so a retry after
 * a lost response returns the booking rather than a false conflict.
 */

import { type CSSProperties, type FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { api, ApiError } from "../api/client";
import { Notice } from "../components/controls";
import {
  Alert,
  ChevronLeft,
  ChevronRight,
  Clock,
  Close,
  Filter,
  Lock,
  Repeat,
  Search,
  Stethoscope,
} from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import {
  type Appointment,
  type AppointmentType,
  type Clinician,
  clinicianName,
  clock,
  experience,
  initials,
  SENIORITY,
  usePatientData,
} from "./data";

interface Slot {
  startAt: string;
  endAt: string;
}

const WEEK = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const LANGUAGE: Record<string, string> = { fr: "French", en: "English" };

/** Avatar gradients from the frame, in order down the list. */
const AVATARS = [
  ["#6f9bf5", "#3564d6"],
  ["#5b8df2", "#2a62dc"],
  ["#3fa9c9", "#1e7fa8"],
  ["#7c7bf0", "#4b49ce"],
  ["#4ca6ec", "#1f6fc4"],
] as const;

function avatarStyle(index: number): CSSProperties {
  const [from, to] = AVATARS[index % AVATARS.length] as readonly [string, string];
  return { background: `linear-gradient(140deg, ${from}, ${to})` };
}

/** The clinic's dates from a starting day: yyyy-mm-dd, noon UTC to stay clear of any edge. */
function days(from: string, count: number): string[] {
  const start = Date.parse(`${from}T12:00:00Z`);
  return Array.from({ length: count }, (_, index) => new Date(start + index * DAY_MS).toISOString().slice(0, 10));
}

function shift(date: string, byDays: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + byDays * DAY_MS).toISOString().slice(0, 10);
}

function onDate(date: string) {
  // Noon UTC is 13:00 in Douala: the same calendar date, for formatting.
  return `${date}T12:00:00Z`;
}

async function freeStarts(clinicianId: string, typeId: string, date: string): Promise<Slot[]> {
  const found = await api<{ slots: Slot[] }>(
    `/clinicians/${encodeURIComponent(clinicianId)}/slots?date=${date}&typeId=${encodeURIComponent(typeId)}`,
  );
  return found.slots;
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function FindCare() {
  const { state, reload } = usePatientData();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [query, setQuery] = useState(params.get("q") ?? "");
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [clinicFilter, setClinicFilter] = useState<string | null>(null);
  const [showClinics, setShowClinics] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(params.get("clinician"));
  const [typeId, setTypeId] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(() => clock.isoDate(new Date()));
  const [day, setDay] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, Slot[] | undefined>>({});
  const [slot, setSlot] = useState<Slot | null>(null);
  const [key, setKey] = useState(newKey);
  const [booking, setBooking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ slot: Slot; clinician: Clinician; date: string } | null>(null);
  // Bumped to fetch the week's free starts again, after a conflict.
  const [freshness, setFreshness] = useState(0);

  const data = state.status === "ready" ? state.data : undefined;
  const bookable = useMemo(
    () => (data?.types ?? []).filter((t) => t.serviceLine === "SPECIALIST" && t.durationUnits),
    [data],
  );
  const type: AppointmentType | undefined = bookable.find((t) => t.appointmentTypeId === typeId) ?? bookable[0];
  const minutes = (type?.durationUnits ?? 0) * (data?.gridUnitMinutes ?? 10);

  const specialties = useMemo(
    () => [...new Set((data?.clinicians ?? []).map((c) => c.specialty).filter((s): s is string => Boolean(s)))].sort(),
    [data],
  );
  const listed = useMemo(() => {
    const words = query.trim().toLowerCase();
    return (data?.clinicians ?? []).filter((c) => {
      if (specialty && c.specialty !== specialty) return false;
      if (clinicFilter && c.clinicId !== clinicFilter) return false;
      if (!words) return true;
      return [c.givenName, c.familyName, c.specialty].some((field) => field?.toLowerCase().includes(words));
    });
  }, [data, query, specialty, clinicFilter]);

  const selected = listed.find((c) => c.clinicianProfileId === selectedId) ?? listed[0];
  const clinicOf = (clinician?: Clinician) => data?.clinics.find((c) => c.clinicId === clinician?.clinicId);
  const week = useMemo(() => days(weekStart, WEEK), [weekStart]);
  const today = clock.isoDate(new Date());
  const lastBookable = type?.maxAdvanceDays
    ? clock.isoDate(new Date(Date.now() + type.maxAdvanceDays * DAY_MS))
    : undefined;

  // The free starts for the week shown, one request per day, all at once.
  useEffect(() => {
    if (!selected || !type) return;
    let current = true;
    setCounts({});
    for (const date of week) {
      if (date < today || (lastBookable && date > lastBookable)) {
        setCounts((known) => ({ ...known, [date]: [] }));
        continue;
      }
      freeStarts(selected.clinicianProfileId, type.appointmentTypeId, date)
        .then((slots) => current && setCounts((known) => ({ ...known, [date]: slots })))
        .catch(() => current && setCounts((known) => ({ ...known, [date]: [] })));
    }
    return () => {
      current = false;
    };
  }, [selected?.clinicianProfileId, type?.appointmentTypeId, week, today, lastBookable, freshness]);

  // A day with openings is chosen for the patient; they can move it.
  useEffect(() => {
    if (day && counts[day]?.length) return;
    const first = week.find((date) => (counts[date]?.length ?? 0) > 0);
    if (first) setDay(first);
  }, [counts, week, day]);

  // Choosing anything else clears the time, and a new time is a new booking.
  useEffect(() => {
    setSlot(null);
    setFailure(null);
  }, [selected?.clinicianProfileId, type?.appointmentTypeId, day]);
  useEffect(() => setKey(newKey()), [slot?.startAt, selected?.clinicianProfileId, type?.appointmentTypeId]);

  async function book(event?: FormEvent) {
    event?.preventDefault();
    if (!slot || !selected || !type) return;
    setBooking(true);
    setFailure(null);
    try {
      const made = await api<Appointment>("/appointments", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        json: {
          appointmentTypeId: type.appointmentTypeId,
          clinicianProfileId: selected.clinicianProfileId,
          startAt: slot.startAt,
        },
      });
      await reload();
      navigate(`/booked/${made.appointmentId}`, { state: { appointment: made } });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409 && day) {
        setConflict({ slot, clinician: selected, date: day });
      } else {
        setFailure(caught instanceof Error ? caught.message : "The booking did not go through. Try again.");
      }
    } finally {
      setBooking(false);
    }
  }

  if (state.status === "failed") return <Notice tone="error">{state.message}</Notice>;
  if (!data) {
    return (
      <div className="find-care" aria-busy="true">
        <span className="skeleton find-list-skeleton" />
        <span className="skeleton find-detail-skeleton" />
      </div>
    );
  }

  if (conflict && type) {
    return (
      <Conflict
        taken={conflict}
        type={type}
        minutes={minutes}
        clinicians={data.clinicians}
        clinicName={(clinician) => clinicOf(clinician)?.name}
        onBack={() => {
          setConflict(null);
          setDay(conflict.date);
          setFreshness((n) => n + 1);
        }}
        onBooked={async (made) => {
          await reload();
          navigate(`/booked/${made.appointmentId}`, { state: { appointment: made } });
        }}
      />
    );
  }

  const slots = day ? counts[day] : undefined;
  const clinic = clinicOf(selected);
  const languages = (selected?.languages ?? []).map((code) => LANGUAGE[code] ?? code.toUpperCase());

  return (
    <div className="find-care">
      <section className="find-list glass" aria-labelledby="find-title">
        <header className="find-head">
          <h1 id="find-title">Find care</h1>
          <p>
            {listed.length === 1 ? "1 clinician" : `${listed.length} clinicians`}
            {specialty ? ` in ${specialty.toLowerCase()}` : " you can book"}
          </p>
        </header>
        <div className="find-search">
          <Search size={18} />
          <input
            aria-label="Search clinicians or specialties"
            placeholder="Search clinicians or specialties"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            className={`filter-button${showClinics || clinicFilter ? " filter-on" : ""}`}
            aria-label="Filter by clinic"
            aria-expanded={showClinics}
            onClick={() => setShowClinics((shown) => !shown)}
          >
            <Filter size={17} />
          </button>
        </div>
        {showClinics && (
          <div className="chips chips-clinics" role="group" aria-label="Clinic">
            <button type="button" className={`chip-choice${clinicFilter ? "" : " chip-on"}`} onClick={() => setClinicFilter(null)}>
              All clinics
            </button>
            {data.clinics.map((c) => (
              <button
                key={c.clinicId}
                type="button"
                className={`chip-choice${clinicFilter === c.clinicId ? " chip-on" : ""}`}
                onClick={() => setClinicFilter(c.clinicId)}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
        <div className="chips" role="group" aria-label="Specialty">
          <button type="button" className={`chip-choice${specialty ? "" : " chip-on"}`} onClick={() => setSpecialty(null)}>
            All
          </button>
          {specialties.map((name) => (
            <button
              key={name}
              type="button"
              className={`chip-choice${specialty === name ? " chip-on" : ""}`}
              aria-pressed={specialty === name}
              onClick={() => setSpecialty(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <ul className="clinicians" aria-label="Clinicians">
          {listed.map((clinician) => {
            const on = clinician === selected;
            return (
              <li key={clinician.clinicianProfileId}>
                <button
                  type="button"
                  className={`clinician${on ? " clinician-on" : ""}`}
                  aria-pressed={on}
                  onClick={() => setSelectedId(clinician.clinicianProfileId)}
                >
                  <span className="clinician-avatar" style={avatarStyle(data.clinicians.indexOf(clinician))}>
                    {initials(clinician.givenName, clinician.familyName)}
                  </span>
                  <span className="clinician-text">
                    <span className="clinician-name">{clinicianName(clinician)}</span>
                    <span className="clinician-sub">
                      {[clinician.specialty, clinicOf(clinician)?.name].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="clinician-band">
                    <Stethoscope size={13} />
                    {SENIORITY[clinician.seniorityBand]}
                  </span>
                </button>
              </li>
            );
          })}
          {!listed.length && <li className="empty">Nobody matches. Try another name or specialty.</li>}
        </ul>
      </section>

      <section className="find-detail glass" aria-label="Book with the selected clinician">
        {selected && type ? (
          <>
            <div className="detail-hero" key={selected.clinicianProfileId}>
              <span className="hero-bloom" aria-hidden="true" />
              <div className="detail-row">
                <span className="hero-avatar" style={{ color: "var(--blue-650)" }} aria-hidden="true">
                  {initials(selected.givenName, selected.familyName)}
                </span>
                <div className="detail-copy">
                  <h2>{clinicianName(selected)}</h2>
                  <p>{[selected.specialty, clinic?.name, `${minutes} minute visits`].filter(Boolean).join(" · ")}</p>
                </div>
                <dl className="detail-facts">
                  <div>
                    <dt>EXPERIENCE</dt>
                    <dd>{experience(selected) ?? "Listed"}</dd>
                  </div>
                  <div>
                    <dt>LANGUAGES</dt>
                    <dd>{(selected.languages ?? []).map((code) => code.toUpperCase()).join(" ") || "FR"}</dd>
                  </div>
                  <div>
                    <dt>VISIT</dt>
                    <dd>{minutes} min</dd>
                  </div>
                </dl>
              </div>
              <p className="detail-bio">
                {SENIORITY[selected.seniorityBand]} {selected.specialty?.toLowerCase()} practitioner at {clinic?.name ?? "the clinic"}
                {clinic?.address ? `, ${clinic.address}` : ""}. Consults in {languages.join(" and ") || "French"}.
              </p>
            </div>

            {bookable.length > 1 && (
              <div className="type-switch" role="radiogroup" aria-label="Kind of visit">
                {bookable.map((t) => (
                  <button
                    key={t.appointmentTypeId}
                    type="button"
                    role="radio"
                    aria-checked={t === type}
                    className={`type-option${t === type ? " type-on" : ""}`}
                    onClick={() => setTypeId(t.appointmentTypeId)}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}

            <div className="booking">
              <div className="row-head">
                <h3>Pick a day</h3>
                <div className="week-nav">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Previous week"
                    disabled={weekStart <= today}
                    onClick={() => setWeekStart((start) => (shift(start, -WEEK) < today ? today : shift(start, -WEEK)))}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span>{new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(onDate(week[3] ?? weekStart)))}</span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Next week"
                    disabled={Boolean(lastBookable && (week[WEEK - 1] ?? "") >= lastBookable)}
                    onClick={() => setWeekStart((start) => shift(start, WEEK))}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
              <div className="days" role="radiogroup" aria-label="Day" key={`${selected.clinicianProfileId}-${weekStart}`}>
                {week.map((date) => {
                  const free = counts[date];
                  const on = date === day;
                  return (
                    <button
                      key={date}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={`day${on ? " day-on" : ""}${free && !free.length ? " day-closed" : ""}`}
                      disabled={!free?.length}
                      onClick={() => setDay(date)}
                    >
                      <span className="day-name">{clock.weekday(onDate(date))}</span>
                      <span className="day-number">{Number(date.slice(8))}</span>
                      <span className="day-free">
                        {free === undefined ? <LoadingIndicator size={12} label="Checking" /> : free.length ? `${free.length} free` : "None"}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="row-head">
                <h3>Choose a time</h3>
                <span className="row-count">{slots ? `${slots.length} open` : ""}</span>
              </div>
              <div className="slots" role="radiogroup" aria-label="Time" key={`${day}-${type.appointmentTypeId}`}>
                {slots?.map((option) => {
                  const on = option.startAt === slot?.startAt;
                  return (
                    <button
                      key={option.startAt}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={`slot${on ? " slot-on" : ""}`}
                      onClick={() => setSlot(option)}
                    >
                      {clock.time(option.startAt)}
                    </button>
                  );
                })}
                {slots && !slots.length && <p className="empty">No times left on this day.</p>}
                {!slots && day && <LoadingIndicator size={28} label="Finding free times" />}
              </div>
            </div>

            <form className="dock" onSubmit={book}>
              {failure && <Notice tone="error">{failure}</Notice>}
              <div className="dock-row">
                <div className="dock-selection" aria-live="polite">
                  {slot ? (
                    <>
                      <span className="dock-label">
                        {clock.day(slot.startAt)} · {clock.time(slot.startAt)} to {clock.time(slot.endAt)}
                      </span>
                      <span className="dock-title" key={slot.startAt}>
                        {clinicianName(selected)}, {type.name.toLowerCase()}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="dock-label">No time selected</span>
                      <span className="dock-title">Pick a time above to continue</span>
                    </>
                  )}
                </div>
                <button type="submit" className="dock-button" disabled={!slot || booking} aria-busy={booking || undefined}>
                  {booking ? <LoadingIndicator size={22} label="Booking" /> : null}
                  <span>{booking ? "Booking" : "Book appointment"}</span>
                </button>
              </div>
            </form>
          </>
        ) : (
          <p className="empty">Choose a clinician to see when they are free.</p>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------- conflict */

type Range = "day" | "week" | "any";

function Conflict({
  taken,
  type,
  minutes,
  clinicians,
  clinicName,
  onBack,
  onBooked,
}: {
  taken: { slot: Slot; clinician: Clinician; date: string };
  type: AppointmentType;
  minutes: number;
  clinicians: Clinician[];
  clinicName: (clinician: Clinician) => string | undefined;
  onBack: () => void;
  onBooked: (made: Appointment) => Promise<void>;
}) {
  const [range, setRange] = useState<Range>("day");
  const [openings, setOpenings] = useState<{ clinician: Clinician; slot: Slot }[] | null>(null);
  const [choice, setChoice] = useState<{ clinician: Clinician; slot: Slot } | null>(null);
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [freshness, setFreshness] = useState(0);

  // The same specialty, nearest first: the taken clinician, then colleagues.
  const peers = useMemo(
    () => [taken.clinician, ...clinicians.filter((c) => c !== taken.clinician && c.specialty === taken.clinician.specialty)],
    [clinicians, taken.clinician],
  );

  useEffect(() => {
    let current = true;
    setOpenings(null);
    setChoice(null);
    const dates = range === "day" ? [taken.date] : days(taken.date, range === "week" ? WEEK : 14);
    Promise.all(
      peers.flatMap((clinician) =>
        dates.map((date) =>
          freeStarts(clinician.clinicianProfileId, type.appointmentTypeId, date)
            .then((slots) => slots.map((slot) => ({ clinician, slot })))
            .catch(() => []),
        ),
      ),
    ).then((found) => {
      if (!current) return;
      const soonest = found
        .flat()
        .filter((o) => o.slot.startAt !== taken.slot.startAt)
        .sort((a, b) => Math.abs(Date.parse(a.slot.startAt) - Date.parse(taken.slot.startAt)) - Math.abs(Date.parse(b.slot.startAt) - Date.parse(taken.slot.startAt)))
        .slice(0, 8)
        .sort((a, b) => a.slot.startAt.localeCompare(b.slot.startAt));
      setOpenings(soonest);
    });
    return () => {
      current = false;
    };
  }, [range, peers, taken, type.appointmentTypeId, freshness]);

  useEffect(() => setKey(newKey()), [choice?.slot.startAt, choice?.clinician.clinicianProfileId]);

  async function hold(event: FormEvent) {
    event.preventDefault();
    if (!choice) return;
    setBusy(true);
    setFailure(null);
    try {
      const made = await api<Appointment>("/appointments", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        json: {
          appointmentTypeId: type.appointmentTypeId,
          clinicianProfileId: choice.clinician.clinicianProfileId,
          startAt: choice.slot.startAt,
        },
      });
      await onBooked(made);
    } catch (caught) {
      setFailure(
        caught instanceof ApiError && caught.status === 409
          ? "That one has just gone too. Choose another."
          : caught instanceof Error
            ? caught.message
            : "The booking did not go through.",
      );
      setChoice(null);
      setFreshness((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="find-care conflict">
      <div className="conflict-left">
        <section className="conflict-card" role="alert">
          <span className="conflict-icon" aria-hidden="true">
            <Alert size={24} />
          </span>
          <h1>Someone took that slot.</h1>
          <p>
            {clock.time(taken.slot.startAt)} was booked a few seconds before you confirmed, so we did not hold it for you.
            Nothing was charged and no appointment was created.
          </p>
          <span className="conflict-chip">
            <Close size={11} />
            409 · SLOT ALREADY HELD
          </span>
        </section>
        <div className="taken-ticket" aria-label="The time that was taken">
          <span className="taken-time">
            <s>{clock.time(taken.slot.startAt)}</s>
            <span>{minutes} min</span>
          </span>
          <span className="taken-text">
            <span>{clinicianName(taken.clinician)}</span>
            <span>
              {clock.day(taken.slot.startAt)} · {clinicName(taken.clinician)}
            </span>
          </span>
          <span className="taken-chip">TAKEN</span>
        </div>
        <section className="panel glass why" aria-labelledby="why-title">
          <h2 id="why-title">Why this happens</h2>
          <ul>
            <li>
              <span className="why-icon">
                <Clock size={14} />
              </span>
              A time is only yours once it is confirmed, never while you are choosing.
            </li>
            <li>
              <span className="why-icon">
                <Lock size={14} />
              </span>
              The clinic calendar allows exactly one booking per clinician per time.
            </li>
            <li>
              <span className="why-icon">
                <Repeat size={14} />
              </span>
              Nothing to undo. Pick another time on the right and you are done.
            </li>
          </ul>
          <button type="button" className="link back-link" onClick={onBack}>
            <ChevronLeft size={14} /> Back to all times
          </button>
        </section>
      </div>

      <section className="find-detail glass openings" aria-labelledby="openings-title">
        <div className="openings-head">
          <div>
            <h2 id="openings-title">Closest openings</h2>
            <p>
              {openings === null
                ? "Looking for openings"
                : openings.length === 1
                  ? "1 opening matches"
                  : openings.length
                    ? `${openings.length} openings match, soonest first`
                    : "No other openings in this range"}
            </p>
          </div>
          <div className="segmented" role="radiogroup" aria-label="How far to look">
            {(
              [
                ["day", "Same day"],
                ["week", "This week"],
                ["any", "Any time"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={range === value}
                className={`segment${range === value ? " segment-on" : ""}`}
                onClick={() => setRange(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="opening-grid" role="radiogroup" aria-label="Openings" key={range}>
          {openings === null && <LoadingIndicator size={36} label="Looking for openings" />}
          {openings?.map((option) => {
            const on = choice?.slot.startAt === option.slot.startAt && choice.clinician === option.clinician;
            return (
              <button
                key={`${option.clinician.clinicianProfileId}-${option.slot.startAt}`}
                type="button"
                role="radio"
                aria-checked={on}
                className={`opening${on ? " opening-on" : ""}`}
                onClick={() => setChoice(option)}
              >
                <span className="opening-time">
                  <span>{clock.time(option.slot.startAt)}</span>
                  <span>{minutes} min</span>
                </span>
                <span className="opening-text">
                  <span>{clinicianName(option.clinician)}</span>
                  <span>
                    {clock.day(option.slot.startAt)} · {clinicName(option.clinician)}
                  </span>
                </span>
                <span className="radio" aria-hidden="true" />
              </button>
            );
          })}
          {openings && !openings.length && <p className="empty">Nothing open in this range. Try a wider one.</p>}
        </div>
        <form className="dock" onSubmit={hold}>
          {failure && <Notice tone="error">{failure}</Notice>}
          <div className="dock-row">
            <div className="dock-selection" aria-live="polite">
              <span className="dock-label">Choose a replacement slot</span>
              <span className="dock-title" key={choice?.slot.startAt ?? "none"}>
                {choice
                  ? `${clock.day(choice.slot.startAt)}, ${clock.time(choice.slot.startAt)} with ${clinicianName(choice.clinician)}`
                  : "Nothing selected yet"}
              </span>
            </div>
            <button type="submit" className="dock-button" disabled={!choice || busy} aria-busy={busy || undefined}>
              {busy ? <LoadingIndicator size={22} label="Booking" /> : null}
              <span>{busy ? "Booking" : "Hold this slot"}</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
