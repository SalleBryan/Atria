/**
 * Messages: what went out, and what became of it (FR-MSG-05, FR-MSG-06).
 *
 * The unit's log for one day, failed messages first, each naming the patient
 * and the number on file now, so the desk can phone the ones a reminder did
 * not reach. The front desk and a unit manager read their own unit's; an
 * administrator picks the unit, and also has the delivery figures: the
 * sender identities and whether email and SMS are still in their sandboxes,
 * then delivery, bounce and complaint rates and SMS spend per day.
 *
 * Built from the console's parts: the Staff accounts header, card and rows,
 * the audit log's tabs and pager, the report's tiles and day stepper, the
 * platform's picker and status chips.
 */

import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { api } from "../api/client";
import { useSession } from "../auth/session";
import { Notice } from "../components/controls";
import { LoadingRow } from "../components/LoadingPane";
import { ChevronLeft, ChevronRight, Mail, Phone, Shield } from "../components/icons";
import { LoadingPane } from "../components/LoadingPane";
import { PAGE_ROWS, Pager, usePages } from "../components/Pager";
import { SelectMenu } from "../components/Pickers";
import { roleOf, useStaffData } from "./data";
import { sentence } from "./labels";
import { UsageStatement } from "./UsageStatement";
import { plainReason } from "../utils/messageReason";

export interface LoggedMessage {
  messageLogId: string;
  appointmentId: string;
  /** The unit it went out for; named when every unit is listed. */
  clinicId?: string | null;
  clinicName?: string | null;
  kind: string;
  channel: "EMAIL" | "SMS";
  recipient: string | null;
  deliveryState: "SENT" | "DELIVERED" | "FAILED" | "CANCELLED";
  feedback: "BOUNCE" | "COMPLAINT" | null;
  failureReason: string | null;
  settledAt: string;
  person: { name: string | null; phoneE164: string | null };
  visit: { startAt: string | null; state: string | null; patientProfileId: string | null } | null;
}

interface UnitLog {
  clinicId: string | null;
  clinicName: string | null;
  day: string;
  counts: Record<string, number>;
  messages: LoggedMessage[];
}

interface Figures {
  email: {
    attempted: number;
    delivered: number;
    failed: number;
    bounced: number;
    complained: number;
    deliveryRate: number | null;
    bounceRate: number | null;
    complaintRate: number | null;
  };
  sms: { attempted: number; delivered: number; failed: number; deliveryRate: number | null; spendUsd: string };
}

interface Delivery {
  from: string;
  to: string;
  senders: { identity: string; type: string; verified: boolean; sendingEnabled: boolean; sandbox: boolean }[] | null;
  sms: { sandbox: boolean } | null;
  totals: Figures;
  days: (Figures & { day: string })[];
}

export const KIND_LABEL: Record<string, string> = {
  BOOKING_CONFIRMATION: "Booking confirmed",
  BOOKING_CANCELLATION: "Visit cancelled",
  APPOINTMENT_REMINDER: "Reminder",
  BOOKING_RESCHEDULED: "Visit moved",
  BOOKING_DISRUPTED: "Visit disrupted",
  QUEUE_MOVED: "Queue moved",
  EARLY_CALL_INVITE: "Come earlier",
  BOOKING_DECLINED: "Request declined",
  TICKET_CONFIRMATION: "Queue ticket",
};

const STATE: Record<LoggedMessage["deliveryState"], { label: string; tone: string }> = {
  FAILED: { label: "Failed", tone: "chip-cancelled" },
  DELIVERED: { label: "Delivered", tone: "chip-confirmed" },
  SENT: { label: "Sent", tone: "chip-booked" },
  CANCELLED: { label: "Not sent", tone: "chip-neutral" },
};

const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const visitTime = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const dayName = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const shortDay = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const percent = (rate: number | null) => (rate == null ? "None sent" : `${Math.round(rate * 1000) / 10}%`);

/**
 * Spend in US dollars and cents: AWS bills texts in dollars, in fractions of
 * a cent. Written "US$" so it never reads as the hospital's francs.
 */
export function dollars(amount: string): string {
  const value = Number(amount);
  if (!value) return "US$0.00";
  return value < 0.01 ? "Under US$0.01" : `US$${value.toFixed(2)}`;
}

/** The unit picker's first choice for an administrator: every unit at once. */
const ALL_UNITS = "all";

function localToday(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function shift(day: string, days: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

export function Messages() {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me : undefined;
  const role = me ? roleOf(me) : "CLINICIAN";
  const [view, setView] = useState<"log" | "delivery" | "usage">("log");
  const [days, setDays] = useState("14");

  if (state.status !== "signed-in") return null;
  if (role !== "TENANT_ADMIN" && role !== "CLINIC_MANAGER" && role !== "RECEPTIONIST") return <Navigate to="/console" replace />;
  const admin = role === "TENANT_ADMIN";

  const tabs = admin && (
    <div className="segmented settings-tabs" role="tablist" aria-label="Messages">
      {(
        [
          ["log", "Unit log"],
          ["delivery", "Delivery"],
          ["usage", "Usage"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={view === id}
          className={`segment${view === id ? " segment-on" : ""}`}
          onClick={() => setView(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (view === "usage" && admin) {
    return (
      <div className="accounts-page messages-page">
        <header className="accounts-top">
          <div>
            <h1>Messages</h1>
            <p>How many messages went out each month, and what became of them.</p>
          </div>
        </header>
        {tabs}
        <UsageStatement />
      </div>
    );
  }

  return view === "delivery" && admin ? (
    <div className="accounts-page messages-page">
      <header className="accounts-top">
        <div>
          <h1>Messages</h1>
          <p>How reliably email and SMS reach patients, as the providers report it.</p>
        </div>
        <SelectMenu
          label="Period"
          value={days}
          width={220}
          options={[
            { id: "7", label: "Last 7 days" },
            { id: "14", label: "Last 14 days" },
            { id: "30", label: "Last 30 days" },
          ]}
          onChange={setDays}
        />
      </header>
      {tabs}
      <DeliveryFigures days={days} />
    </div>
  ) : (
    <UnitMessages admin={admin} clinicId={me?.clinicId ?? ""} tabs={tabs || null} />
  );
}

function UnitMessages({ admin, clinicId, tabs }: { admin: boolean; clinicId: string; tabs: ReactNode }) {
  const { state: directory } = useStaffData();
  const clinics = directory.status === "ready" ? directory.data.clinics : [];
  const today = localToday();
  // An administrator opens on every unit and can pick one; the desk and a
  // unit manager read their own.
  const [unit, setUnit] = useState(admin ? ALL_UNITS : clinicId);
  const [day, setDay] = useState(today);
  const [found, setFound] = useState<UnitLog | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const pages = usePages(found?.messages ?? [], PAGE_ROWS, `${unit}/${day}`);

  useEffect(() => {
    if (!unit) return;
    let live = true;
    setFound(null);
    api<UnitLog>(unit === ALL_UNITS ? `/messages?day=${day}` : `/clinics/${encodeURIComponent(unit)}/messages?day=${day}`)
      .then((data) => {
        if (!live) return;
        setFound(data);
        setFailure(null);
      })
      .catch((error: unknown) => live && setFailure(error instanceof Error ? sentence(error.message) : "The log could not be loaded."));
    return () => {
      live = false;
    };
  }, [unit, day]);

  const failed = found?.counts.FAILED ?? 0;
  const every = unit === ALL_UNITS;
  const name = every ? "All units" : (clinics.find((c) => c.clinicId === unit)?.name ?? found?.clinicName ?? "Your unit");

  return (
    <div className="accounts-page messages-page">
      <header className="accounts-top">
        <div>
          <h1>Messages</h1>
          <p>{name} · what went out, failures first so the desk can phone those patients</p>
        </div>
        <div className="reports-controls">
          {admin && (
            <SelectMenu
              label="Unit"
              value={unit}
              width={300}
              options={[{ id: ALL_UNITS, label: "All units" }, ...clinics.map((c) => ({ id: c.clinicId, label: c.name }))]}
              onChange={setUnit}
            />
          )}
          <div className="changes-week">
            <button type="button" className="square-button" aria-label="Previous day" onClick={() => setDay(shift(day, -1))}>
              <ChevronLeft size={16} />
            </button>
            {/* One width for every day, so stepping back never moves the controls. */}
            <span className="day-step-label">{day === today ? "Today" : dayName.format(new Date(`${day}T12:00:00Z`))}</span>
            <button
              type="button"
              className="square-button"
              aria-label="Next day"
              disabled={day >= today}
              onClick={() => setDay(shift(day, 1))}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </header>
      {tabs}

      {failure && <Notice tone="error">{failure}</Notice>}
      {found && failed > 0 && (
        <p className="accounts-banner messages-banner">
          <Phone size={18} />
          {failed === 1 ? "1 message" : `${failed} messages`} did not reach the patient. Their numbers are below; a call makes sure they
          know.
        </p>
      )}

      <section className="glass accounts-card" aria-label="Messages sent" aria-busy={!found || undefined}>
        <div className="accounts-head messages-head" aria-hidden="true">
          <span>PATIENT</span>
          <span>MESSAGE</span>
          <span>VISIT</span>
          <span>STATUS</span>
        </div>
        <ul className="accounts-rows">
          {!found
            ? [<LoadingRow key="loading" />]
            : pages.shown.map((m, index) => <MessageRow key={m.messageLogId} message={m} index={index} unit={every} />)}
          {found && !found.messages.length && (
            <li className="today-empty">
              {every ? "Nothing went out from any unit on this day." : "Nothing went out for this unit on this day."}
            </li>
          )}
        </ul>
        <Pager
          noun="messages"
          first={pages.first}
          last={pages.last}
          total={pages.total}
          page={pages.page}
          pages={pages.pages}
          busy={!found}
          onPrevious={pages.previous}
          onNext={pages.next}
        />
      </section>
    </div>
  );
}

function MessageRow({ message: m, index, unit = false }: { message: LoggedMessage; index: number; unit?: boolean }) {
  const shown = STATE[m.deliveryState] ?? STATE.SENT;
  const why = m.feedback === "BOUNCE" ? "Bounced" : m.feedback === "COMPLAINT" ? "Marked as spam" : plainReason(m.failureReason, m.channel);
  const Channel = m.channel === "SMS" ? Phone : Mail;
  return (
    <li
      className={`account-row message-row${m.deliveryState === "FAILED" ? " message-row-failed" : ""}`}
      style={{ "--i": index } as CSSProperties}
    >
      <span className="account-text">
        <span className="account-name">{m.person.name ?? "Unknown patient"}</span>
        {m.person.phoneE164 ? (
          <a className="account-sub message-phone" href={`tel:${m.person.phoneE164}`}>
            {m.person.phoneE164}
          </a>
        ) : (
          <span className="account-sub">No phone on file</span>
        )}
      </span>
      <span className="account-text">
        <span className="account-name message-kind">
          <Channel size={15} />
          {KIND_LABEL[m.kind] ?? m.kind}
        </span>
        <span className="account-sub">
          {[m.channel === "SMS" ? "SMS" : "Email", time.format(new Date(m.settledAt)), unit ? m.clinicName : null]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <span className="account-role">
        {m.visit?.startAt ? (
          <Link className="message-visit" to={`/console/visits/${encodeURIComponent(m.appointmentId)}`}>
            {visitTime.format(new Date(m.visit.startAt))}
          </Link>
        ) : (
          "No visit"
        )}
      </span>
      <span className="message-status">
        <span className={`chip ${shown.tone}`}>{shown.label}</span>
        {why && (m.deliveryState !== "DELIVERED" || m.feedback === "COMPLAINT") && (
          <span className="account-sub message-why" title={m.failureReason ?? undefined}>
            {why}
          </span>
        )}
      </span>
    </li>
  );
}

function DeliveryFigures({ days }: { days: string }) {
  const [found, setFound] = useState<Delivery | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setFound(null);
    api<Delivery>(`/messages/delivery?days=${days}`)
      .then((data) => {
        if (!live) return;
        setFound(data);
        setFailure(null);
      })
      .catch((error: unknown) => live && setFailure(error instanceof Error ? sentence(error.message) : "The figures could not be loaded."));
    return () => {
      live = false;
    };
  }, [days]);

  if (failure) return <Notice tone="error">{failure}</Notice>;
  if (!found) return <LoadingPane label="Loading the figures" />;
  const { email, sms } = found.totals;

  return (
    <>
      <section className="reports-tiles" aria-label="Delivery in numbers">
        {(
          [
            ["Email delivered", percent(email.deliveryRate)],
            ["Bounce rate", percent(email.bounceRate)],
            ["Complaint rate", percent(email.complaintRate)],
            ["SMS delivered", percent(sms.deliveryRate)],
            ["SMS spend, billed by AWS", dollars(sms.spendUsd)],
          ] as const
        ).map(([label, value], index) => (
          <div key={label} className="glass reports-tile" style={{ "--i": index } as CSSProperties}>
            <span className="reports-tile-label">{label}</span>
            <span className="reports-tile-value">{value}</span>
          </div>
        ))}
        <div className="glass reports-tile reports-tile-accent" style={{ "--i": 5 } as CSSProperties}>
          <span className="reports-tile-label">Messages</span>
          <span className="reports-tile-value">{email.attempted + sms.attempted}</span>
        </div>
      </section>

      <div className="messages-cols">
        <section className="glass availability-card" aria-labelledby="senders-title">
          <h2 id="senders-title">Senders</h2>
          {found.senders == null ? (
            <p className="today-empty">SES could not be asked just now.</p>
          ) : (
            <dl className="reports-list">
              {found.senders.map((s) => (
                <div key={s.identity}>
                  <dt>{s.identity}</dt>
                  <dd>{s.verified ? (s.sendingEnabled ? "Verified" : "Verified, paused") : "Not verified"}</dd>
                </div>
              ))}
              <div>
                <dt>Email</dt>
                <dd>{found.senders.some((s) => s.sandbox) ? "Sandbox: verified addresses only" : "Production"}</dd>
              </div>
              <div>
                <dt>SMS</dt>
                <dd>{found.sms == null ? "Unknown" : found.sms.sandbox ? "Sandbox: verified numbers only" : "Production"}</dd>
              </div>
            </dl>
          )}
          <p className="accounts-banner reports-banner">
            <Shield size={16} />
            Rates count what the providers reported. A message still marked sent has had no report yet.
          </p>
        </section>

        <ByDay days={found.days} />
      </div>
    </>
  );
}

function ByDay({ days }: { days: Delivery["days"] }) {
  const latestFirst = [...days].reverse();
  const pages = usePages(latestFirst, PAGE_ROWS, days[0]?.day ?? "");
  return (
    <section className="glass accounts-card" aria-label="By day">
      <div className="accounts-head messages-days-head" aria-hidden="true">
        <span>DAY</span>
        <span>EMAIL</span>
        <span>DELIVERED</span>
        <span>BOUNCED</span>
        <span>SMS</span>
        <span>SPEND</span>
      </div>
      <ul className="accounts-rows">
        {pages.shown.map((d, index) => (
          <li key={d.day} className="account-row messages-day-row" style={{ "--i": index } as CSSProperties}>
            <span className="account-name">{shortDay.format(new Date(`${d.day}T12:00:00Z`))}</span>
            <span>{d.email.attempted}</span>
            <span>{percent(d.email.deliveryRate)}</span>
            <span>{d.email.bounced}</span>
            <span>
              {d.sms.delivered} of {d.sms.attempted}
            </span>
            <span>{dollars(d.sms.spendUsd)}</span>
          </li>
        ))}
      </ul>
      <Pager
        noun="days"
        first={pages.first}
        last={pages.last}
        total={pages.total}
        page={pages.page}
        pages={pages.pages}
        onPrevious={pages.previous}
        onNext={pages.next}
      />
    </section>
  );
}
