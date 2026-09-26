/**
 * A clinician's working hours and time off (FR-DIR-03 to FR-DIR-05, FR-STF-10).
 *
 * There is no frame for it; it extends the staff console's Rev A look: two
 * glass cards, the week on the left and time off on the right. What a role
 * may do decides what is offered, from the same matrix the API enforces:
 *
 *   a clinician     their own hours, blocks and leave, and marking themselves unavailable
 *   a unit manager  the same for every clinician in the unit
 *   the front desk  reads it, and marks a clinician unavailable
 *
 * Blocking time a visit already holds is refused by the API, and the reason
 * is shown; leave and "unavailable" disrupt the visits inside instead, and the
 * page says how many patients were asked to choose a new time.
 */

import { type FormEvent, useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { useSession } from "../auth/session";
import { Notice } from "../components/controls";
import { Clock, Close, Plus } from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { MATRIX } from "../generated/permissions";
import { clock } from "../patient/data";
import { doctor, roleOf, useStaffData } from "./data";
import { sentence } from "./labels";
import { Snackbar } from "./Snackbar";

type Hours = Record<string, { start: string; end: string }>;

interface TimeOff {
  groupId: string;
  kind: "BLOCK" | "LEAVE" | "UNAVAILABLE";
  from: string;
  to: string;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
}

interface Availability {
  clinicianProfileId: string;
  usesUnitHours: boolean;
  hours: Hours;
  unitHours: Hours;
  timeOff: TimeOff[];
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const KIND: Record<TimeOff["kind"], { label: string; tone: string; hint: string }> = {
  BLOCK: { label: "Blocked", tone: "neutral", hint: "Free time taken out of booking. Refused where a visit is booked." },
  LEAVE: { label: "Leave", tone: "awaiting", hint: "Whole days. Visits inside are disrupted and each patient asked to choose again." },
  UNAVAILABLE: { label: "Unavailable", tone: "cancelled", hint: "Visits inside are disrupted and each patient asked to choose again." },
};

const can = (role: string, permission: keyof typeof MATRIX) => (MATRIX[permission] as Record<string, string>)[role] !== "none";

function when(item: TimeOff): string {
  const days =
    item.from === item.to
      ? clock.day(`${item.from}T12:00:00Z`)
      : `${clock.day(`${item.from}T12:00:00Z`)} to ${clock.day(`${item.to}T12:00:00Z`)}`;
  return item.startTime ? `${days}, ${item.startTime} to ${item.endTime}` : `${days}, all day`;
}

export function Availability() {
  const { state: session } = useSession();
  const { state: directory } = useStaffData();
  const me = session.status === "signed-in" ? session.me : undefined;
  const role = me ? roleOf(me) : "RECEPTIONIST";
  const writes = can(role, "availability.write");
  const disrupts = can(role, "session.disrupt");

  const colleagues = useMemo(
    () =>
      directory.status === "ready"
        ? directory.data.clinicians.filter((c) =>
            role === "CLINICIAN" ? c.clinicianProfileId === me?.staffId : c.clinicId === me?.clinicId,
          )
        : [],
    [directory, role, me?.staffId, me?.clinicId],
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const clinicianId = chosen ?? (role === "CLINICIAN" ? (me?.staffId ?? null) : (colleagues[0]?.clinicianProfileId ?? null));
  const clinician = colleagues.find((c) => c.clinicianProfileId === clinicianId);

  const [found, setFound] = useState<Availability | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [fresh, setFresh] = useState(0);
  const [said, setSaid] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!clinicianId) return;
    let live = true;
    setFound(null);
    api<Availability>(`/clinicians/${encodeURIComponent(clinicianId)}/availability`)
      .then((data) => live && setFound(data))
      .catch(() => live && setFailed("Availability could not be loaded. Check your connection and try again."));
    return () => {
      live = false;
    };
  }, [clinicianId, fresh]);

  async function giveBack(item: TimeOff) {
    try {
      await api(`/clinicians/${encodeURIComponent(clinicianId ?? "")}/time-off/${encodeURIComponent(item.groupId)}`, { method: "DELETE" });
      setSaid(`${KIND[item.kind].label} time given back. It can be booked again.`);
      setFresh((n) => n + 1);
    } catch (caught) {
      setFailed(sentence(caught instanceof Error ? caught.message : "That did not go through"));
    }
  }

  return (
    <div className="availability-page">
      <header className="accounts-top">
        <div>
          <h1>Availability</h1>
          <p>{role === "CLINICIAN" ? "Your working week and time off." : "Working hours and time off for the unit's clinicians."}</p>
        </div>
        {role !== "CLINICIAN" && colleagues.length > 0 && (
          <label className="availability-who">
            <span>Clinician</span>
            <select value={clinicianId ?? ""} onChange={(event) => setChosen(event.target.value)}>
              {colleagues.map((c) => (
                <option key={c.clinicianProfileId} value={c.clinicianProfileId}>
                  {doctor(c)}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {failed && <Notice tone="error">{failed}</Notice>}

      <div className="availability-cols">
        <section className="glass availability-card" aria-labelledby="hours-title">
          <h2 id="hours-title">Working hours</h2>
          {found ? (
            <WeekEditor
              key={`${found.clinicianProfileId}-${fresh}`}
              found={found}
              clinicianId={clinicianId ?? ""}
              editable={writes}
              onSaved={(message) => {
                setSaid(message);
                setFresh((n) => n + 1);
              }}
            />
          ) : (
            <LoadingIndicator size={28} label="Loading hours" />
          )}
        </section>

        <section className="glass availability-card" aria-labelledby="off-title">
          <div className="availability-head">
            <h2 id="off-title">Time off</h2>
            {(writes || disrupts) && found && (
              <button type="button" className="staff-primary availability-add" onClick={() => setAdding(true)}>
                <Plus size={16} />
                Take time off
              </button>
            )}
          </div>
          {!found ? (
            <LoadingIndicator size={28} label="Loading time off" />
          ) : found.timeOff.length ? (
            <ul className="time-off-list">
              {found.timeOff.map((item) => (
                <li key={item.groupId} className="time-off-item">
                  <span className={`chip chip-${KIND[item.kind].tone}`}>{KIND[item.kind].label}</span>
                  <span className="time-off-text">
                    <span className="time-off-when">{when(item)}</span>
                    {item.reason && <span className="time-off-why">{item.reason}</span>}
                  </span>
                  {writes && item.kind !== "UNAVAILABLE" && (
                    <button type="button" className="outline-button time-off-back" onClick={() => giveBack(item)}>
                      Give back
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="today-empty">No time off ahead.</p>
          )}
        </section>
      </div>

      {adding && clinicianId && (
        <TimeOffDialog
          clinicianId={clinicianId}
          name={clinician ? doctor(clinician) : "This clinician"}
          kinds={(["BLOCK", "LEAVE", "UNAVAILABLE"] as const).filter((k) => (k === "UNAVAILABLE" ? disrupts : writes))}
          onClose={() => setAdding(false)}
          onDone={(message) => {
            setAdding(false);
            setSaid(message);
            setFresh((n) => n + 1);
          }}
        />
      )}
      <Snackbar message={said} onDone={() => setSaid(null)} />
    </div>
  );
}

function WeekEditor({
  found,
  clinicianId,
  editable,
  onSaved,
}: {
  found: Availability;
  clinicianId: string;
  editable: boolean;
  onSaved: (message: string) => void;
}) {
  const start = found.usesUnitHours ? found.unitHours : found.hours;
  const [week, setWeek] = useState<Record<string, { on: boolean; start: string; end: string }>>(() =>
    Object.fromEntries(
      WEEKDAYS.map((_, day) => {
        const span = start[String(day)];
        return [String(day), { on: Boolean(span), start: span?.start ?? "08:00", end: span?.end ?? "16:00" }];
      }),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    const days = Object.fromEntries(Object.entries(week).map(([day, v]) => [day, v.on ? { start: v.start, end: v.end } : null]));
    try {
      await api(`/clinicians/${encodeURIComponent(clinicianId)}/hours`, { method: "PUT", json: { days } });
      onSaved("Working hours saved. New bookings follow them from now.");
    } catch (caught) {
      setFailure(`${sentence(caught instanceof Error ? caught.message : "The hours could not be saved")} Nothing was changed.`);
      setBusy(false);
    }
  }

  return (
    <form className="week-editor" onSubmit={save}>
      <p className="availability-note">
        {found.usesUnitHours
          ? "Following the unit's opening hours. Save to give this clinician hours of their own."
          : "Hours of their own. A day left off is a day off."}
      </p>
      <ol className="week-rows">
        {WEEKDAYS.map((name, day) => {
          const row = week[String(day)] as { on: boolean; start: string; end: string };
          const set = (patch: Partial<typeof row>) => setWeek((w) => ({ ...w, [String(day)]: { ...row, ...patch } }));
          return (
            <li key={name} className={`week-row${row.on ? "" : " week-row-off"}`}>
              <label className="week-day">
                <input type="checkbox" checked={row.on} disabled={!editable} onChange={(event) => set({ on: event.target.checked })} />
                <span>{name}</span>
              </label>
              {row.on ? (
                <span className="week-times">
                  <input
                    type="time"
                    step={600}
                    aria-label={`${name} start`}
                    value={row.start}
                    disabled={!editable}
                    onChange={(event) => set({ start: event.target.value })}
                  />
                  <span aria-hidden="true">to</span>
                  <input
                    type="time"
                    step={600}
                    aria-label={`${name} end`}
                    value={row.end}
                    disabled={!editable}
                    onChange={(event) => set({ end: event.target.value })}
                  />
                </span>
              ) : (
                <span className="week-off">Day off</span>
              )}
            </li>
          );
        })}
      </ol>
      {failure && <Notice tone="error">{failure}</Notice>}
      {editable && (
        <button type="submit" className="staff-primary" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Saving" : "Save hours"}
        </button>
      )}
    </form>
  );
}

function TimeOffDialog({
  clinicianId,
  name,
  kinds,
  onClose,
  onDone,
}: {
  clinicianId: string;
  name: string;
  kinds: readonly TimeOff["kind"][];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const today = clock.isoDate(new Date());
  const [kind, setKind] = useState<TimeOff["kind"]>(kinds[0] ?? "UNAVAILABLE");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [wholeDay, setWholeDay] = useState(kind === "LEAVE");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("12:00");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const leave = kind === "LEAVE";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    const whole = leave || wholeDay;
    const body = {
      kind,
      reason: reason.trim(),
      ...(leave ? { from, to } : { date: from }),
      ...(whole ? {} : { startTime, endTime }),
    };
    try {
      const done = await api<{ disrupted: unknown[] }>(`/clinicians/${encodeURIComponent(clinicianId)}/time-off`, {
        method: "POST",
        json: body,
      });
      const count = done.disrupted.length;
      onDone(
        count
          ? `Time off recorded. ${count} ${count === 1 ? "visit was" : "visits were"} disrupted, and each patient emailed to choose a new time.`
          : "Time off recorded. No visits were affected.",
      );
    } catch (caught) {
      setFailure(`${sentence(caught instanceof Error ? caught.message : "That did not go through")} Nothing was changed.`);
      setBusy(false);
    }
  }

  return (
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div
        className="dialog staff-dialog move-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="off-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="icon-button dialog-close" aria-label="Close" onClick={onClose} disabled={busy}>
          <Close size={16} />
        </button>
        <div className="move-scroll">
          <span className="dialog-icon dialog-icon-blue" aria-hidden="true">
            <Clock size={22} />
          </span>
          <h2 id="off-dialog-title">Take time off</h2>
          <p className="dialog-lede">{name}. Recorded against your account.</p>
          <form id="off-form" onSubmit={submit}>
            {kinds.length > 1 && (
              <div className="segmented" role="radiogroup" aria-label="Kind of time off">
                {kinds.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={kind === k}
                    className={`segment${kind === k ? " segment-on" : ""}`}
                    onClick={() => {
                      setKind(k);
                      if (k === "LEAVE") setWholeDay(true);
                    }}
                  >
                    {k === "BLOCK" ? "Block" : KIND[k].label}
                  </button>
                ))}
              </div>
            )}
            <p className="availability-note">{KIND[kind].hint}</p>
            <div className="off-fields">
              <label>
                <span>{leave ? "From" : "Date"}</span>
                <input
                  type="date"
                  min={today}
                  value={from}
                  onChange={(event) => {
                    setFrom(event.target.value);
                    if (to < event.target.value) setTo(event.target.value);
                  }}
                  required
                />
              </label>
              {leave && (
                <label>
                  <span>To</span>
                  <input type="date" min={from} value={to} onChange={(event) => setTo(event.target.value)} required />
                </label>
              )}
            </div>
            {!leave && (
              <>
                <label className="week-day">
                  <input type="checkbox" checked={wholeDay} onChange={(event) => setWholeDay(event.target.checked)} />
                  <span>The whole day</span>
                </label>
                {!wholeDay && (
                  <div className="off-fields">
                    <label>
                      <span>From</span>
                      <input type="time" step={600} value={startTime} onChange={(event) => setStartTime(event.target.value)} required />
                    </label>
                    <label>
                      <span>Until</span>
                      <input type="time" step={600} value={endTime} onChange={(event) => setEndTime(event.target.value)} required />
                    </label>
                  </div>
                )}
              </>
            )}
            <textarea
              className="dialog-text"
              aria-label="Reason"
              placeholder="Reason, required. Patients are told in general terms."
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
            />
            {failure && <Notice tone="error">{failure}</Notice>}
          </form>
        </div>
        <div className="dialog-actions move-actions">
          <button type="button" className="outline-button keep" onClick={onClose} disabled={busy}>
            Keep the time
          </button>
          <button type="submit" form="off-form" className="staff-primary" disabled={busy || !reason.trim()} aria-busy={busy || undefined}>
            {busy ? "Saving" : "Take time off"}
          </button>
        </div>
      </div>
    </div>
  );
}
