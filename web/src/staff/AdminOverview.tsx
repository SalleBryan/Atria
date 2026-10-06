/**
 * "Admin · Overview" (211:2): where the administrator lands. The accounts in
 * four figures, the week's message delivery as a chart with what failed, the
 * coming week's cover, quick ways into the rest of the console, and what
 * administrators changed lately.
 *
 * Built from the endpoints the other screens read: /admin/staff for the
 * accounts, /messages/delivery for the chart, /capacity for the cover and
 * /audit for the activity. Each panel loads on its own, so one slow source
 * never holds the others back.
 */

import { type ComponentType, type CSSProperties, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { api } from "../api/client";
import { useSession } from "../auth/session";
import { LoadingPane } from "../components/LoadingPane";
import { DonutChart, MultiUnitBarChart } from "../components/ExpressiveCharts";
import { Alert, Building, Calendar, Check, Clock, Mail, Plus, Shield, Sliders, User } from "../components/icons";
import { clock, initials } from "../patient/data";
import { TENANT } from "../tenant";
import { ACTION_LABEL, type AuditEntry } from "./AuditLog";
import { attendanceOf, roleOf } from "./data";

interface Channel {
  attempted: number;
  delivered: number;
  failed: number;
}
interface Delivery {
  totals: { email: Channel & { bounced: number }; sms: Channel };
  days: { day: string; email: Channel & { bounced: number }; sms: Channel }[];
}
interface Capacity {
  from: string;
  to: string;
  cliniciansOnShift: number;
  leave: { clinicianProfileId: string; clinicianName: string; clinicName: string; from: string; to: string; booked: number }[];
  uncovered: { clinicId: string; clinicName: string; days: string[] }[];
  covered: { clinicId: string; clinicName: string; clinicians: number; freeHours: number }[];
}
interface StaffFacets {
  total: number;
  facets: { status: Record<string, number> };
}
interface HospitalReport {
  week: string;
  booked: number;
  attended: number;
  noShow: number;
  cancelled: number;
  lateCancelled: number;
  units?: {
    clinicId: string;
    clinicName: string | null;
    booked: number;
    attended: number;
    noShow: number;
    cancelled: number;
    attendance: number | null;
  }[];
}

const rateShown = (rate: number | null) => (rate == null ? "Not yet" : `${Math.round(rate * 100)}%`);
const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });
const SHORT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

function useLoad<T>(path: string): { found: T | null; failed: boolean } {
  const [found, setFound] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api<T>(path)
      .then((data) => live && setFound(data))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [path]);
  return { found, failed };
}

function sent(c: Channel & { bounced?: number }) {
  return { ok: c.delivered, bad: c.failed + (c.bounced ?? 0), all: c.attempted };
}

export function AdminOverview() {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me : null;
  const staff = useLoad<StaffFacets>("/admin/staff?limit=1");
  const delivery = useLoad<Delivery>("/messages/delivery?days=7");
  const capacity = useLoad<Capacity>("/capacity");
  const report = useLoad<HospitalReport>("/reports");
  const [metricView, setMetricView] = useState<"delivery" | "visits" | "units">("delivery");
  const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const audit = useLoad<{ entries: AuditEntry[] }>(`/audit?kind=WRITE&from=${from}&to=${today}&limit=40`);
  // Seen once this session, "/console" is the schedule again (StaffShell).
  useEffect(() => {
    try {
      sessionStorage.setItem("atria.overview", "1");
    } catch {
      // Without storage the administrator simply lands here each time.
    }
  }, []);

  if (me && roleOf(me) !== "TENANT_ADMIN") return <Navigate to="/console" replace />;

  const status = staff.found?.facets.status ?? {};
  const email = delivery.found ? sent(delivery.found.totals.email) : null;
  const sms = delivery.found ? sent(delivery.found.totals.sms) : null;
  const rate = email && sms && email.all + sms.all ? (email.ok + sms.ok) / (email.all + sms.all) : null;
  const attention = email && sms ? email.bad + sms.bad : null;

  const tiles: { label: string; value: string; tone: string; icon: ComponentType<{ size?: number }> }[] = [
    { label: "Console accounts", value: staff.found ? String(staff.found.total) : "-", tone: "overview-violet", icon: User },
    { label: "Awaiting first sign-in", value: staff.found ? String(status.awaiting ?? 0) : "-", tone: "overview-amber", icon: Clock },
    { label: "Delivered, last 7 days", value: rate === null ? "-" : `${(rate * 100).toFixed(1)}%`, tone: "overview-green", icon: Check },
    { label: "Messages need attention", value: attention === null ? "-" : String(attention), tone: "overview-red", icon: Alert },
  ];

  return (
    <div className="accounts-page admin-overview">
      <header className="accounts-top">
        <div>
          <h1>Overview</h1>
          <p>{clock.long(new Date().toISOString())} · everything below is scoped to this institution</p>
        </div>
        <span className="overview-tenant">
          <Building size={19} />
          <span>
            <span className="overview-tenant-label">TENANT</span>
            <span className="overview-tenant-name">{TENANT.name}</span>
          </span>
        </span>
      </header>

      <section className="overview-kpis" aria-label="In numbers">
        {tiles.map(({ label, value, tone, icon: IconComponent }, i) => (
          <div key={label} className="glass overview-kpi" style={{ "--i": i } as CSSProperties}>
            <span className={`overview-kpi-icon ${tone}`} aria-hidden="true">
              <IconComponent size={20} />
            </span>
            <span className="overview-kpi-text">
              <span className="overview-kpi-value">{value}</span>
              <span className="overview-kpi-label">{label}</span>
            </span>
          </div>
        ))}
      </section>

      <div className="overview-cols">
        <section className="glass overview-card" aria-label="Delivery and capacity">
          <div className="overview-hrow">
            <div className="overview-segmented-control" role="tablist" aria-label="Metrics view">
              <button
                type="button"
                role="tab"
                aria-selected={metricView === "delivery"}
                className={`overview-segment-btn ${metricView === "delivery" ? "active" : ""}`}
                onClick={() => setMetricView("delivery")}
              >
                Message delivery
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={metricView === "visits"}
                className={`overview-segment-btn ${metricView === "visits" ? "active" : ""}`}
                onClick={() => setMetricView("visits")}
              >
                Patient visits
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={metricView === "units"}
                className={`overview-segment-btn ${metricView === "units" ? "active" : ""}`}
                onClick={() => setMetricView("units")}
              >
                Unit volume
              </button>
            </div>
            <span>
              {metricView === "delivery"
                ? email && sms ? `${email.all + sms.all} sent` : ""
                : metricView === "visits"
                  ? report.found ? `${report.found.booked} visits recorded` : ""
                  : report.found?.units ? `${report.found.units.length} units active` : ""}
            </span>
          </div>

          {metricView === "delivery" && (
            <>
              {delivery.failed ? (
                <p className="overview-empty">The delivery figures could not be loaded.</p>
              ) : !delivery.found ? (
                <LoadingPane className="compact" label="Loading delivery" />
              ) : (
                <DeliveryChart days={delivery.found.days} />
              )}
              {attention ? (
                <div className="overview-alert" role="note">
                  <Alert size={18} />
                  <p>
                    <strong>
                      {attention} {attention === 1 ? "message" : "messages"} did not arrive this week.
                    </strong>{" "}
                    The visits are still booked, so a receptionist should phone those patients.{" "}
                    <Link to="/console/messages">See which</Link>
                  </p>
                </div>
              ) : null}
            </>
          )}

          {metricView === "visits" && (
            <div className="overview-expressive-card">
              {report.failed ? (
                <p className="overview-empty">The visit figures could not be loaded.</p>
              ) : !report.found ? (
                <LoadingPane className="compact" label="Loading visits" />
              ) : (
                <DonutChart
                  title="How visits ended"
                  subtitle="Attended, missed or cancelled, as a share of this week's visits."
                  segments={[
                    {
                      id: "attended",
                      label: "Attended",
                      value: report.found.attended,
                      color: "#10b981",
                    },
                    {
                      id: "noshow",
                      label: "No-show",
                      value: report.found.noShow,
                      color: "#f43f5e",
                    },
                    {
                      id: "cancelled",
                      label: "Cancelled",
                      value: report.found.cancelled + report.found.lateCancelled,
                      color: "#f59e0b",
                    },
                  ]}
                  // Attended of those due to come, as Reports shows it: dividing
                  // by every booking counted the cancelled too, so the two
                  // pages disagreed (audit 2026-10-05).
                  centerValue={rateShown(attendanceOf(report.found))}
                  centerSub="Attendance"
                  size={230}
                />
              )}
            </div>
          )}

          {metricView === "units" && (
            <div className="overview-expressive-card">
              {report.failed ? (
                <p className="overview-empty">The unit volume could not be loaded.</p>
              ) : !report.found || !report.found.units ? (
                <LoadingPane className="compact" label="Loading unit volume" />
              ) : (
                <MultiUnitBarChart
                  title="Volume by unit"
                  subtitle="Visits and attendance at each unit."
                  units={report.found.units.map((u) => ({
                    unitId: u.clinicId,
                    name: u.clinicName || u.clinicId,
                    attended: u.attended,
                    noShow: u.noShow,
                    cancelled: u.cancelled,
                    total: u.booked,
                    rate: u.attendance,
                  }))}
                />
              )}
            </div>
          )}

          <div className="overview-hrow">
            <h2>Capacity next week</h2>
            <span>{capacity.found ? `${capacity.found.cliniciansOnShift} clinicians on shift` : ""}</span>
          </div>
          {capacity.failed ? (
            <p className="overview-empty">The week's cover could not be loaded.</p>
          ) : !capacity.found ? (
            <LoadingPane className="compact" label="Loading the week" />
          ) : (
            <CapacityList found={capacity.found} />
          )}
        </section>

        <section className="glass overview-card overview-side" aria-label="Quick actions and activity">
          <h2>Quick actions</h2>
          <div className="overview-quick">
            {(
              [
                ["/console/staff?create=1", "Create account", "Staff or admin", Plus, "overview-violet"],
                ["/console/messages", "Messaging", "Senders and health", Mail, "overview-blue"],
                ["/console/settings", "Hospital settings", "Units, visit types, fees", Sliders, "overview-green"],
                ["/console/audit", "Audit log", "Who changed what", Shield, "overview-grey"],
              ] as const
            ).map(([to, title, sub, IconComponent, tone]) => (
              <Link key={to} to={to} className="overview-q">
                <span className={`overview-q-icon ${tone}`} aria-hidden="true">
                  <IconComponent size={18} />
                </span>
                <span className="overview-q-title">{title}</span>
                <span className="overview-q-sub">{sub}</span>
              </Link>
            ))}
          </div>

          <div className="overview-hrow">
            <h2>Recent admin activity</h2>
            <Link to="/console/audit">See all</Link>
          </div>
          {audit.failed ? (
            <p className="overview-empty">The activity could not be loaded.</p>
          ) : !audit.found ? (
            <LoadingPane className="compact" label="Loading activity" />
          ) : (
            <Activity entries={audit.found.entries.filter((e) => e.actorRole === "TENANT_ADMIN").slice(0, 5)} />
          )}
        </section>
      </div>
    </div>
  );
}

function DeliveryChart({ days }: { days: Delivery["days"] }) {
  const rows = days.slice(-7).map((d) => {
    const e = sent(d.email);
    const s = sent(d.sms);
    return { day: d.day, ok: e.ok + s.ok, bad: e.bad + s.bad };
  });
  const top = Math.max(1, ...rows.map((r) => r.ok + r.bad));
  return (
    <figure className="overview-chart">
      <div className="overview-plot" role="img" aria-label={rows.map((r) => `${DAY.format(new Date(`${r.day}T12:00:00Z`))}: ${r.ok} delivered, ${r.bad} failed`).join("; ")}>
        {rows.map((r, i) => (
          <div key={r.day} className="overview-bar" style={{ "--i": i } as CSSProperties}>
            {r.bad > 0 && <span className="overview-bar-bad" style={{ height: `${Math.min(96, Math.max(4, (r.bad / top) * 100))}%` }} />}
            <span className="overview-bar-ok" style={{ height: `${Math.min(r.bad > 0 ? 96 : 100, (r.ok / top) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="overview-x" aria-hidden="true">
        {rows.map((r) => (
          <span key={r.day}>{DAY.format(new Date(`${r.day}T12:00:00Z`))}</span>
        ))}
      </div>
      <figcaption className="overview-legend">
        <span>
          <i className="overview-swatch-ok" /> Delivered
        </span>
        <span>
          <i className="overview-swatch-bad" /> Failed
        </span>
        <span className="overview-legend-note">Confirmations, cancellations and reminders combined</span>
      </figcaption>
    </figure>
  );
}

function CapacityList({ found }: { found: Capacity }) {
  const rows = [
    ...found.leave.map((l) => ({
      key: `leave-${l.clinicianProfileId}-${l.from}`,
      tone: "overview-red",
      icon: Calendar,
      title: `Dr ${l.clinicianName} away, ${l.from === l.to ? SHORT.format(new Date(`${l.from}T12:00:00Z`)) : `${SHORT.format(new Date(`${l.from}T12:00:00Z`))} to ${SHORT.format(new Date(`${l.to}T12:00:00Z`))}`}`,
      sub: `${l.clinicName} · ${l.booked ? `${l.booked} ${l.booked === 1 ? "visit" : "visits"} already booked inside that time` : "nothing booked inside that time"}`,
      figure: String(l.booked),
      ink: "overview-ink-red",
    })),
    ...found.uncovered.map((u) => ({
      key: `gap-${u.clinicId}`,
      tone: "overview-amber",
      icon: Clock,
      title: `${u.clinicName} has no cover on ${u.days.join(", ")}`,
      sub: "Open, but no clinician of the unit works those days",
      figure: "0",
      ink: "overview-ink-amber",
    })),
    ...found.covered.slice(0, 3).map((c) => ({
      key: `ok-${c.clinicId}`,
      tone: "overview-green",
      icon: Check,
      title: `${c.clinicName} fully covered`,
      sub: `${c.clinicians} ${c.clinicians === 1 ? "clinician" : "clinicians"}, ${c.freeHours} hours still free`,
      figure: String(c.freeHours),
      ink: "overview-ink-green",
    })),
  ].slice(0, 5);
  if (!rows.length) return <p className="overview-empty">No clinicians are rostered for that week yet.</p>;
  return (
    <ul className="overview-gaps">
      {rows.map(({ key, tone, icon: IconComponent, title, sub, figure, ink }, i) => (
        <li key={key} style={{ "--i": i } as CSSProperties}>
          <span className={`overview-gap-icon ${tone}`} aria-hidden="true">
            <IconComponent size={18} />
          </span>
          <span className="overview-gap-text">
            <span className="overview-gap-title">{title}</span>
            <span className="overview-gap-sub">{sub}</span>
          </span>
          <span className={`overview-gap-figure ${ink}`}>{figure}</span>
        </li>
      ))}
    </ul>
  );
}

function Activity({ entries }: { entries: AuditEntry[] }) {
  if (!entries.length) return <p className="overview-empty">No administrator has changed anything in the last 30 days.</p>;
  return (
    <ul className="overview-activity">
      {entries.map((e, i) => {
        const [given, family] = e.actorName.split(" ");
        return (
          <li key={e.auditEntryId} style={{ "--i": i } as CSSProperties}>
            <span className="overview-avatar" aria-hidden="true">
              {initials(given, family) || "A"}
            </span>
            <span className="overview-act-text">
              <span className="overview-act-what">{ACTION_LABEL[e.action] ?? e.action}</span>
              <span className="overview-act-when">
                {e.actorName} · {clock.day(e.occurredAt)}, {clock.time(e.occurredAt)}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
