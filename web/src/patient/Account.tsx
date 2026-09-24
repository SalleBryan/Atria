/**
 * "Desktop · Account settings" (152:2), as Phase 1 has it.
 *
 * The frame is mostly settings a patient chooses: which channels reach them,
 * how long before a visit the reminder comes, quiet hours. Those are
 * preferences (FR-ACC /me/preferences), which arrive in Phase 2, so here the
 * same sections state what Atria does today, truthfully, rather than showing
 * switches that would change nothing: every booking is confirmed by email,
 * and a text comes 24 hours before, in the words the reminder really uses.
 */

import { type ComponentType, useState } from "react";

import { useSession } from "../auth/session";
import { Bell, Calendar, CheckMark, Mail, Phone, Pin, Shield, User } from "../components/icons";
import { clock, join, upcoming, usePatientData } from "./data";

type Section = "details" | "notifications" | "clinics";

const SECTIONS: { id: Section; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: "details", label: "Personal details", icon: User },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "clinics", label: "Clinics", icon: Pin },
];

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * The SMS reminder, word for word as atria.core.notices writes it: English
 * until a patient can choose a language, the date as dd/mm/yyyy on the
 * clinic's clock, and the clinician by name without a title.
 */
function reminderText(date: string, time: string, clinic: string, clinician: string, reference: string): string {
  return `Atria reminder: appointment ${date} at ${time}, ${clinic}, ${clinician}. Ref ${reference}. To cancel: Atria app.`;
}

const SMS_DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Douala",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function masked(phone: string | null | undefined): string {
  if (!phone) return "Not given";
  return `${phone.slice(0, 4)} ${"•".repeat(Math.max(0, phone.length - 7))} ${phone.slice(-3)}`;
}

export function Account() {
  const { state: session, signOut } = useSession();
  const { state } = usePatientData();
  const [section, setSection] = useState<Section>("details");
  const me = session.status === "signed-in" ? session.me : undefined;
  const data = state.status === "ready" ? state.data : undefined;
  const name = [me?.givenName, me?.familyName].filter(Boolean).join(" ") || "Your account";
  const index = SECTIONS.findIndex((s) => s.id === section);

  return (
    <div className="find-care account">
      <section className="find-list glass account-list" aria-label="Account">
        <div className="profile-card">
          <span className="hero-bloom" aria-hidden="true" />
          <span className="hero-avatar" aria-hidden="true">
            {[me?.givenName, me?.familyName].map((n) => n?.[0] ?? "").join("") || "A"}
          </span>
          <span className="profile-text">
            <span className="profile-name">{name}</span>
            <span className="profile-email">{me?.email ?? "No email on record"}</span>
          </span>
          <span className="hero-tag">
            <CheckMark size={11} />
            PATIENT ACCOUNT
          </span>
        </div>
        <nav className="account-nav" aria-label="Account sections">
          <span className="side-pill account-pill" aria-hidden="true" style={{ transform: `translateY(calc(${index} * 52px))` }} />
          {SECTIONS.map(({ id, label, icon: IconComponent }) => (
            <button
              key={id}
              type="button"
              className={`side-item${section === id ? " active" : ""}`}
              aria-current={section === id ? "true" : undefined}
              onClick={() => setSection(id)}
            >
              <IconComponent size={17} />
              <span>{label}</span>
              <span className="account-hint">
                {id === "notifications" ? "24h" : id === "clinics" ? data?.clinics.length ?? "" : ""}
              </span>
            </button>
          ))}
        </nav>
        <button type="button" className="outline-danger sign-out" onClick={() => void signOut()}>
          Sign out
        </button>
      </section>

      <section className="find-detail glass account-detail" aria-labelledby="section-title" key={section}>
        {section === "details" && (
          <>
            <header className="section-head">
              <h1 id="section-title">Personal details</h1>
              <p>What Atria holds about you. Your clinic front desk can correct any of it.</p>
            </header>
            <div className="inner-card settings-card">
              <Row icon={User} tone="tone-blue" title="Name" sub={name} />
              <Row icon={Mail} tone="tone-green" title="Email" sub={me?.email ?? "Not given"} />
              <Row
                icon={Phone}
                tone="tone-amber"
                title="Mobile"
                sub={masked(me?.phoneE164)}
                end={
                  <span className={`chip ${me?.phoneVerified ? "chip-confirmed" : "chip-awaiting"}`}>
                    {me?.phoneVerified ? "Verified" : "Not verified yet"}
                  </span>
                }
              />
              <Row icon={Shield} tone="tone-violet" title="Who can see your record" sub="Only the clinic you book with, and you" />
            </div>
          </>
        )}

        {section === "notifications" && <Notifications />}

        {section === "clinics" && (
          <>
            <header className="section-head">
              <h1 id="section-title">Clinics</h1>
              <p>Where Atria can book you, with their opening hours on the clinic's clock.</p>
            </header>
            {data?.clinics.map((clinic) => (
              <div key={clinic.clinicId} className="inner-card settings-card clinic-hours">
                <div className="clinic-hours-head">
                  <span>
                    <span className="clinician-name">{clinic.name}</span>
                    <span className="who-sub">{clinic.address}</span>
                  </span>
                  <a
                    className="link"
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([clinic.name, clinic.address].filter(Boolean).join(", "))}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Directions
                  </a>
                </div>
                <dl className="hours">
                  {WEEKDAYS.map((day, i) => {
                    const hours = clinic.openingHours?.[String(i)];
                    return (
                      <div key={day}>
                        <dt>{day}</dt>
                        <dd>{hours ? `${hours.start} to ${hours.end}` : "Closed"}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  );
}

function Row({
  icon: IconComponent,
  tone,
  title,
  sub,
  end,
}: {
  icon: ComponentType<{ size?: number }>;
  tone: string;
  title: string;
  sub: string;
  end?: React.ReactNode;
}) {
  return (
    <div className="setting-row">
      <span className={`activity-icon ${tone}`} aria-hidden="true">
        <IconComponent size={17} />
      </span>
      <span className="setting-text">
        <span className="timeline-title">{title}</span>
        <span className="timeline-sub">{sub}</span>
      </span>
      {end}
    </div>
  );
}

function Notifications() {
  const { state } = usePatientData();
  const data = state.status === "ready" ? state.data : undefined;
  const next = data ? upcoming(data.appointments)[0] : undefined;
  const joined = data && next ? join(data, next) : undefined;
  const reminderAt = next ? new Date(Date.parse(next.startAt) - 24 * 3600 * 1000) : undefined;
  const sample =
    next && joined
      ? reminderText(
          SMS_DATE.format(new Date(next.startAt)),
          clock.time(next.startAt),
          joined.clinic?.name ?? "the clinic",
          [joined.clinician?.givenName, joined.clinician?.familyName].filter(Boolean).join(" "),
          next.reference,
        )
      : reminderText("26/09/2026", "10:00", "Clinique d'Akwa", "Esther Mbarga", "APT-4958");

  return (
    <>
      <header className="section-head">
        <h1 id="section-title">Notifications</h1>
        <p>
          How Atria reaches you. Confirmations always go to email, because they are your record of the booking. Choosing
          other channels and lead times arrives in a later release.
        </p>
      </header>
      <div className="inner-card settings-card">
        <h3>Channels</h3>
        <Row icon={Phone} tone="tone-amber" title="SMS reminders" sub="A text 24 hours before every visit" end={<On />} />
        <Row icon={Mail} tone="tone-green" title="Email confirmations" sub="Booking and cancellation receipts" end={<On />} />
        <Row icon={Calendar} tone="tone-blue" title="Short-notice bookings" sub="A confirmation text straight away instead" end={<On />} />
      </div>
      <div className="inner-card settings-card">
        <h3>Reminder timing</h3>
        <div className="lead-options" role="radiogroup" aria-label="Reminder timing">
          {[
            ["48h", "two days", false],
            ["24h", "one day", true],
            ["2h", "same day", false],
          ].map(([value, label, on]) => (
            <span key={String(value)} role="radio" aria-checked={Boolean(on)} aria-disabled={!on} className={`lead${on ? " lead-on" : ""}`}>
              <span>{value}</span>
              <span>{label}</span>
            </span>
          ))}
        </div>
        <div className="sms-preview">
          <span className="activity-icon tone-amber" aria-hidden="true">
            <Bell size={17} />
          </span>
          <span>
            <span className="sms-preview-label">
              SMS PREVIEW{reminderAt ? ` · ${clock.day(reminderAt).toUpperCase()}, ${clock.time(reminderAt)}` : ""}
            </span>
            <span className="sms-preview-text">{sample}</span>
          </span>
        </div>
      </div>
    </>
  );
}

function On() {
  return (
    <span className="chip chip-confirmed">
      On
    </span>
  );
}
