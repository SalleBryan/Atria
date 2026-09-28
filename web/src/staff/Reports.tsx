/**
 * The weekly report (FR-MSR-01, FR-MSR-02, FR-MSR-04, FR-MSR-07).
 *
 * A unit manager reads their unit's week; an administrator every unit's, or
 * one. The week's visits by what became of them, attendance by how patients
 * booked and by what became of their reminder, and the fee ledger's entries
 * as a record of entitlement. Weeks go back to the first day of use.
 *
 * It says what happened and nothing it cannot know: no figure claims what
 * reminders saved in money (FR-MSR-04), and the ledger is a record, not money
 * moved (FR-MSR-07).
 *
 * Built from the console's glass cards, the Staff accounts header, the
 * platform's picker, and the roster's load bars for rates.
 */

import { type CSSProperties, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { api } from "../api/client";
import { useSession } from "../auth/session";
import { Notice } from "../components/controls";
import { ChevronLeft, ChevronRight, Shield } from "../components/icons";
import { LoadingPane } from "../components/LoadingPane";
import { SelectMenu } from "../components/Pickers";
import { roleOf, useStaffData } from "./data";
import { sentence } from "./labels";

interface Rate {
  booked: number;
  attended: number;
  noShow: number;
  attendance: number | null;
}

interface Figures {
  booked: number;
  attended: number;
  noShow: number;
  cancelled: number;
  lateCancelled: number;
  open?: number;
  attendance?: number | null;
  byChannel?: (Rate & { channel: string })[];
  byReminder?: (Rate & { reminder: string })[];
  ledger?: {
    entries: number;
    currency: string;
    byEntitlement: { entitlement: string; entries: number; amountMinor: number }[];
    byBand: { practice: string; entries: number; amountMinor: number }[];
  };
}

interface UnitWeek extends Figures {
  clinicId: string;
  clinicName: string | null;
  week: string;
  to: string;
  firstDay: string | null;
}

interface HospitalWeek extends Figures {
  week: string;
  to: string;
  firstDay: string | null;
  units: UnitWeek[];
}

const CHANNEL: Record<string, string> = { ONLINE: "Online", WALK_IN: "At the desk", PHONE: "By phone", REFERRAL: "Referred" };
const REMINDER: Record<string, string> = { SENT: "Reminder sent", FAILED: "Reminder failed", NOT_SENT: "No reminder" };
const ENTITLEMENT: Record<string, string> = { FULL: "Full entitlement", PARTIAL: "Partial entitlement", NONE: "No entitlement" };

const EVERY = "every";

function monday(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

const percent = (rate: number | null | undefined) => (rate == null ? "Not yet" : `${Math.round(rate * 100)}%`);
const money = (amount: number, currency: string) => `${new Intl.NumberFormat("en-GB").format(amount)} ${currency}`;
const range = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

export function Reports() {
  const { state } = useSession();
  const { state: directory } = useStaffData();
  const me = state.status === "signed-in" ? state.me : undefined;
  const role = me ? roleOf(me) : "RECEPTIONIST";
  const admin = role === "TENANT_ADMIN";
  const thisWeek = monday(new Date());
  const [week, setWeek] = useState(thisWeek);
  const [unit, setUnit] = useState<string>(admin ? EVERY : (me?.clinicId ?? ""));
  const [found, setFound] = useState<UnitWeek | HospitalWeek | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!unit) return;
    let live = true;
    setFound(null);
    const path = unit === EVERY ? `/reports?week=${week}` : `/clinics/${encodeURIComponent(unit)}/report?week=${week}`;
    api<UnitWeek | HospitalWeek>(path)
      .then((data) => {
        if (!live) return;
        setFound(data);
        setFailure(null);
      })
      .catch((error: unknown) => live && setFailure(error instanceof Error ? sentence(error.message) : "The report could not be loaded."));
    return () => {
      live = false;
    };
  }, [unit, week]);

  if (state.status !== "signed-in") return null;
  if (role !== "TENANT_ADMIN" && role !== "CLINIC_MANAGER") return <Navigate to="/console" replace />;

  const clinics = directory.status === "ready" ? directory.data.clinics : [];
  const step = (days: number) => setWeek(new Date(Date.parse(`${week}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10));
  const firstWeek = found?.firstDay ? monday(new Date(`${found.firstDay}T12:00:00Z`)) : null;
  const hospital = found && "units" in found ? found : null;
  const one = found && !("units" in found) ? found : null;

  return (
    <div className="accounts-page reports-page">
      <header className="accounts-top">
        <div>
          <h1>Weekly report</h1>
          <p>What happened to the week's visits, and what the fee ledger recorded.</p>
        </div>
        <div className="reports-controls">
          {admin && (
            <SelectMenu
              label="Unit"
              value={unit}
              width={300}
              options={[{ id: EVERY, label: "Every unit" }, ...clinics.map((c) => ({ id: c.clinicId, label: c.name }))]}
              onChange={setUnit}
            />
          )}
          <div className="changes-week">
            <button
              type="button"
              className="square-button"
              aria-label="Previous week"
              disabled={Boolean(firstWeek && week <= firstWeek)}
              onClick={() => step(-7)}
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              {range.format(new Date(`${week}T12:00:00Z`))} to {range.format(new Date(Date.parse(`${week}T12:00:00Z`) + 6 * 86400000))}
            </span>
            <button type="button" className="square-button" aria-label="Next week" disabled={week >= thisWeek} onClick={() => step(7)}>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </header>

      {failure && <Notice tone="error">{failure}</Notice>}
      {!found ? (
        <LoadingPane label="Loading the report" />
      ) : (
        <>
          <section className="reports-tiles" aria-label="The week in numbers">
            {(
              [
                ["Booked", found.booked],
                ["Attended", found.attended],
                ["No-show", found.noShow],
                ["Cancelled", found.cancelled],
                ["Late cancelled", found.lateCancelled],
              ] as const
            ).map(([label, value], index) => (
              <div key={label} className="glass reports-tile" style={{ "--i": index } as CSSProperties}>
                <span className="reports-tile-label">{label}</span>
                <span className="reports-tile-value">{value}</span>
              </div>
            ))}
            <div className="glass reports-tile reports-tile-accent" style={{ "--i": 5 } as CSSProperties}>
              <span className="reports-tile-label">Attendance</span>
              <span className="reports-tile-value">
                {percent(one ? one.attendance : found.attended + found.noShow ? found.attended / (found.attended + found.noShow) : null)}
              </span>
            </div>
          </section>

          {hospital ? (
            <section className="glass accounts-card" aria-label="Every unit">
              <div className="accounts-head reports-units-head" aria-hidden="true">
                <span>UNIT</span>
                <span>BOOKED</span>
                <span>ATTENDED</span>
                <span>NO-SHOW</span>
                <span>ATTENDANCE</span>
              </div>
              <ul className="accounts-rows">
                {hospital.units.map((u, index) => (
                  <li key={u.clinicId} className="account-row reports-unit-row" style={{ "--i": index } as CSSProperties}>
                    <button type="button" className="reports-unit-link" onClick={() => setUnit(u.clinicId)}>
                      {u.clinicName ?? u.clinicId}
                    </button>
                    <span>{u.booked}</span>
                    <span>{u.attended}</span>
                    <span>{u.noShow}</span>
                    <RateBar rate={u.attendance ?? null} label={`${u.clinicName} attendance`} />
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            one && (
              <div className="reports-cols">
                <RateCard
                  title="Attendance by how they booked"
                  rows={(one.byChannel ?? []).map((r) => ({ ...r, label: CHANNEL[r.channel] ?? r.channel }))}
                />
                <RateCard
                  title="Attendance by reminder"
                  note="Shown side by side, not as cause and effect."
                  rows={(one.byReminder ?? []).map((r) => ({ ...r, label: REMINDER[r.reminder] ?? r.reminder }))}
                />
                <section className="glass availability-card reports-ledger" aria-labelledby="ledger-title">
                  <h2 id="ledger-title">Fee ledger</h2>
                  <p className="accounts-banner reports-banner">
                    <Shield size={16} />A record of each closed visit's fee and entitlement. No money moves through Atria.
                  </p>
                  {one.ledger && one.ledger.entries ? (
                    <>
                      <dl className="reports-list">
                        {one.ledger.byEntitlement.map((row) => (
                          <div key={row.entitlement}>
                            <dt>{ENTITLEMENT[row.entitlement] ?? row.entitlement}</dt>
                            <dd>
                              {row.entries} {row.entries === 1 ? "visit" : "visits"} · {money(row.amountMinor, one.ledger!.currency)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <p className="settings-label">By fee band</p>
                      <dl className="reports-list">
                        {one.ledger.byBand.map((row) => (
                          <div key={row.practice}>
                            <dt>{row.practice}</dt>
                            <dd>
                              {row.entries} · {money(row.amountMinor, one.ledger!.currency)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </>
                  ) : (
                    <p className="today-empty">No visit closed this week yet.</p>
                  )}
                </section>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}

function RateBar({ rate, label }: { rate: number | null; label: string }) {
  const value = Math.round((rate ?? 0) * 100);
  return (
    <span className="roster-load">
      <span className="roster-load-text">{percent(rate)}</span>
      <span className="roster-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
        <span className="roster-fill" style={{ width: `${value}%` }} />
      </span>
    </span>
  );
}

function RateCard({ title, note, rows }: { title: string; note?: string; rows: (Rate & { label: string })[] }) {
  return (
    <section className="glass availability-card" aria-label={title}>
      <h2>{title}</h2>
      {note && <p className="availability-note">{note}</p>}
      {rows.length ? (
        <ul className="reports-rates">
          {rows.map((row) => (
            <li key={row.label}>
              <span className="reports-rate-name">
                <span>{row.label}</span>
                <span>
                  {row.booked} booked · {row.attended} came · {row.noShow} did not
                </span>
              </span>
              <RateBar rate={row.attendance} label={`${row.label} attendance`} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="today-empty">No visits this week.</p>
      )}
    </section>
  );
}
