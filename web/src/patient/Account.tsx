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

import { type ComponentType, useEffect, useState } from "react";

import { useSession } from "../auth/session";
import { SignOutMenu } from "../components/SignOutMenu";
import { Notice } from "../components/controls";
import { Bell, Calendar, CheckMark, ChevronLeft, ChevronRight, Close, Globe, Mail, Phone, Pin, Shield, User } from "../components/icons";
import { EditDetails, type Editing, shownDate } from "./EditDetails";
import { DeleteAccountDialog } from "../components/DeleteAccountDialog";
import { api } from "../api/client";
import { type PushState, pushState, turnPushOff, turnPushOn } from "../api/push";
import { HospitalUnits } from "./HospitalUnits";
import { LoadingPane } from "../components/LoadingPane";
import { useTier } from "../layout/fit";
import { clock, join, languageName, past, upcoming, usePatientData } from "./data";
import { TENANT } from "../tenant";

type Section = "details" | "notifications" | "clinics";

const SECTIONS: { id: Section; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: "details", label: "Personal details", icon: User },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "clinics", label: "Units", icon: Pin },
];


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
  // On a phone (Mobile · Account, 41:2) the sections are a menu, each opening
  // on its own; wider, the chosen one sits beside the list.
  const phone = useTier() === "mobile";
  const [opened, setOpened] = useState(false);
  const me = session.status === "signed-in" ? session.me : undefined;
  const [editing, setEditing] = useState<Editing>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const start = (what: Exclude<Editing, null>) => {
    setSaid(null);
    setEditing(what);
  };
  const data = state.status === "ready" ? state.data : undefined;
  const name = [me?.givenName, me?.familyName].filter(Boolean).join(" ") || "Your account";
  const index = SECTIONS.findIndex((s) => s.id === section);

  return (
    <div className="find-care account" data-step={phone ? (opened ? "detail" : "list") : undefined}>
      <section className="find-list glass account-list" aria-label="Account">
        {phone && <h1 className="phone-title">Account</h1>}
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
          {phone && data && (
            <dl className="profile-stats">
              <div>
                <dt>Upcoming</dt>
                <dd>{upcoming(data.appointments).length}</dd>
              </div>
              <div>
                <dt>Completed</dt>
                <dd>{past(data.appointments).filter((a) => ["COMPLETED", "AWAITING_FEEDBACK"].includes(a.state)).length}</dd>
              </div>
              <div>
                <dt>Units</dt>
                <dd>{data.clinics.length}</dd>
              </div>
            </dl>
          )}
        </div>
        <nav className="account-nav" aria-label="Account sections">
          <span className="side-pill account-pill" aria-hidden="true" style={{ transform: `translateY(calc(${index} * 52px))` }} />
          {SECTIONS.map(({ id, label, icon: IconComponent }) => (
            <button
              key={id}
              type="button"
              className={`side-item${section === id ? " active" : ""}`}
              aria-current={section === id ? "true" : undefined}
              onClick={() => {
                setSection(id);
                setOpened(true);
              }}
            >
              <IconComponent size={17} />
              <span>{label}</span>
              <span className="account-hint">
                {id === "notifications" ? "24h" : id === "clinics" ? data?.clinics.length ?? "" : ""}
              </span>
              {phone && <ChevronRight size={16} />}
            </button>
          ))}
        </nav>
        <SignOutMenu className="outline-danger sign-out">Sign out</SignOutMenu>
      </section>

      <section className="find-detail glass account-detail" aria-labelledby="section-title" key={section}>
        <div className="phone-bar">
          <button type="button" className="square-button" aria-label="Back to your account" onClick={() => setOpened(false)}>
            <ChevronLeft size={18} />
          </button>
          <span>Account</span>
        </div>
        {section === "details" && (
          <>
            <header className="section-head">
              <h1 id="section-title">Personal details</h1>
              <p>What Atria holds about you. Change your name, mobile, date of birth and language here; your email is how you sign in, and the front desk at {TENANT.name} can help with it.</p>
            </header>
            {said && <Notice tone="success">{said}</Notice>}
            {editing ? (
              <EditDetails
                editing={editing}
                onDone={(message) => {
                  setEditing(null);
                  setSaid(message);
                }}
              />
            ) : null}
            <div className="inner-card settings-card">
              <Row icon={User} tone="tone-blue" title="Name" sub={name} end={<EditLink label="Change your name" onClick={() => start("name")} />} />
              <Row icon={Mail} tone="tone-green" title="Email" sub={me?.email ?? "Not given"} />
              <Row
                icon={Globe}
                tone="tone-blue"
                title="Language"
                sub={languageName(me?.languages?.[0] ?? "en")}
                end={<EditLink label="Change your language" onClick={() => start("language")} />}
              />
              <Row
                icon={Phone}
                tone="tone-amber"
                title="Mobile"
                sub={me?.phoneVerified ? masked(me?.phoneE164) : `${masked(me?.phoneE164)} · not verified yet`}
                end={
                  // A verified number changes by a code sent to it, which comes with SMS.
                  me?.phoneVerified ? (
                    <span className="chip chip-confirmed">Verified</span>
                  ) : (
                    <EditLink label="Change your mobile" onClick={() => start("phone")} />
                  )
                }
              />
              <Row
                icon={Calendar}
                tone="tone-blue"
                title="Date of birth"
                sub={shownDate(me?.dateOfBirth) || "Not given"}
                end={<EditLink label="Change your date of birth" onClick={() => start("born")} />}
              />
              <Row icon={Shield} tone="tone-violet" title="Who can see your record" sub="Only your healthcare institution, and you" />
            </div>
            <div className="inner-card settings-card delete-row">
              <Row
                icon={Close}
                tone="tone-red"
                title="Delete your account"
                sub="Your upcoming visits are cancelled. You have 30 days to change your mind."
                end={
                  <button type="button" className="link-button link-danger" onClick={() => setDeleting(true)}>
                    Delete
                  </button>
                }
              />
            </div>
            {deleting && (
              <DeleteAccountDialog
                title="Delete your Atria account?"
                lede={`You will be signed out, and ${TENANT.name} stops holding your appointments.`}
                points={[
                  "Your upcoming visits are cancelled and their times given back.",
                  "Sign in again within 30 days to restore your account.",
                  "After 30 days your details are erased for good.",
                ]}
                confirmLabel="Delete my account"
                onClose={() => setDeleting(false)}
                onConfirm={async () => {
                  await api("/me", { method: "DELETE" });
                  await signOut();
                }}
              />
            )}
          </>
        )}

        {section === "notifications" && <Notifications />}

        {section === "clinics" && (
          <>
            <header className="section-head">
              <h1 id="section-title">Units</h1>
              <p>The units of {TENANT.name} you can book: where each one is, its hours, and the way to its door.</p>
            </header>
            {data ? <HospitalUnits clinics={data.clinics} hospital={TENANT.name} /> : <LoadingPane label="Loading the units" />}
          </>
        )}
      </section>
    </div>
  );
}

function EditLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="link-button" aria-label={label} onClick={onClick}>
      Change
    </button>
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
      : reminderText("26/09/2026", "10:00", "Paediatrics Unit", "Esther Mbarga", "APT-4958");

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
        <PushRow />
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

const PUSH_SUB: Record<PushState, string> = {
  on: "Every notice also appears on this device",
  off: "Get every notice on this device as well",
  blocked: "Blocked in this browser's site settings",
  unsupported: "This browser cannot show notifications",
};

/** Notifications on this browser, beside SMS and email, never instead of them. */
function PushRow() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    pushState().then(setState, () => setState("unsupported"));
  }, []);
  const change = async () => {
    setBusy(true);
    setFailed(null);
    try {
      setState(await (state === "on" ? turnPushOff() : turnPushOn()));
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const can = state === "on" || state === "off";
  return (
    <>
      <Row
        icon={Bell}
        tone="tone-blue"
        title="Notifications on this device"
        sub={state ? PUSH_SUB[state] : "Checking this browser"}
        end={
          can ? (
            <button type="button" className="link-button" disabled={busy} onClick={change}>
              {state === "on" ? "Turn off" : "Turn on"}
            </button>
          ) : undefined
        }
      />
      {failed && <Notice tone="error">{failed}</Notice>}
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
