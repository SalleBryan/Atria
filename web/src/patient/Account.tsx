/**
 * "Desktop · Account settings" (152:2), as Phase 1 has it.
 *
 * The frame is mostly settings a patient chooses: which channels reach them,
 * how long before a visit the reminder comes, quiet hours. Those are
 * preferences (FR-ACC /me/preferences), which arrive in Phase 2, so here the
 * same sections state what Atria does today, truthfully, rather than showing
 * switches that would change nothing: every booking is confirmed by email,
 * and a text comes 24 hours before, in the words the reminder really uses.
 * Words follow the chosen language (NFR-L10N-01), as the notices do.
 */

import { type ComponentType, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { maskedPhone } from "../auth/phone";
import { useSession } from "../auth/session";
import { SignOutMenu } from "../components/SignOutMenu";
import { Notice } from "../components/controls";
import { Bell, Calendar, CheckMark, ChevronLeft, ChevronRight, Close, Globe, Mail, Phone, Pin, Shield, User } from "../components/icons";
import { EditDetails, type Editing, shownDateIn } from "./EditDetails";
import { OFFERED, useLanguage } from "../i18n/LanguageProvider";
import { SelectMenu } from "../components/Pickers";
import { DeleteAccountDialog } from "../components/DeleteAccountDialog";
import { api } from "../api/client";
import { type PushState, pushState, turnPushOff, turnPushOn } from "../api/push";
import { HospitalUnits } from "./HospitalUnits";
import { LoadingPane } from "../components/LoadingPane";
import { useTier } from "../layout/fit";
import { clock, join, past, upcoming, usePatientData } from "./data";
import { TENANT } from "../tenant";

type Section = "details" | "notifications" | "clinics";

const SECTIONS: { id: Section; icon: ComponentType<{ size?: number }> }[] = [
  { id: "details", icon: User },
  { id: "notifications", icon: Bell },
  { id: "clinics", icon: Pin },
];

// The SMS reminder is worded by atria.core.notices in the patient's language,
// but its date is always dd/mm/yyyy on the clinic's clock (SMS_DATE there).
const SMS_DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Douala",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function Account() {
  const { t, i18n } = useTranslation("account");
  const { language, setLanguage } = useLanguage();
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
  const name = [me?.givenName, me?.familyName].filter(Boolean).join(" ") || t("yourAccount");
  const index = SECTIONS.findIndex((s) => s.id === section);

  return (
    <div className="find-care account" data-step={phone ? (opened ? "detail" : "list") : undefined}>
      <section className="find-list glass account-list" aria-label={t("title")}>
        {phone && <h1 className="phone-title">{t("title")}</h1>}
        <div className="profile-card">
          <span className="hero-bloom" aria-hidden="true" />
          <span className="hero-avatar" aria-hidden="true">
            {[me?.givenName, me?.familyName].map((n) => n?.[0] ?? "").join("") || "A"}
          </span>
          <span className="profile-text">
            <span className="profile-name">{name}</span>
            <span className="profile-email">{me?.email ?? t("noEmailOnRecord")}</span>
          </span>
          <span className="hero-tag">
            <CheckMark size={11} />
            {t("patientTag")}
          </span>
          {phone && data && (
            <dl className="profile-stats">
              <div>
                <dt>{t("stats.upcoming")}</dt>
                <dd>{upcoming(data.appointments).length}</dd>
              </div>
              <div>
                <dt>{t("stats.completed")}</dt>
                <dd>{past(data.appointments).filter((a) => ["COMPLETED", "AWAITING_FEEDBACK"].includes(a.state)).length}</dd>
              </div>
              <div>
                <dt>{t("stats.units")}</dt>
                <dd>{data.clinics.length}</dd>
              </div>
            </dl>
          )}
        </div>
        <nav className="account-nav" aria-label={t("sectionsLabel")}>
          <span className="side-pill account-pill" aria-hidden="true" style={{ transform: `translateY(calc(${index} * 52px))` }} />
          {SECTIONS.map(({ id, icon: IconComponent }) => (
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
              <span>{t(`sections.${id}`)}</span>
              <span className="account-hint">{id === "notifications" ? "24h" : id === "clinics" ? (data?.clinics.length ?? "") : ""}</span>
              {phone && <ChevronRight size={16} />}
            </button>
          ))}
        </nav>
        <SignOutMenu className="outline-danger sign-out">{t("signOut")}</SignOutMenu>
      </section>

      <section className="find-detail glass account-detail" aria-labelledby="section-title" key={section}>
        <div className="phone-bar">
          <button type="button" className="square-button" aria-label={t("back")} onClick={() => setOpened(false)}>
            <ChevronLeft size={18} />
          </button>
          <span>{t("title")}</span>
        </div>
        {section === "details" && (
          <>
            <header className="section-head">
              <h1 id="section-title">{t("sections.details")}</h1>
              <p>{t("details.lede", { hospital: TENANT.name })}</p>
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
              <Row
                icon={User}
                tone="tone-blue"
                title={t("details.name")}
                sub={name}
                end={<EditLink label={t("details.changeName")} onClick={() => start("name")} />}
              />
              <Row icon={Mail} tone="tone-green" title={t("details.email")} sub={me?.email ?? t("details.notGiven")} />
              <Row
                icon={Phone}
                tone="tone-amber"
                title={t("details.mobile")}
                sub={me?.phoneVerified ? maskedPhone(me?.phoneE164) : t("details.notVerified", { phone: maskedPhone(me?.phoneE164) })}
                end={
                  // A verified number changes by a code sent to it, which comes with SMS.
                  me?.phoneVerified ? (
                    <span className="chip chip-confirmed">{t("details.verified")}</span>
                  ) : (
                    <EditLink label={t("details.changePhone")} onClick={() => start("phone")} />
                  )
                }
              />
              <Row
                icon={Calendar}
                tone="tone-blue"
                title={t("details.born")}
                sub={shownDateIn(me?.dateOfBirth, i18n.language) || t("details.notGiven")}
                end={<EditLink label={t("details.changeBorn")} onClick={() => start("born")} />}
              />
              <Row
                icon={Globe}
                tone="tone-green"
                title={t("details.language")}
                sub={t("details.languageSub")}
                end={
                  <SelectMenu
                    label={t("details.language")}
                    value={language}
                    options={OFFERED.map((id) => ({ id, label: t(`common:languages.${id}`) }))}
                    onChange={(id) => setLanguage(id as typeof language)}
                    width={170}
                  />
                }
              />
              <Row icon={Shield} tone="tone-violet" title={t("details.privacy")} sub={t("details.privacySub")} />
            </div>
            <div className="inner-card settings-card delete-row">
              <Row
                icon={Close}
                tone="tone-red"
                title={t("delete.title")}
                sub={t("delete.sub")}
                end={
                  <button type="button" className="link-button link-danger" onClick={() => setDeleting(true)}>
                    {t("delete.button")}
                  </button>
                }
              />
            </div>
            {deleting && (
              <DeleteAccountDialog
                title={t("delete.dialogTitle")}
                lede={t("delete.lede", { hospital: TENANT.name })}
                points={t("delete.points", { returnObjects: true }) as string[]}
                confirmLabel={t("delete.confirm")}
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
              <h1 id="section-title">{t("sections.clinics")}</h1>
              <p>{t("units.lede", { hospital: TENANT.name })}</p>
            </header>
            {data ? <HospitalUnits clinics={data.clinics} hospital={TENANT.name} /> : <LoadingPane label={t("units.loading")} />}
          </>
        )}
      </section>
    </div>
  );
}

function EditLink({ label, onClick }: { label: string; onClick: () => void }) {
  const { t } = useTranslation("account");
  return (
    <button type="button" className="link-button" aria-label={label} onClick={onClick}>
      {t("details.change")}
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
  const { t } = useTranslation("account");
  const { state } = usePatientData();
  const data = state.status === "ready" ? state.data : undefined;
  // A visit a reminder is sent for: a set time with a named clinician. A
  // procedure request or a queue place read "…Surgical Unit, . Ref" here.
  const next = data ? upcoming(data.appointments).find((a) => a.clinicianProfileId && a.state !== "REQUESTED") : undefined;
  const joined = data && next ? join(data, next) : undefined;
  const reminderAt = next ? new Date(Date.parse(next.startAt) - 24 * 3600 * 1000) : undefined;
  const reminder = (date: string, time: string, clinic: string, clinician: string, reference: string) =>
    t("notifications.reminder", { date, time, clinic, clinician, reference, interpolation: { escapeValue: false } });
  const sample =
    next && joined
      ? reminder(
          SMS_DATE.format(new Date(next.startAt)),
          clock.time(next.startAt),
          joined.clinic?.name ?? t("notifications.fallbackClinic"),
          [joined.clinician?.givenName, joined.clinician?.familyName].filter(Boolean).join(" "),
          next.reference,
        )
      : reminder("26/09/2026", "10:00", "Paediatrics Unit", "Esther Mbarga", "APT-4958");

  return (
    <>
      <header className="section-head">
        <h1 id="section-title">{t("sections.notifications")}</h1>
        <p>{t("notifications.lede")}</p>
      </header>
      <div className="inner-card settings-card">
        <h3>{t("notifications.channels")}</h3>
        <Row icon={Phone} tone="tone-amber" title={t("notifications.sms")} sub={t("notifications.smsSub")} end={<On />} />
        <Row icon={Mail} tone="tone-green" title={t("notifications.emailConfirm")} sub={t("notifications.emailConfirmSub")} end={<On />} />
        <Row icon={Calendar} tone="tone-blue" title={t("notifications.shortNotice")} sub={t("notifications.shortNoticeSub")} end={<On />} />
        <PushRow />
      </div>
      <div className="inner-card settings-card">
        <h3>{t("notifications.timing")}</h3>
        <div className="lead-options" role="radiogroup" aria-label={t("notifications.timing")}>
          {[
            ["48h", "lead48", false],
            ["24h", "lead24", true],
            ["2h", "lead2", false],
          ].map(([value, key, on]) => (
            <span key={String(value)} role="radio" aria-checked={Boolean(on)} aria-disabled={!on} className={`lead${on ? " lead-on" : ""}`}>
              <span>{value}</span>
              <span>{on ? t(`notifications.${key}`) : t("notifications.later")}</span>
            </span>
          ))}
        </div>
        <div className="sms-preview">
          <span className="activity-icon tone-amber" aria-hidden="true">
            <Bell size={17} />
          </span>
          <span>
            <span className="sms-preview-label">
              {t("notifications.preview")}
              {reminderAt ? ` · ${clock.day(reminderAt).toUpperCase()}, ${clock.time(reminderAt)}` : ""}
            </span>
            <span className="sms-preview-text">{sample}</span>
          </span>
        </div>
      </div>
    </>
  );
}

/** Notifications on this browser, beside SMS and email, never instead of them. */
function PushRow() {
  const { t } = useTranslation("account");
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
      setFailed(e instanceof Error ? e.message : t("push.failed"));
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
        title={t("push.title")}
        sub={state ? t(`push.${state}`) : t("push.checking")}
        end={
          can ? (
            <button type="button" className="link-button" disabled={busy} onClick={change}>
              {state === "on" ? t("push.turnOff") : t("push.turnOn")}
            </button>
          ) : undefined
        }
      />
      {failed && <Notice tone="error">{failed}</Notice>}
    </>
  );
}

function On() {
  const { t } = useTranslation("account");
  return <span className="chip chip-confirmed">{t("notifications.on")}</span>;
}
