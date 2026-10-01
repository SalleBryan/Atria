/**
 * Personal account management for staff members (2026-10-01).
 *
 * Designed to strictly follow the Atria master-detail account layout
 * (find-care account), matching the patient portal account experience while
 * tailoring the sections to staff responsibilities: personal details,
 * role & assignment, and session security.
 */

import { type ComponentType, useState } from "react";
import { Navigate } from "react-router-dom";

import { useSession } from "../auth/session";
import { Notice } from "../components/controls";
import {
  Building,
  Calendar,
  CheckMark,
  ChevronLeft,
  ChevronRight,
  Globe,
  Lock,
  Mail,
  Phone,
  Shield,
  Stethoscope,
  User,
} from "../components/icons";
import { SignOutMenu } from "../components/SignOutMenu";
import { EditDetails, type Editing, shownDate } from "../patient/EditDetails";
import { languageName, initials } from "../patient/data";
import { phoneShown } from "./Patients";
import { ROLE_LABEL, roleOf, useStaffData } from "./data";
import { useTier } from "../layout/fit";

type Section = "details" | "assignment" | "session";

const SECTIONS: { id: Section; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: "details", label: "Personal details", icon: User },
  { id: "assignment", label: "Role & assignment", icon: Shield },
  { id: "session", label: "Session & security", icon: Lock },
];

function masked(phone: string | null | undefined): string {
  if (!phone) return "Not given";
  return `${phone.slice(0, 4)} ${"•".repeat(Math.max(0, phone.length - 7))} ${phone.slice(-3)}`;
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

export function StaffAccount() {
  const { state } = useSession();
  const { state: directory } = useStaffData();
  const [section, setSection] = useState<Section>("details");
  const phone = useTier() === "mobile";
  const [opened, setOpened] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [said, setSaid] = useState<string | null>(null);

  if (state.status !== "signed-in") return null;
  const me = state.me;
  if (!me.roles.length || me.roles.includes("PATIENT")) {
    return <Navigate to="/account" replace />;
  }

  const role = roleOf(me);
  const name = [me.givenName, me.familyName].filter(Boolean).join(" ") || "Your account";
  const clinic =
    directory.status === "ready"
      ? directory.data.clinics.find((c) => c.clinicId === me.clinicId)
      : undefined;
  const clinicianRecord =
    directory.status === "ready"
      ? directory.data.clinicians.find((c) => c.clinicianProfileId === me.staffId)
      : undefined;

  const start = (what: Exclude<Editing, null>) => {
    setSaid(null);
    setEditing(what);
  };

  const index = SECTIONS.findIndex((s) => s.id === section);

  return (
    <div className="find-care account" data-step={phone ? (opened ? "detail" : "list") : undefined}>
      <section className="find-list glass account-list" aria-label="Account">
        {phone && <h1 className="phone-title">Account</h1>}
        <div className={`profile-card${role === "TENANT_ADMIN" ? " account-card-admin" : ""}`}>
          <span className="hero-bloom" aria-hidden="true" />
          <span className="hero-avatar" aria-hidden="true">
            {initials(me.givenName, me.familyName) || "S"}
          </span>
          <span className="profile-text">
            <span className="profile-name">{name}</span>
            <span className="profile-email">{me.email ?? me.phoneE164 ?? "Staff account"}</span>
          </span>
          <span className="hero-tag">
            <CheckMark size={11} />
            {ROLE_LABEL[role]?.toUpperCase()} ACCOUNT
          </span>
        </div>

        <nav className="account-nav" aria-label="Account sections">
          <span
            className="side-pill account-pill"
            aria-hidden="true"
            style={{ transform: `translateY(calc(${index} * 52px))` }}
          />
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
              {phone && <ChevronRight size={16} />}
            </button>
          ))}
        </nav>
        <SignOutMenu className="outline-danger sign-out">Sign out</SignOutMenu>
      </section>

      <section className="find-detail glass account-detail" aria-labelledby="section-title" key={section}>
        <div className="phone-bar">
          <button
            type="button"
            className="square-button"
            aria-label="Back to your account"
            onClick={() => setOpened(false)}
          >
            <ChevronLeft size={18} />
          </button>
          <span>Account</span>
        </div>

        {section === "details" && (
          <>
            <header className="section-head">
              <h1 id="section-title">Personal details</h1>
              <p>
                What Atria holds about you. Change your name, mobile, date of birth and preferred language here.
                Your work email is your sign-in identifier and is managed by an administrator.
              </p>
            </header>

            {said && <Notice tone="success">{said}</Notice>}

            {editing && (
              <EditDetails
                editing={editing}
                audience="staff"
                onDone={(message) => {
                  setEditing(null);
                  if (message) setSaid(message);
                }}
              />
            )}

            <div className="inner-card settings-card">
              <Row
                icon={User}
                tone="tone-blue"
                title="Full name"
                sub={name}
                end={<EditLink label="Change your name" onClick={() => start("name")} />}
              />
              <Row
                icon={Mail}
                tone="tone-green"
                title="Work email"
                sub={me.email ?? "Not given (signs in with mobile)"}
              />
              <Row
                icon={Phone}
                tone="tone-amber"
                title="Work mobile"
                sub={me.phoneVerified ? masked(me.phoneE164) : `${phoneShown(me.phoneE164)} (unverified)`}
                end={<EditLink label="Change your mobile" onClick={() => start("phone")} />}
              />
              <Row
                icon={Globe}
                tone="tone-blue"
                title="Language"
                sub={languageName(me.languages?.[0] ?? "en")}
                end={<EditLink label="Change your language" onClick={() => start("language")} />}
              />
              <Row
                icon={Calendar}
                tone="tone-blue"
                title="Date of birth"
                sub={shownDate(me.dateOfBirth) || "Not given"}
                end={<EditLink label="Change your date of birth" onClick={() => start("born")} />}
              />
            </div>
          </>
        )}

        {section === "assignment" && (
          <>
            <header className="section-head">
              <h1 id="section-title">Role and assignment</h1>
              <p>Your access permissions, assigned clinical unit and healthcare directory profile.</p>
            </header>

            <div className="inner-card settings-card">
              <Row
                icon={Shield}
                tone="tone-violet"
                title="Access level"
                sub={ROLE_LABEL[role] ?? role}
              />
              <Row
                icon={Building}
                tone="tone-blue"
                title="Assigned unit"
                sub={
                  clinic?.name ??
                  (role === "TENANT_ADMIN" ? "Every unit (System-wide administration)" : "No unit assigned")
                }
              />
              {role === "CLINICIAN" && clinicianRecord && (
                <>
                  <Row
                    icon={Stethoscope}
                    tone="tone-amber"
                    title="Specialty"
                    sub={clinicianRecord.specialty || "General practice"}
                  />
                  {clinicianRecord.registrationYear && (
                    <Row
                      icon={Shield}
                      tone="tone-green"
                      title="Ordre registration"
                      sub={`Registered in ${clinicianRecord.registrationYear}${
                        clinicianRecord.qualifications.length
                          ? ` (${clinicianRecord.qualifications.join(", ")})`
                          : ""
                      }`}
                    />
                  )}
                  {clinicianRecord.languages?.length ? (
                    <Row
                      icon={Globe}
                      tone="tone-blue"
                      title="Consults in"
                      sub={clinicianRecord.languages.map((l) => languageName(l)).join(", ")}
                    />
                  ) : null}
                </>
              )}
            </div>
          </>
        )}

        {section === "session" && (
          <>
            <header className="section-head">
              <h1 id="section-title">Session and security</h1>
              <p>Manage your active console workstation sessions and device access.</p>
            </header>

            <div className="inner-card settings-card">
              <Row
                icon={User}
                tone="tone-blue"
                title="Current console session"
                sub="Signed in on this workstation browser."
              />
              <Row
                icon={Lock}
                tone="tone-red"
                title="Sign out of the console"
                sub="Sign out of this device or end every active session across all devices."
                end={<SignOutMenu className="outline-danger">Sign out</SignOutMenu>}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
