/**
 * Clinical Operations Reports (FR-MSR-01, FR-MSR-02, FR-MSR-04, FR-MSR-07).
 *
 * A unit manager reads their unit's report; an administrator every unit's, or
 * one. The period's visits by what became of them, attendance by how patients
 * booked and by what became of their reminder, and the fee ledger's entries
 * as a record of entitlement.
 *
 * Supports Day, Week, Month, and Year granularities, Material 3 Expressive
 * visual representations, and direct export to PDF, Excel (.xlsx), and CSV.
 */

import { type CSSProperties, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { api } from "../api/client";
import { useSession } from "../auth/session";
import { Notice } from "../components/controls";
import { ChevronLeft, ChevronRight, Shield } from "../components/icons";
import { DatePickerMenu } from "../components/DatePickerMenu";
import { DonutChart, MultiUnitBarChart } from "../components/ExpressiveCharts";
import { LoadingPane } from "../components/LoadingPane";
import { SelectMenu } from "../components/Pickers";
import { TENANT } from "../tenant";
import {
  attendanceChange,
  exportReportCsv,
  exportReportExcel,
  exportReportPdf,
  type ReportComparison,
  signed,
} from "../utils/reportExport";
import { ReportDownload } from "./ReportDownload";
import { attendanceOf, roleOf, useStaffData } from "./data";
import { sentence } from "./labels";

interface Rate {
  booked: number;
  attended: number;
  noShow: number;
  attendance: number | null;
}

interface Figures {
  comparison?: ReportComparison;
  booked: number;
  attended: number;
  noShow: number;
  cancelled: number;
  lateCancelled: number;
  open?: number;
  attendance?: number | null;
  byChannel?: (Rate & { channel: string })[];
  byBookedBy?: (Rate & { bookedBy: string })[];
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
  from?: string;
  to: string;
  granularity?: string;
  firstDay: string | null;
}

interface HospitalWeek extends Figures {
  week: string;
  from?: string;
  to: string;
  granularity?: string;
  firstDay: string | null;
  units: UnitWeek[];
}

type Granularity = "day" | "week" | "month" | "year";

const CHANNEL: Record<string, string> = { ONLINE: "Online", WALK_IN: "At the desk", PHONE: "By phone", REFERRAL: "Referred" };
const REMINDER: Record<string, string> = { SENT: "Reminder sent", FAILED: "Reminder failed", NOT_SENT: "No reminder" };
const ENTITLEMENT: Record<string, string> = { FULL: "Full refund", PARTIAL: "Partial refund", NONE: "No refund" };
/** Who made a booking (core/report.booked_by_of), kept apart from the channel (2026-10-07). */
const BOOKED_BY_LABEL: Record<string, string> = {
  PATIENT: "The patient",
  RECEPTIONIST: "A receptionist",
  CLINICIAN: "A clinician",
  CLINIC_MANAGER: "A unit manager",
  TENANT_ADMIN: "An administrator",
};

const EVERY = "every";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monday(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

const percent = (rate: number | null | undefined) => (rate == null ? "Not yet" : `${Math.round(rate * 100)}%`);
const money = (amount: number, currency: string) => `${new Intl.NumberFormat("en-GB").format(amount)} ${currency}`;
const range = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

function stepDate(current: string, gran: Granularity, delta: number): string {
  const d = new Date(`${current}T12:00:00Z`);
  if (gran === "day") {
    d.setUTCDate(d.getUTCDate() + delta);
  } else if (gran === "week") {
    d.setUTCDate(d.getUTCDate() + delta * 7);
  } else if (gran === "month") {
    d.setUTCMonth(d.getUTCMonth() + delta);
  } else if (gran === "year") {
    d.setUTCFullYear(d.getUTCFullYear() + delta);
  }
  return d.toISOString().slice(0, 10);
}

function formatPeriod(current: string, gran: Granularity): string {
  const d = new Date(`${current}T12:00:00Z`);
  if (gran === "day") {
    return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  }
  if (gran === "week") {
    const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
    const sun = new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate() + 6));
    return `${range.format(mon)} to ${range.format(sun)}`;
  }
  if (gran === "month") {
    return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  }
  return `Year ${d.getUTCFullYear()}`;
}

export function Reports() {
  const { state } = useSession();
  const { state: directory } = useStaffData();
  const me = state.status === "signed-in" ? state.me : undefined;
  const role = me ? roleOf(me) : "RECEPTIONIST";
  const admin = role === "TENANT_ADMIN";

  const [granularity, setGranularity] = useState<Granularity>("week");
  const [date, setDate] = useState(() => (granularity === "week" ? monday(new Date()) : todayIso()));
  const [unit, setUnit] = useState<string>(admin ? EVERY : (me?.clinicId ?? ""));
  const [found, setFound] = useState<UnitWeek | HospitalWeek | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [compare, setCompare] = useState("none");

  useEffect(() => {
    if (!unit) return;
    let live = true;
    setFound(null);
    const isWeek = granularity === "week";
    const earlier = compare === "previous" ? `&before=${encodeURIComponent(stepDate(date, granularity, -1))}` : "";
    const path =
      (unit === EVERY
        ? isWeek
          ? `/reports?week=${encodeURIComponent(date)}`
          : `/reports?date=${encodeURIComponent(date)}&granularity=${granularity}`
        : isWeek
          ? `/clinics/${encodeURIComponent(unit)}/report?week=${encodeURIComponent(date)}`
          : `/clinics/${encodeURIComponent(unit)}/report?date=${encodeURIComponent(date)}&granularity=${granularity}`) + earlier;
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
  }, [unit, date, granularity, compare]);

  if (state.status !== "signed-in") return null;
  if (role !== "TENANT_ADMIN" && role !== "CLINIC_MANAGER") return <Navigate to="/console" replace />;

  const clinics = directory.status === "ready" ? directory.data.clinics : [];
  const unitName = unit === EVERY ? "All hospital units" : (clinics.find((c) => c.clinicId === unit)?.name ?? unit);
  const periodLabel = formatPeriod(date, granularity);
  const reportTitle = { day: "Daily report", week: "Weekly report", month: "Monthly report", year: "Annual report" }[granularity];
  // A file outlives the screen it came from, so its period always names the year.
  const exportContext = {
    title: reportTitle,
    period: /\d{4}/.test(periodLabel) ? periodLabel : `${periodLabel} ${date.slice(0, 4)}`,
    unit: unitName,
    hospital: TENANT.name,
  };

  const step = (delta: number) => setDate((curr) => stepDate(curr, granularity, delta));
  const firstDay = found?.firstDay ?? "2026-09-19";
  const isAtStart = date <= firstDay;
  const isAtEnd = date >= todayIso();

  const hospital = found && "units" in found ? found : null;
  const one = found && !("units" in found) ? found : null;

  const attendanceRate = found ? (one ? one.attendance : attendanceOf(found)) : null;

  return (
    <div className="accounts-page reports-page">
      <header className="accounts-top reports-header">
        <div>
          <h1>{reportTitle}</h1>
          <p>Visits disposition, attendance rate and fee ledger summary.</p>
        </div>

        {/* Download Action Menu - Right Aligned on Screen */}
        {found && (
          <div className="accounts-actions reports-actions">
            <ReportDownload
              admin={admin}
              formats={[
                { id: "pdf", label: "PDF", hint: "To print or share", pick: () => void exportReportPdf(found, exportContext) },
                {
                  id: "xlsx",
                  label: "Excel",
                  hint: "Summary, units, channels, fees",
                  pick: () => void exportReportExcel(found, exportContext),
                },
                { id: "csv", label: "CSV", hint: "Plain rows for any spreadsheet", pick: () => exportReportCsv(found, exportContext) },
              ]}
            />
          </div>
        )}
      </header>

      {/* Filter and Period Navigation Toolbar */}
      <div className="reports-toolbar">
        {/* Material 3 Expressive Granularity Selector */}
        <div className="overview-segmented-control reports-granularity-control" role="tablist" aria-label="Timeframe granularity">
          {(["day", "week", "month", "year"] as const).map((g) => (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={granularity === g}
              className={`overview-segment-btn ${granularity === g ? "active" : ""}`}
              onClick={() => {
                setGranularity(g);
                if (g === "week") {
                  setDate((curr) => monday(new Date(`${curr}T12:00:00Z`)));
                }
              }}
            >
              {g === "day" ? "Day" : g === "week" ? "Week" : g === "month" ? "Month" : "Year"}
            </button>
          ))}
        </div>

        {admin && (
          <SelectMenu
            label="Unit"
            value={unit}
            width={260}
            options={[{ id: EVERY, label: "Every unit" }, ...clinics.map((c) => ({ id: c.clinicId, label: c.name }))]}
            onChange={setUnit}
          />
        )}

        <SelectMenu
          label="Compare"
          value={compare}
          width={240}
          options={[
            { id: "none", label: "No comparison" },
            { id: "previous", label: `With the previous ${granularity}` },
          ]}
          onChange={setCompare}
        />

        <div className="changes-week">
          <button type="button" className="square-button" aria-label="Previous period" disabled={isAtStart} onClick={() => step(-1)}>
            <ChevronLeft size={16} />
          </button>
          <span>{periodLabel}</span>
          <button type="button" className="square-button" aria-label="Next period" disabled={isAtEnd} onClick={() => step(1)}>
            <ChevronRight size={16} />
          </button>
          <DatePickerMenu
            value={date}
            label="Jump to date"
            onChange={(nextDate) => {
              if (granularity === "week") {
                setDate(monday(new Date(`${nextDate}T12:00:00Z`)));
              } else {
                setDate(nextDate);
              }
            }}
          />
        </div>
      </div>

      {failure && <Notice tone="error">{failure}</Notice>}
      {!found ? (
        <LoadingPane label="Loading the report" />
      ) : (
        <>
          {/* Top KPI Tiles */}
          <section className="reports-tiles" aria-label={granularity === "week" ? "The week in numbers" : "In numbers"}>
            {(
              [
                ["Booked", found.booked, "booked"],
                ["Attended", found.attended, "attended"],
                ["No-show", found.noShow, "noShow"],
                ["Cancelled", found.cancelled, "cancelled"],
                ["Late cancelled", found.lateCancelled, "lateCancelled"],
              ] as const
            ).map(([label, value, key], index) => {
              const c = found.comparison?.counts[key];
              return (
                <div key={label} className="glass reports-tile" style={{ "--i": index } as CSSProperties}>
                  <span className="reports-tile-label">{label}</span>
                  <span className="reports-tile-value">{value}</span>
                  {c && (
                    <span className="reports-tile-label">
                      was {c.before}, {signed(c.change)}
                    </span>
                  )}
                </div>
              );
            })}
            <div className="glass reports-tile reports-tile-accent" style={{ "--i": 5 } as CSSProperties}>
              <span className="reports-tile-label">Attendance</span>
              <span className="reports-tile-value">{percent(attendanceRate)}</span>
              {found.comparison && <span className="reports-tile-label">{attendanceChange(found.comparison.attendance)}</span>}
            </div>
          </section>
          {found.comparison && (
            <p className="availability-note">Against the period before this one. A difference is shown, not a reason for it.</p>
          )}

          {/* Material 3 Expressive Visual Distribution Charts */}
          <section className="glass reports-visual-section" aria-label="Visit outcome visual analysis">
            <div className="reports-visual-top">
              <div>
                <h3>Outcomes and channels</h3>
                <p>How this period's visits ended, how they were booked, and where.</p>
              </div>
              <div className="reports-visual-rate-pill">
                <span>Attendance</span>
                <strong>{percent(attendanceRate)}</strong>
              </div>
            </div>

            <div
              style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 24, marginTop: 12 }}
            >
              <DonutChart
                title="How visits ended"
                subtitle="Every visit booked in the period, including those not closed yet."
                segments={[
                  {
                    id: "attended",
                    label: "Attended",
                    value: found.attended,
                    color: "#10b981",
                  },
                  {
                    id: "noshow",
                    label: "No-show",
                    value: found.noShow,
                    color: "#f43f5e",
                  },
                  {
                    id: "cancelled",
                    label: "Cancelled",
                    value: found.cancelled,
                    color: "#f59e0b",
                  },
                  ...(found.booked - (found.attended + found.noShow + found.cancelled + found.lateCancelled) > 0
                    ? [
                        {
                          id: "open",
                          label: "Still open",
                          value: found.booked - (found.attended + found.noShow + found.cancelled + found.lateCancelled),
                          color: "#94a3b8",
                        },
                      ]
                    : []),
                  ...(found.lateCancelled > 0
                    ? [
                        {
                          id: "lateCancelled",
                          label: "Late cancelled",
                          value: found.lateCancelled,
                          color: "#ea580c",
                        },
                      ]
                    : []),
                ]}
                centerValue={percent(attendanceRate)}
                centerSub="Attendance"
                size={230}
              />

              {found.byChannel && found.byChannel.length > 0 && (
                <DonutChart
                  title="How patients booked"
                  subtitle="How this period's bookings reached the unit."
                  segments={found.byChannel.map((c) => {
                    const colors: Record<string, string> = {
                      ONLINE: "#3b82f6",
                      WALK_IN: "#06b6d4",
                      PHONE: "#8b5cf6",
                      REFERRAL: "#ec4899",
                    };
                    const channelNames: Record<string, string> = {
                      ONLINE: "Online booking",
                      WALK_IN: "At the desk",
                      PHONE: "Phone booking",
                      REFERRAL: "Referral",
                    };
                    return {
                      id: c.channel,
                      label: channelNames[c.channel] ?? c.channel,
                      value: c.booked,
                      color: colors[c.channel] ?? "#64748b",
                    };
                  })}
                  centerValue={String(found.booked)}
                  centerSub="Bookings"
                  size={230}
                />
              )}
            </div>

            {hospital && hospital.units && hospital.units.length > 0 && (
              <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--line-hairline, #e1e7f0)" }}>
                <MultiUnitBarChart
                  title="Volume by unit"
                  subtitle="Visits and attendance at each unit."
                  units={hospital.units.map((u) => ({
                    unitId: u.clinicId,
                    name: u.clinicName || u.clinicId,
                    attended: u.attended,
                    noShow: u.noShow,
                    cancelled: u.cancelled + u.lateCancelled,
                    total: u.booked,
                    rate: u.attendance,
                  }))}
                  onSelectUnit={(id) => setUnit(id)}
                />
              </div>
            )}
          </section>

          {hospital && (
            <section className="glass accounts-card" aria-label="Every unit">
              <div className="accounts-head reports-units-head" aria-hidden="true">
                <span>UNIT</span>
                <span>BOOKED</span>
                <span>ATTENDED</span>
                <span>NO-SHOW</span>
                <span>ATTENDANCE</span>
              </div>
              {hospital.units.length > 0 ? (
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
              ) : (
                <p className="overview-empty" style={{ padding: "20px 16px", textAlign: "center" }}>
                  No units recorded activity in this period.
                </p>
              )}
            </section>
          )}
          <div className="reports-cols">
            <RateCard
              title="Attendance by how they booked"
              rows={(found.byChannel ?? []).map((r) => ({ ...r, label: CHANNEL[r.channel] ?? r.channel }))}
            />
            <RateCard
              title="Who booked"
              note="The patient, or staff on their behalf."
              rows={(found.byBookedBy ?? []).map((r) => ({ ...r, label: BOOKED_BY_LABEL[r.bookedBy] ?? r.bookedBy }))}
            />
            <RateCard
              title="Attendance by reminder"
              note="Shown side by side, not as cause and effect."
              rows={(found.byReminder ?? []).map((r) => ({ ...r, label: REMINDER[r.reminder] ?? r.reminder }))}
            />
            <section className="glass availability-card reports-ledger" aria-labelledby="ledger-title">
              <h2 id="ledger-title">Fee ledger</h2>
              <p className="accounts-banner reports-banner">
                <Shield size={16} />A record of each closed visit's fee and refund. No money moves through Atria.
              </p>
              {found.ledger && found.ledger.entries ? (
                <>
                  <dl className="reports-list">
                    {found.ledger.byEntitlement.map((row) => (
                      <div key={row.entitlement}>
                        <dt>{ENTITLEMENT[row.entitlement] ?? row.entitlement}</dt>
                        <dd>
                          {row.entries} {row.entries === 1 ? "visit" : "visits"} · {money(row.amountMinor, found.ledger!.currency)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="settings-label">By fee band</p>
                  <dl className="reports-list">
                    {found.ledger.byBand.map((row) => (
                      <div key={row.practice}>
                        <dt>{row.practice}</dt>
                        <dd>
                          {row.entries} · {money(row.amountMinor, found.ledger!.currency)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : (
                <p className="today-empty">No visits closed in this period yet.</p>
              )}
            </section>
          </div>
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
        <p className="today-empty">No visits in this period.</p>
      )}
    </section>
  );
}
