/**
 * "Desktop · Visits + detail" (142:2) and "Desktop · Cancel dialog" (147:2):
 * a patient's visits, one in detail, and cancelling it (FR-VIS-01, FR-VIS-02,
 * FR-VIS-03).
 *
 * Where the frame shows what Phase 1 does not have, the nearest true thing
 * stands in: the room and the fee give way to the visit's length; messaging
 * the clinic and choosing the reminder's lead time (48h, 24h, 2h) are Phase 2,
 * so the reminder is stated rather than chosen; and rescheduling is not in
 * Phase 1, so a visit is kept or cancelled.
 *
 * The list can be searched and narrowed by specialty, clinician or clinic,
 * and it is paged rather than scrolled (feedback 2026-09-25).
 *
 * Cancelling tells the patient, before they confirm, whether it falls inside
 * the appointment type's cancellation window, which is what decides a late
 * cancellation (D-07). The reason they pick is recorded with it.
 */

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { api } from "../api/client";
import { Notice } from "../components/controls";
import { LoadingPane } from "../components/LoadingPane";
import { byPopularity, ChipRow, FilterMenu } from "../components/FilterMenu";
import { FeeRecord } from "../components/FeeRecord";
import { MoveVisit } from "../components/MoveVisit";
import { BeforeVisit } from "./BeforeVisit";
import { NewTimeOffer } from "./NewTimeOffer";
import { RequestDetail, TicketDetail } from "./QueueVisit";
import { Alert, Bell, Building, CheckMark, ChevronLeft, Close, Filter, Mail, Stethoscope, User } from "../components/icons";
import { Pager, usePages, useRowsThatFit } from "../components/Pager";
import { rank, SearchSuggest, type SuggestionGroup } from "../components/SearchSuggest";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { useTier } from "../layout/fit";
import {
  ACTIVE_STATES,
  type Appointment,
  clinicianName,
  clock,
  initials,
  join,
  past,
  stateLabel,
  upcoming,
  usePatientData,
  directionsTo,
} from "./data";

const DAY_MS = 24 * 60 * 60 * 1000;
const REASONS = ["Feeling better", "Schedule clash", "Cost", "Booked elsewhere", "Other"] as const;
const BOOKED_VIA: Record<string, string> = {
  ONLINE: "Atria web",
  WEB: "Atria web",
  APP: "Atria app",
  PHONE: "Front desk, by phone",
  WALK_IN: "Front desk",
};

function hoursUntil(instant: string, now = Date.now()): number {
  return (Date.parse(instant) - now) / 3600000;
}

export function Visits() {
  const { state, reload } = usePatientData();
  const { id } = useParams();
  const phone = useTier() === "mobile";
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [done, setDone] = useState<string | null>(null);

  const data = state.status === "ready" ? state.data : undefined;
  const ahead = data ? upcoming(data.appointments) : [];
  const behind = data ? past(data.appointments) : [];
  // A cancelled visit that was still ahead belongs with the past: it is over.
  const cancelledAhead = data
    ? data.appointments.filter((a) => !ACTIVE_STATES.includes(a.state) && Date.parse(a.startAt) > Date.now())
    : [];
  const earlier = [...cancelledAhead, ...behind];
  const selectedVisit = data?.appointments.find((a) => a.appointmentId === id);
  const tab = params.get("show") === "past" || (selectedVisit && !ahead.includes(selectedVisit)) ? "past" : "upcoming";
  const inTab = tab === "past" ? earlier : ahead;

  const [query, setQuery] = useState("");
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [clinicianId, setClinicianId] = useState<string | null>(null);
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const filterButton = useRef<HTMLButtonElement>(null);
  const rowsBox = useRef<HTMLUListElement>(null);

  // What this patient's visits have in them, most visited first.
  const joined = useMemo(
    () => (data ? data.appointments.map((a) => ({ a, ...join(data, a) })) : []),
    [data],
  );
  const specialties = byPopularity(joined, (j) => j.clinician?.specialty);
  const clinicianOptions = byPopularity(joined, (j) => j.clinician?.clinicianProfileId).map((o) => ({
    ...o,
    label: clinicianName(joined.find((j) => j.clinician?.clinicianProfileId === o.id)?.clinician),
  }));
  const clinicOptions = byPopularity(joined, (j) => j.clinic?.clinicId).map((o) => ({
    ...o,
    label: joined.find((j) => j.clinic?.clinicId === o.id)?.clinic?.name ?? o.id,
  }));
  const shown = inTab.filter((appointment) => {
    const { clinician, clinic } = data ? join(data, appointment) : {};
    if (specialty && clinician?.specialty !== specialty) return false;
    if (clinicianId && clinician?.clinicianProfileId !== clinicianId) return false;
    if (clinicId && clinic?.clinicId !== clinicId) return false;
    if (!query.trim()) return true;
    const text = [clinicianName(clinician), clinician?.specialty, clinic?.name, appointment.reference].filter(Boolean).join(" ");
    return rank(text, query) > 0;
  });
  const menuFilters = [clinicianId, clinicId].filter(Boolean).length;
  const size = useRowsThatFit(rowsBox, { row: ".visit-item", pitch: 96, gap: 10 });
  const pages = usePages(shown, size, `${tab}|${query}|${specialty}|${clinicianId}|${clinicId}`);
  const suggestions: SuggestionGroup[] = [
    {
      id: "clinicians",
      label: "Clinicians",
      icon: User,
      items: clinicianOptions.map((o) => ({
        id: o.id,
        label: o.label,
        hint: `${o.count} ${o.count === 1 ? "visit" : "visits"}`,
        onPick: () => {
          setQuery("");
          setClinicianId(o.id);
        },
      })),
    },
    {
      id: "specialties",
      label: "Specialties",
      icon: Stethoscope,
      items: specialties.map((o) => ({
        id: o.id,
        label: o.label,
        hint: `${o.count} ${o.count === 1 ? "visit" : "visits"}`,
        onPick: () => {
          setQuery("");
          setSpecialty(o.id);
        },
      })),
    },
    {
      id: "clinics",
      label: "Units",
      icon: Building,
      items: clinicOptions.map((o) => ({
        id: o.id,
        label: o.label,
        hint: `${o.count} ${o.count === 1 ? "visit" : "visits"}`,
        onPick: () => {
          setQuery("");
          setClinicId(o.id);
        },
      })),
    },
  ];
  const selected = selectedVisit ?? shown[0];
  const cancelling = params.get("cancel") === "1" && selected && ACTIVE_STATES.includes(selected.state);
  const moving = params.get("move") === "1" && selected && ACTIVE_STATES.includes(selected.state);

  function choose(which: "upcoming" | "past") {
    setDone(null);
    navigate(which === "past" ? "/visits?show=past" : "/visits");
  }

  if (state.status === "failed") return <Notice tone="error">{state.message}</Notice>;
  if (!data) {
    return (
      <div className="find-care" aria-busy="true">
        <LoadingPane glass className="find-list" />
      </div>
    );
  }

  return (
    // On a phone the list and one visit are two screens (Mobile · My visits,
    // 36:4, and Mobile · Visit details, 36:115); wider, they sit side by side.
    <div className="find-care visits" data-step={id ? "detail" : "list"}>
      <section className="find-list glass" aria-labelledby="visits-title">
        <header className="find-head">
          <h1 id="visits-title">Your visits</h1>
          <p>
            {ahead.length} upcoming · {behind.filter((a) => ["COMPLETED", "AWAITING_FEEDBACK"].includes(a.state)).length} completed
          </p>
        </header>
        <div className="visits-tabs" role="tablist" aria-label="Visits">
          <span className="visits-pill" aria-hidden="true" style={{ transform: tab === "past" ? "translateX(calc(100% + 5px))" : "none" }} />
          <button type="button" role="tab" aria-selected={tab === "upcoming"} onClick={() => choose("upcoming")}>
            Upcoming
          </button>
          <button type="button" role="tab" aria-selected={tab === "past"} onClick={() => choose("past")}>
            Past visits
          </button>
        </div>
        <SearchSuggest
          label="Search your visits"
          placeholder="Clinician, specialty or reference"
          value={query}
          onChange={setQuery}
          groups={suggestions}
          trailing={
            <button
              ref={filterButton}
              type="button"
              className={`filter-button${menuOpen || menuFilters ? " filter-on" : ""}`}
              aria-label="Filters"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <Filter size={17} />
            </button>
          }
        />
        {specialties.length > 1 && (
          <ChipRow
            label="Specialty"
            options={specialties}
            value={specialty}
            onChange={setSpecialty}
            onMore={() => setMenuOpen(true)}
            moreActive={menuFilters}
          />
        )}
        <FilterMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          anchor={filterButton}
          title="Filter your visits"
          sections={[
            { id: "specialty", label: "Specialty", options: specialties, value: specialty, onChange: setSpecialty },
            { id: "clinician", label: "Clinician", options: clinicianOptions, value: clinicianId, onChange: setClinicianId, allLabel: "Any clinician" },
            { id: "clinic", label: "Unit", options: clinicOptions, value: clinicId, onChange: setClinicId, allLabel: "Any unit" },
          ]}
          results={shown.length === 1 ? "Show 1 visit" : `Show ${shown.length} visits`}
          onClear={() => {
            setSpecialty(null);
            setClinicianId(null);
            setClinicId(null);
          }}
        />
        <ul ref={rowsBox} className="clinicians visit-list" aria-label={tab === "past" ? "Past visits" : "Upcoming visits"}>
          {pages.shown.map((appointment) => {
            const { clinician, clinic, type } = join(data, appointment);
            const status = stateLabel(appointment.state);
            const on = appointment === selected;
            return (
              <li key={appointment.appointmentId} className={phone && ACTIVE_STATES.includes(appointment.state) ? "visit-card" : undefined}>
                <Link
                  className={`visit-item${on ? " visit-item-on" : ""}`}
                  to={`/visits/${appointment.appointmentId}`}
                  aria-current={on ? "true" : undefined}
                >
                  <span className="date-tile" aria-hidden="true">
                    <span>{clock.month(appointment.startAt)}</span>
                    <span>{clock.date(appointment.startAt)}</span>
                  </span>
                  <span className="visit-text">
                    <span className="visit-name">
                      {appointment.sessionId
                        ? `Outpatient queue, place ${appointment.position ?? ""}`
                        : appointment.state === "REQUESTED" || appointment.state === "DECLINED"
                          ? (type?.name ?? "Procedure request")
                          : clinicianName(clinician)}
                    </span>
                    <span className="visit-sub">
                      {(appointment.sessionId
                        ? [clinic?.name, `arrive ${clock.time(appointment.startAt)}`]
                        : appointment.state === "REQUESTED"
                          ? [clinic?.name, "time to be set"]
                          : [clinician?.specialty, clinic?.name, clock.time(appointment.startAt)]
                      )
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <span className={`chip chip-${status.tone}`}>{status.label}</span>
                  </span>
                </Link>
                {phone && ACTIVE_STATES.includes(appointment.state) && tab === "upcoming" && (
                  <div className="visit-card-actions">
                    <Link className="outline-danger" to={`/visits/${appointment.appointmentId}?cancel=1`}>
                      Cancel visit
                    </Link>
                    <Link className="dock-button" to={`/visits/${appointment.appointmentId}`}>
                      Details
                    </Link>
                  </div>
                )}
              </li>
            );
          })}
          {!shown.length && inTab.length > 0 && <li className="empty">No visits match. Try another name, or clear the filters.</li>}
          {!inTab.length && (
            <li className="empty">
              {tab === "past" ? "Past visits will be listed here." : "Nothing booked."}{" "}
              {tab === "upcoming" && (
                <Link className="link" to="/find-care">
                  Find care
                </Link>
              )}
            </li>
          )}
        </ul>
        {shown.length > 0 && (
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

      <section className="find-detail glass visit-detail" aria-label="Visit details">
        <div className="phone-bar">
          <Link className="square-button" to={`/visits${tab === "past" ? "?show=past" : ""}`} aria-label="Back to your visits">
            <ChevronLeft size={18} />
          </Link>
          <span>Visit details</span>
        </div>
        {done && <Notice tone="success">{done}</Notice>}
        {selected ? (
          <VisitDetail
            key={selected.appointmentId}
            appointment={selected}
            onCancel={() => setParams({ cancel: "1" })}
            onMove={() => setParams({ move: "1" })}
            onMoved={async (moved) => {
              await reload();
              setDone(`Booked for ${clock.day(moved.startAt)} at ${clock.time(moved.startAt)}. Your reference stays ${moved.reference}.`);
            }}
            onConfirmed={async () => {
              await reload();
              setDone("Thank you. The unit knows you are coming.");
            }}
          />
        ) : (
          <p className="empty">Choose a visit to see its details.</p>
        )}
      </section>

      {moving && selected && (
        <MoveVisit
          appointment={selected}
          type={join(data, selected).type}
          who={{
            givenName: join(data, selected).clinician?.givenName,
            familyName: join(data, selected).clinician?.familyName,
            label: clinicianName(join(data, selected).clinician),
          }}
          withWhom={join(data, selected).clinic?.name ?? ""}
          byStaff={false}
          onClose={() => setParams({})}
          onMoved={async (moved) => {
            await reload();
            setParams({});
            setDone(`Moved to ${clock.day(moved.startAt)} at ${clock.time(moved.startAt)}. Your reference stays ${moved.reference}, and we have emailed you.`);
          }}
        />
      )}
      {cancelling && selected && (
        <CancelDialog
          appointment={selected}
          onClose={() => setParams({})}
          onCancelled={async (message) => {
            await reload();
            setParams({});
            setDone(message);
          }}
        />
      )}
    </div>
  );
}

function VisitDetail({
  appointment,
  onCancel,
  onMove,
  onMoved,
  onConfirmed,
}: {
  appointment: Appointment;
  onCancel: () => void;
  onMove: () => void;
  onMoved: (moved: Appointment) => Promise<void>;
  onConfirmed: () => Promise<void>;
}) {
  const { state } = usePatientData();
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  if (state.status !== "ready") return null;
  const { clinician, clinic, type } = join(state.data, appointment);
  const status = stateLabel(appointment.state);
  const minutes = (type?.durationUnits ?? 0) * state.data.gridUnitMinutes;
  const active = ACTIVE_STATES.includes(appointment.state) && Date.parse(appointment.startAt) > Date.now();
  const reminderAt = new Date(Date.parse(appointment.startAt) - DAY_MS);
  const directions = clinic ? directionsTo(clinic) : "https://www.google.com/maps";
  // Tablet (52:2) and phone (36:115) hold the actions outside the cards.
  const tablet = useTier() !== "desktop";
  async function confirm() {
    setConfirming(true);
    setFailed(null);
    try {
      await api(`/appointments/${appointment.appointmentId}/confirm`, { method: "POST" });
      await onConfirmed();
    } catch {
      setFailed("That did not go through. Check your connection and try again.");
      setConfirming(false);
    }
  }

  const actions = (
    <div className="visit-actions">
      {appointment.state === "DISRUPTED" && <NewTimeOffer appointment={appointment} onMoved={onMoved} onMore={onMove} />}
      {failed && <Notice tone="error">{failed}</Notice>}
      {active && appointment.state === "BOOKED" && (
        <button type="button" className="tonal-button" disabled={confirming} aria-busy={confirming || undefined} onClick={confirm}>
          <CheckMark size={15} />
          {confirming ? <LoadingIndicator size={20} label="Confirming" /> : null}
          {confirming ? "Confirming" : "I'll be there"}
        </button>
      )}
      {active && appointment.state !== "DISRUPTED" && (
        <button type="button" className="outline-button" onClick={onMove}>
          Move visit
        </button>
      )}
      {active && (
        <button type="button" className="outline-danger" onClick={onCancel}>
          Cancel visit
        </button>
      )}
      <a className="dock-button directions" href={directions} target="_blank" rel="noreferrer">
        Get directions
      </a>
    </div>
  );

  // A queue ticket and a procedure request read differently (QueueVisit.tsx).
  if (appointment.sessionId) {
    const waiting = ["BOOKED", "CONFIRMED"].includes(appointment.state);
    return (
      <TicketDetail
        appointment={appointment}
        actions={
          <div className="visit-actions">
            {waiting && (
              <button type="button" className="outline-danger" onClick={onCancel}>
                Give up my place
              </button>
            )}
            <a className="dock-button directions" href={directions} target="_blank" rel="noreferrer">
              Get directions
            </a>
          </div>
        }
      />
    );
  }
  if (appointment.state === "REQUESTED" || appointment.state === "DECLINED") {
    return (
      <RequestDetail
        appointment={appointment}
        actions={
          appointment.state === "DECLINED" ? (
            <div className="visit-actions">
              <Link className="dock-button" to="/find-care/queue">
                Book a consultation
              </Link>
            </div>
          ) : null
        }
      />
    );
  }

  return (
    <>
      <div className={`visit-hero${active && appointment.state !== "DISRUPTED" ? "" : ` visit-hero-${status.tone}`}`}>
        <span className="hero-bloom" aria-hidden="true" />
        <span className="hero-tag">{status.label.toUpperCase()}</span>
        <h2>{clock.long(appointment.startAt)}</h2>
        <p>{[type?.name, `${minutes} minutes`, clinic?.name].filter(Boolean).join(" · ")}</p>
        <dl className="visit-cells">
          <div>
            <dt>STARTS</dt>
            <dd>{clock.time(appointment.startAt)}</dd>
          </div>
          <div>
            <dt>ENDS</dt>
            <dd>{clock.time(appointment.endAt)}</dd>
          </div>
          <div>
            <dt>DURATION</dt>
            <dd>{minutes} min</dd>
          </div>
          <div>
            <dt>REF</dt>
            <dd>{appointment.reference}</dd>
          </div>
        </dl>
      </div>

      {type?.intakeFormId && <BeforeVisit appointmentId={appointment.appointmentId} clinician={clinicianName(clinician)} />}

      <div className="visit-cols">
        <section className="panel inner-card" aria-labelledby="who-title">
          <h3 id="who-title">Clinician and unit</h3>
          <div className="who">
            <span className="clinician-avatar" style={{ background: "var(--gradient-primary)" }} aria-hidden="true">
              {initials(clinician?.givenName, clinician?.familyName)}
            </span>
            <span>
              <span className="clinician-name">{clinicianName(clinician)}</span>
              <span className="who-sub">{clinician?.specialty}</span>
            </span>
          </div>
          <dl className="facts-list">
            <div>
              <dt>Unit</dt>
              <dd>{clinic?.name ?? "Not listed"}</dd>
            </div>
            <div>
              <dt>Address</dt>
              <dd>{clinic?.address ?? "Ask the clinic"}</dd>
            </div>
            <div>
              <dt>Booked</dt>
              <dd>{clock.day(appointment.createdAt)}</dd>
            </div>
            <div>
              <dt>Booked via</dt>
              <dd>{BOOKED_VIA[appointment.channel ?? ""] ?? "Atria"}</dd>
            </div>
            <FeeRecord appointmentId={appointment.appointmentId} state={appointment.state} />
            {active && (
              <div>
                <dt>Reminder</dt>
                <dd>
                  {appointment.state === "DISRUPTED"
                    ? "Set again once you choose"
                    : reminderAt.getTime() > Date.now()
                      ? "SMS and email, 24 hours before"
                      : "SMS sent at booking"}
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section className="panel inner-card" aria-labelledby="activity-title">
          <h3 id="activity-title">Activity</h3>
          <ol className="timeline">
            <li>
              <span className="timeline-dot dot-done">
                <CheckMark size={11} />
              </span>
              <span>
                <span className="timeline-title">Booked in Atria</span>
                <span className="timeline-sub">
                  {clock.day(appointment.createdAt)}, {clock.time(appointment.createdAt)}
                </span>
              </span>
            </li>
            <li>
              <span className="timeline-dot dot-blue-tint">
                <Mail size={11} />
              </span>
              <span>
                <span className="timeline-title">Confirmation email sent</span>
                <span className="timeline-sub">
                  {clock.day(appointment.createdAt)}, {clock.time(appointment.createdAt)}
                </span>
              </span>
            </li>
            {appointment.state.endsWith("CANCELLED") ? (
              <li>
                <span className="timeline-dot dot-red">
                  <Close size={11} />
                </span>
                <span>
                  <span className="timeline-title">{status.label}</span>
                  <span className="timeline-sub">The time went back on the calendar and the reminder was removed</span>
                </span>
              </li>
            ) : appointment.state === "DISRUPTED" ? (
              <li>
                <span className="timeline-dot dot-amber-tint">
                  <Alert size={11} />
                </span>
                <span>
                  <span className="timeline-title">New time needed</span>
                  <span className="timeline-sub">The clinician is no longer available; the reminder was removed</span>
                </span>
              </li>
            ) : (
              <li>
                <span className="timeline-dot dot-amber-tint">
                  <Bell size={11} />
                </span>
                <span>
                  <span className="timeline-title">
                    {reminderAt.getTime() > Date.parse(appointment.createdAt) ? "SMS reminder scheduled" : "SMS confirmation sent"}
                  </span>
                  <span className="timeline-sub">
                    {reminderAt.getTime() > Date.parse(appointment.createdAt)
                      ? `${clock.day(reminderAt)}, ${clock.time(reminderAt)} · 24h before`
                      : "The visit was less than a day away when booked"}
                  </span>
                </span>
              </li>
            )}
          </ol>
          {!tablet && actions}
        </section>
      </div>
      {/* The tablet frame (52:2) runs the actions under both cards. */}
      {tablet && actions}
    </>
  );
}

interface CancellationPreview {
  outcome: string;
  entitlement: "FULL" | "PARTIAL" | "NONE";
  amountMinor: number | null;
  currency: string | null;
  freeUntil: string;
}

/** The entitlement bands (FR-MSR-06), in the patient's words. A record, never money moved (FR-MSR-07). */
export const ENTITLEMENT: Record<"FULL" | "PARTIAL" | "NONE", { label: string; tone: string; note: string }> = {
  FULL: { label: "Full", tone: "confirmed", note: "The whole visit fee is recorded as not owed." },
  PARTIAL: { label: "Partial", tone: "awaiting", note: "Cancelling this late, part of the visit fee is recorded as owed." },
  NONE: { label: "None", tone: "neutral", note: "The visit fee is recorded as owed." },
};

export const fee = (amount: number, currency: string | null) => `${new Intl.NumberFormat("en-GB").format(amount)} ${currency ?? "XAF"}`;

function CancelDialog({
  appointment,
  onClose,
  onCancelled,
}: {
  appointment: Appointment;
  onClose: () => void;
  onCancelled: (message: string) => Promise<void>;
}) {
  const { state } = usePatientData();
  const [reason, setReason] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  // What cancelling now would record, from the server (FR-MSR-06), shown before the confirm.
  const [preview, setPreview] = useState<CancellationPreview | null>(null);
  useEffect(() => {
    let live = true;
    api<{ cancellationPreview?: CancellationPreview | null }>(`/appointments/${appointment.appointmentId}`)
      .then((found) => live && setPreview(found.cancellationPreview ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [appointment.appointmentId]);

  // Escape closes it, and focus starts inside it.
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  if (state.status !== "ready") return null;
  const { clinician, clinic, type } = join(state.data, appointment);
  const windowHours = (type?.cancellationWindowMinutes ?? 1440) / 60;
  const away = hoursUntil(appointment.startAt);
  const late = away < windowHours;
  const awayText = away >= 48 ? `${Math.round(away / 24)} days` : `${Math.max(1, Math.round(away))} hours`;

  async function cancel(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const result = await api<{ outcome: string }>(`/appointments/${appointment.appointmentId}`, {
        method: "DELETE",
        json: reason ? { reason: reason === "Other" && other.trim() ? `Other: ${other.trim()}` : reason } : {},
      });
      await onCancelled(
        result.outcome === "CANCELLED_LATE"
          ? `Visit ${appointment.reference} cancelled. It was inside ${windowHours} hours, so it is recorded as late.`
          : `Visit ${appointment.reference} cancelled. The time is free for someone else, and your reminder is removed.`,
      );
    } catch (caught) {
      setFailure(caught instanceof Error ? caught.message : "The visit could not be cancelled. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div
        ref={dialog}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-title"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="dialog-icon" aria-hidden="true">
          <Close size={22} />
        </span>
        <h2 id="cancel-title">Cancel this visit?</h2>
        <p className="dialog-lede">
          The time goes back on the calendar straight away, your reminder is removed, and a cancellation notice is emailed to
          you.
        </p>
        <div className="dialog-visit">
          <span className="clinician-avatar" style={{ background: "var(--gradient-primary)" }} aria-hidden="true">
            {clinician ? initials(clinician.givenName, clinician.familyName) : <Stethoscope size={20} />}
          </span>
          <span className="dialog-visit-text">
            <span className="clinician-name">
              {clinician ? clinicianName(clinician) : appointment.sessionId ? "General consultation" : (type?.name ?? "Your visit")}
            </span>
            <span className="who-sub">{[clinician?.specialty, clinic?.name].filter(Boolean).join(" · ")}</span>
          </span>
          <span className="dialog-when">
            <span>{clock.time(appointment.startAt)}</span>
            <span>{clock.day(appointment.startAt)}</span>
          </span>
        </div>
        <form onSubmit={cancel}>
          <p className="dialog-label" id="reason-label">
            REASON (OPTIONAL)
          </p>
          <div className="chips" role="radiogroup" aria-labelledby="reason-label">
            {REASONS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={reason === option}
                className={`chip-choice${reason === option ? " chip-on" : ""}`}
                onClick={() => setReason((current) => (current === option ? null : option))}
              >
                {option}
              </button>
            ))}
          </div>
          {reason === "Other" && (
            <textarea
              className="dialog-text"
              aria-label="Your reason"
              placeholder="Tell the clinic why, in a few words"
              maxLength={300}
              autoFocus
              value={other}
              onChange={(event) => setOther(event.target.value)}
            />
          )}
          <div className={`dialog-note${(preview ? preview.entitlement !== "FULL" : late) ? " dialog-note-late" : ""}`}>
            <Alert size={15} />
            <p>
              {late
                ? `This visit is ${awayText} away, inside the ${windowHours} hour cancellation window, so it will be recorded as a late cancellation.`
                : `Cancelling inside ${windowHours} hours of a visit is recorded by the clinic. This one is ${awayText} away, so nothing is flagged.`}
            </p>
          </div>
          <dl className="fee-band" aria-label="What cancelling now records">
            <div>
              <dt>Entitlement</dt>
              <dd>
                <span className={`chip chip-${ENTITLEMENT[preview?.entitlement ?? (late ? "PARTIAL" : "FULL")].tone}`}>
                  {ENTITLEMENT[preview?.entitlement ?? (late ? "PARTIAL" : "FULL")].label}
                </span>
              </dd>
            </div>
            {preview?.amountMinor != null && (
              <div>
                <dt>Visit fee</dt>
                <dd>{fee(preview.amountMinor, preview.currency)}</dd>
              </div>
            )}
          </dl>
          <p className="fee-band-note">{ENTITLEMENT[preview?.entitlement ?? (late ? "PARTIAL" : "FULL")].note} Nothing is charged or paid through Atria.</p>
          {failure && <Notice tone="error">{failure}</Notice>}
          <div className="dialog-actions">
            <button type="button" className="outline-button keep" onClick={onClose} disabled={busy}>
              Keep appointment
            </button>
            <button type="submit" className="danger-button" disabled={busy} aria-busy={busy || undefined}>
              {busy ? <LoadingIndicator size={20} label="Cancelling" /> : null}
              {busy ? "Cancelling" : "Cancel visit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
