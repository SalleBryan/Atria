/**
 * Staff accounts, and "Admin · Create staff account" (103:2): a tenant
 * administrator creates an account with its role and a temporary password
 * (FR-ACC-03, FR-ACC-04). Only an administrator reaches this; the API
 * decides that too (staff.create).
 *
 * The list is "Admin · Staff accounts" (94:2), from GET /admin/staff: every
 * account with its group, status and role, filtered as the frame filters, and
 * the two actions Phase 1 has on an account, changing its role (FR-ACC-18)
 * and suspending it. Last sign-in is not recorded in Phase 1, so that column
 * gives the role and clinic instead. Where the form
 * differs from the frame it follows the API: a given and a family name rather
 * than one, a mobile number (required), an employee number in place of a job
 * title, and the clinician's roll details when the role is Clinician. Which
 * fields a role needs, and what each role may do, are read from the
 * specification (src/generated), never restated here.
 *
 * The temporary password is shown once, to be passed on in person, and is
 * never kept by the console.
 */

import { type CSSProperties, type FormEvent, useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";

import { api } from "../api/client";
import { PACK, normalisePhone } from "../auth/phone";
import { useSession } from "../auth/session";
import { Field, Notice } from "../components/controls";
import { CheckMark, Clipboard, Close, Plus, Repeat, Shield, User } from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { MATRIX, REQUIRED_ON_CREATE, type Role } from "../generated/permissions";
import { initials } from "../patient/data";
import { roleOf, useStaffData } from "./data";
import { sentence } from "./labels";
import { Snackbar } from "./Snackbar";

type StaffRole = Exclude<Role, "PATIENT">;

const ROLES: { role: StaffRole; label: string; about: string }[] = [
  { role: "RECEPTIONIST", label: "Receptionist", about: "Books, checks in and runs the day. No care context." },
  { role: "CLINICIAN", label: "Clinician", about: "Own list and queue, and their own patients' care context." },
  { role: "CLINIC_MANAGER", label: "Clinic manager", about: "Receptionist, plus the rota, reporting and audit." },
  { role: "TENANT_ADMIN", label: "Tenant administrator", about: "Accounts, settings, fees and policy. No care context." },
];

/** What the role may do, in the frame's words, read from the permission matrix. */
function allowances(role: StaffRole): { text: string; yes: boolean }[] {
  const read = MATRIX["appointment.read"][role];
  return [
    {
      text: read === "own" ? "View their own calendar" : read === "tenant" ? "View every clinic's schedule" : "View and manage the clinic schedule",
      yes: read !== "none",
    },
    { text: "Book, reschedule and cancel for patients", yes: MATRIX["appointment.create"][role] !== "none" && MATRIX["appointment.cancel"][role] !== "none" },
    { text: "Check patients in and mark no-shows", yes: MATRIX["appointment.check_in"][role] !== "none" },
    { text: "Read intake answers or care context", yes: MATRIX["care_context.read"][role] !== "none" },
    { text: "Create and manage staff accounts", yes: MATRIX["staff.create"][role] !== "none" },
  ];
}

const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface Created {
  givenName: string | null;
  familyName: string | null;
  signInName: string;
  temporaryPassword: string;
}

interface Listed {
  staffId: string;
  givenName: string | null;
  familyName: string | null;
  signInName: string | null;
  clinicId: string | null;
  roles: StaffRole[];
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "ENDED";
  mustSetPassword: boolean | null;
}

type Filter = "all" | "awaiting" | "admins" | "suspended";

const FILTERS: { id: Filter; label: string; keep: (a: Listed) => boolean }[] = [
  { id: "all", label: "All users", keep: () => true },
  { id: "awaiting", label: "Awaiting first sign-in", keep: (a) => a.mustSetPassword === true && a.status !== "SUSPENDED" },
  { id: "admins", label: "Administrators", keep: (a) => a.roles.includes("TENANT_ADMIN") },
  { id: "suspended", label: "Suspended", keep: (a) => a.status === "SUSPENDED" },
];

const ROLE_NAME: Record<StaffRole, string> = {
  RECEPTIONIST: "Front desk",
  CLINICIAN: "Clinician",
  CLINIC_MANAGER: "Clinic manager",
  TENANT_ADMIN: "Administrator",
};

/** Roles an account can move between without new details: both work at one clinic and need nothing more. */
const INTERCHANGEABLE: StaffRole[] = ["RECEPTIONIST", "CLINIC_MANAGER"];

export function StaffAccounts() {
  const { state } = useSession();
  const { state: directory } = useStaffData();
  const [accounts, setAccounts] = useState<Listed[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [fresh, setFresh] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [creating, setCreating] = useState(false);
  const [changing, setChanging] = useState<Listed | null>(null);
  const [suspending, setSuspending] = useState<Listed | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const admin = state.status === "signed-in" && roleOf(state.me) === "TENANT_ADMIN";

  useEffect(() => {
    if (!admin) return;
    let live = true;
    api<{ accounts: Listed[] }>("/admin/staff")
      .then((found) => live && setAccounts(found.accounts))
      .catch((error: unknown) => live && setFailure(error instanceof Error ? sentence(error.message) : "The accounts could not be loaded."));
    return () => {
      live = false;
    };
  }, [admin, fresh]);

  if (state.status !== "signed-in") return null;
  if (!admin) return <Navigate to="/console" replace />;

  const clinicName = (id: string | null) =>
    directory.status === "ready" ? directory.data.clinics.find((c) => c.clinicId === id)?.name : undefined;
  const shown = (accounts ?? []).filter(FILTERS.find((f) => f.id === filter)!.keep);
  const awaiting = (accounts ?? []).filter((a) => a.mustSetPassword === true && a.status !== "SUSPENDED").length;
  const done = (message: string) => {
    setSaid(message);
    setFresh((n) => n + 1);
  };

  return (
    <div className="accounts-page">
      <header className="accounts-top">
        <div>
          <h1>Console users</h1>
          <p>Everyone who can sign in to the clinic console</p>
        </div>
        <button type="button" className="staff-primary accounts-new" onClick={() => setCreating(true)}>
          <Plus size={16} />
          Create staff account
        </button>
      </header>

      <p className="accounts-banner">
        <Shield size={18} />
        Only administrators see this page. Staff accounts are created here and nowhere else, there is no sign-up for the
        console, and patients never appear in this list.
      </p>

      <div className="accounts-filters">
        <div className="chips" role="radiogroup" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={filter === f.id}
              className={`week-chip${filter === f.id ? " week-chip-on" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="accounts-count">{accounts ? `${shown.length} of ${accounts.length} users` : ""}</span>
      </div>

      <section className="glass accounts-card" aria-label="Staff accounts">
        {failure ? (
          <Notice tone="error">{failure} Check your connection and try again.</Notice>
        ) : !accounts ? (
          <div className="day-rows" aria-busy="true">
            {[0, 1, 2, 3].map((n) => (
              <span key={n} className="skeleton day-row-skeleton" />
            ))}
          </div>
        ) : (
          <>
            <div className="accounts-head" aria-hidden="true">
              <span>USER</span>
              <span>GROUP</span>
              <span>ACCOUNT STATUS</span>
              <span>ROLE</span>
            </div>
            <ul className="accounts-rows">
              {shown.map((account, index) => {
                const off = account.status === "SUSPENDED" || account.status === "ENDED";
                const adminRole = account.roles.includes("TENANT_ADMIN");
                const self = state.me.staffId === account.staffId;
                const status = off
                  ? { label: "Suspended", tone: "neutral" }
                  : account.mustSetPassword
                    ? { label: "Must set password", tone: "awaiting" }
                    : account.mustSetPassword === false
                      ? { label: "Active", tone: "confirmed" }
                      : { label: "Unknown", tone: "neutral" };
                const name = [account.givenName, account.familyName].filter(Boolean).join(" ") || "Unnamed account";
                return (
                  <li key={account.staffId} className={`account-row${off ? " account-row-off" : ""}`} style={{ "--i": index } as CSSProperties}>
                    <span className="account-who">
                      <span className={`account-avatar${adminRole ? " account-avatar-admin" : ""}`} aria-hidden="true">
                        {initials(account.givenName, account.familyName) || "?"}
                      </span>
                      <span className="account-text">
                        <span className="account-name">{name}</span>
                        <span className="account-sub">{account.signInName ?? "No sign-in name"}</span>
                      </span>
                    </span>
                    <span>
                      <span className={`chip ${adminRole ? "chip-admin" : "chip-booked"}`}>{adminRole ? "ADMIN" : "STAFF"}</span>
                    </span>
                    <span>
                      <span className={`chip chip-${status.tone}`}>{status.label}</span>
                    </span>
                    <span className="account-role">
                      <span>{account.roles.map((r) => ROLE_NAME[r] ?? r).join(", ")}</span>
                      <span>{clinicName(account.clinicId) ?? (adminRole ? "Every clinic" : "")}</span>
                    </span>
                    <span className="account-actions">
                      <button
                        type="button"
                        className="square-button"
                        aria-label={`Change ${name}'s role`}
                        title="Change role"
                        disabled={off || self}
                        onClick={() => setChanging(account)}
                      >
                        <Repeat size={15} />
                      </button>
                      <button
                        type="button"
                        className="square-button account-suspend"
                        aria-label={`Suspend ${name}`}
                        title="Suspend"
                        disabled={off || self}
                        onClick={() => setSuspending(account)}
                      >
                        <Close size={15} />
                      </button>
                    </span>
                  </li>
                );
              })}
              {!shown.length && <li className="today-empty">No accounts match.</li>}
            </ul>
            {awaiting > 0 && (
              <p className="accounts-foot">
                {awaiting === 1 ? "1 account has" : `${awaiting} accounts have`} a temporary password and must set their own
                on first sign-in.
              </p>
            )}
          </>
        )}
      </section>

      {creating && (
        <CreateStaff
          onClose={() => setCreating(false)}
          onDone={(name) => {
            setCreating(false);
            done(`Account created for ${name}.`);
          }}
        />
      )}
      {changing && (
        <ChangeRole
          account={changing}
          onClose={() => setChanging(null)}
          onDone={(message) => {
            setChanging(null);
            done(message);
          }}
        />
      )}
      {suspending && (
        <Suspend
          account={suspending}
          onClose={() => setSuspending(null)}
          onDone={(message) => {
            setSuspending(null);
            done(message);
          }}
        />
      )}
      <Snackbar message={said} onDone={() => setSaid(null)} />
    </div>
  );
}

/**
 * FR-ACC-18: a role change applies at the account's next sign-in, because
 * roles travel in the token, and it is recorded. Only a move between front
 * desk and clinic manager is offered here: a clinician needs their roll
 * details and an administrator an email and no clinic, so either is a new
 * account rather than a changed one.
 */
function ChangeRole({ account, onClose, onDone }: { account: Listed; onClose: () => void; onDone: (message: string) => void }) {
  const current = account.roles[0];
  const movable = account.roles.length === 1 && current !== undefined && INTERCHANGEABLE.includes(current);
  const [role, setRole] = useState<StaffRole | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const name = [account.givenName, account.familyName].filter(Boolean).join(" ");

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!role) return;
    setBusy(true);
    setFailure(null);
    try {
      await api(`/admin/staff/${account.staffId}/roles`, { method: "PATCH", json: { roles: [role] } });
      onDone(`${name} becomes ${ROLE_NAME[role].toLowerCase()} at their next sign-in.`);
    } catch (caught) {
      setFailure(`${sentence(caught instanceof Error ? caught.message : "The role could not be changed")} Nothing was changed.`);
      setBusy(false);
    }
  }

  return (
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="role-title" onClick={(e) => e.stopPropagation()}>
        <span className="dialog-icon accounts-dialog-icon" aria-hidden="true">
          <Repeat size={22} />
        </span>
        <h2 id="role-title">Change {name}'s role</h2>
        <p className="dialog-lede">The new role applies at their next sign-in, and the change is recorded against your account.</p>
        {movable ? (
          <form onSubmit={save}>
            <div className="role-grid role-grid-one" role="radiogroup" aria-label="New role">
              {INTERCHANGEABLE.filter((r) => r !== current).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={role === r}
                  className={`role-card${role === r ? " role-card-on" : ""}`}
                  onClick={() => setRole(r)}
                >
                  <span className="role-radio" aria-hidden="true">
                    {role === r && <CheckMark size={11} />}
                  </span>
                  <span className="role-name">{ROLE_NAME[r]}</span>
                  <span className="role-about">{ROLES.find((o) => o.role === r)?.about}</span>
                </button>
              ))}
            </div>
            {failure && <Notice tone="error">{failure}</Notice>}
            <div className="dialog-actions">
              <button type="button" className="outline-button keep" onClick={onClose} disabled={busy}>
                Keep {ROLE_NAME[current].toLowerCase()}
              </button>
              <button type="submit" className="staff-primary" disabled={!role || busy} aria-busy={busy || undefined}>
                {busy ? "Saving" : "Change role"}
              </button>
            </div>
          </form>
        ) : (
          <>
            <Notice>
              A clinician needs their roll details and an administrator an email and no clinic, so moving into or out of
              either is a new account. Create one for the new role, then suspend this one.
            </Notice>
            <div className="dialog-actions">
              <button type="button" className="outline-button keep" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Suspend({ account, onClose, onDone }: { account: Listed; onClose: () => void; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const name = [account.givenName, account.familyName].filter(Boolean).join(" ");

  async function suspend() {
    setBusy(true);
    setFailure(null);
    try {
      await api(`/admin/staff/${account.staffId}/suspend`, { method: "POST" });
      onDone(`${name} is suspended and signed out everywhere.`);
    } catch (caught) {
      setFailure(`${sentence(caught instanceof Error ? caught.message : "The account could not be suspended")} Nothing was changed.`);
      setBusy(false);
    }
  }

  return (
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="suspend-title" onClick={(e) => e.stopPropagation()}>
        <span className="dialog-icon" aria-hidden="true">
          <Close size={22} />
        </span>
        <h2 id="suspend-title">Suspend {name}?</h2>
        <p className="dialog-lede">
          Their sessions end now and they cannot sign in again. Their past bookings stay on record. A suspended account is
          not deleted, and stays on this list.
        </p>
        {failure && <Notice tone="error">{failure}</Notice>}
        <div className="dialog-actions">
          <button type="button" className="outline-button keep" onClick={onClose} disabled={busy}>
            Keep the account
          </button>
          <button type="button" className="danger-button" onClick={() => void suspend()} disabled={busy} aria-busy={busy || undefined}>
            {busy ? <LoadingIndicator size={20} label="Suspending" /> : null}
            {busy ? "Suspending" : "Suspend"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateStaff({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const { state: directory } = useStaffData();
  const clinics = directory.status === "ready" ? directory.data.clinics : [];
  const [role, setRole] = useState<StaffRole>("RECEPTIONIST");
  const [form, setForm] = useState({
    givenName: "",
    familyName: "",
    phone: "",
    email: "",
    clinicId: "",
    employeeNumber: "",
    specialty: "",
    registrationYear: "",
    ordreNumber: "",
  });
  const [languages, setLanguages] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sheet.current?.querySelector<HTMLElement>("input")?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !busy && !created && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, created, onClose]);

  const needs = new Set(REQUIRED_ON_CREATE[role] ?? []);
  const set = (name: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [name]: event.target.value }));

  function check(): Record<string, string> {
    const found: Record<string, string> = {};
    const phone = normalisePhone(form.phone);
    if (!form.givenName.trim()) found.givenName = "Enter their given name.";
    if (!form.familyName.trim()) found.familyName = "Enter their family name.";
    if (!E164.test(phone)) found.phone = `Enter their mobile with its country code, such as ${PACK.dialCode ?? "+237"} 6 70 00 00 00.`;
    if (needs.has("email") && !form.email.trim()) found.email = "An administrator signs in with an email address. Enter theirs.";
    else if (form.email.trim() && !EMAIL.test(form.email.trim())) found.email = "That is not an email address. Check it and try again.";
    if (needs.has("clinicId") && !form.clinicId) found.clinicId = "Choose the clinic they work at.";
    if (needs.has("specialty") && !form.specialty.trim()) found.specialty = "Enter their specialty.";
    const year = Number(form.registrationYear);
    if (needs.has("registrationYear") && !(Number.isInteger(year) && year >= 1950 && year <= new Date().getFullYear())) {
      found.registrationYear = "Enter the year they joined the Order's roll, such as 2012.";
    }
    if (needs.has("ordreNumber") && !form.ordreNumber.trim()) found.ordreNumber = "Enter their Ordre number.";
    if (needs.has("languages") && languages.length === 0) found.languages = "Choose at least one language they consult in.";
    return found;
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const found = check();
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setFailure(null);
    const body: Record<string, unknown> = {
      givenName: form.givenName.trim(),
      familyName: form.familyName.trim(),
      phoneE164: normalisePhone(form.phone),
      roles: [role],
    };
    if (form.email.trim()) body.email = form.email.trim();
    if (form.employeeNumber.trim()) body.employeeNumber = form.employeeNumber.trim();
    if (needs.has("clinicId")) body.clinicId = form.clinicId;
    if (role === "CLINICIAN") {
      Object.assign(body, {
        specialty: form.specialty.trim(),
        registrationYear: Number(form.registrationYear),
        ordreNumber: form.ordreNumber.trim(),
        languages,
      });
    }
    try {
      setCreated(await api<Created>("/admin/staff", { method: "POST", json: body }));
    } catch (caught) {
      setFailure(
        `${sentence(caught instanceof Error ? caught.message : "The account could not be created")} Nothing was created; check the details and try again.`,
      );
    } finally {
      setBusy(false);
    }
  }

  const name = [form.givenName.trim(), form.familyName.trim()].filter(Boolean).join(" ");

  return (
    <div className="scrim" onClick={() => !busy && !created && onClose()}>
      <div
        ref={sheet}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sheet-head">
          <span className={`sheet-icon${created ? " sheet-icon-done" : ""}`} aria-hidden="true">
            {created ? <CheckMark size={22} /> : <User size={22} />}
          </span>
          <span className="sheet-title">
            <h2 id="create-title">{created ? `Account created for ${name}` : "Create staff account"}</h2>
            <p>
              {created
                ? "Pass these on in person. This is the only time the password is shown."
                : "Administrators only · the account is created directly, there is no invitation to accept"}
            </p>
          </span>
          {!created && (
            <button type="button" className="square-button" aria-label="Close" onClick={onClose} disabled={busy}>
              <Close size={16} />
            </button>
          )}
        </header>

        {created ? (
          <>
            <div className="sheet-body">
              <Secret label="Sign-in name" value={created.signInName} />
              <Secret label="Temporary password" value={created.temporaryPassword} mono />
              <Notice>
                The temporary password works for 3 days. At first sign-in they choose their own, on the staff sign-in
                page.
              </Notice>
            </div>
            <footer className="sheet-foot">
              <span>Creating the account was logged against your admin user.</span>
              <button type="button" className="staff-primary sheet-primary" onClick={() => onDone(name)}>
                Done
              </button>
            </footer>
          </>
        ) : (
          <form onSubmit={create} noValidate>
            <div className="sheet-body">
              <p className="dialog-label">PERSON</p>
              <div className="sheet-grid">
                <Field label="Given name" value={form.givenName} onChange={set("givenName")} error={errors.givenName} autoComplete="off" />
                <Field label="Family name" value={form.familyName} onChange={set("familyName")} error={errors.familyName} autoComplete="off" />
                <Field
                  label="Mobile"
                  type="tel"
                  inputMode="tel"
                  value={form.phone}
                  onChange={set("phone")}
                  error={errors.phone}
                  hint={`With the country code, such as ${PACK.dialCode ?? "+237"} 6 70 00 00 00.`}
                  autoComplete="off"
                />
                <Field
                  label={needs.has("email") ? "Work email" : "Work email (optional)"}
                  type="email"
                  value={form.email}
                  onChange={set("email")}
                  error={errors.email}
                  hint="Their sign-in name when given; otherwise their mobile is. It cannot be changed later."
                  autoComplete="off"
                />
                {needs.has("clinicId") && (
                  <div className="field">
                    <label className="field-label" htmlFor="staff-clinic">
                      Clinic
                    </label>
                    <div className={`input select${errors.clinicId ? " input-invalid" : ""}`}>
                      <select id="staff-clinic" value={form.clinicId} onChange={set("clinicId")} aria-invalid={errors.clinicId ? true : undefined}>
                        <option value="">Choose a clinic</option>
                        {clinics.map((clinic) => (
                          <option key={clinic.clinicId} value={clinic.clinicId}>
                            {clinic.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {errors.clinicId && <p className="field-error">{errors.clinicId}</p>}
                  </div>
                )}
                <Field label="Employee number (optional)" value={form.employeeNumber} onChange={set("employeeNumber")} autoComplete="off" />
              </div>

              <p className="dialog-label sheet-label">ACCESS LEVEL</p>
              <div className="role-grid" role="radiogroup" aria-label="Access level">
                {ROLES.map((option) => (
                  <button
                    key={option.role}
                    type="button"
                    role="radio"
                    aria-checked={role === option.role}
                    aria-labelledby={`role-${option.role}`}
                    aria-describedby={`role-${option.role}-about`}
                    className={`role-card${role === option.role ? " role-card-on" : ""}`}
                    onClick={() => setRole(option.role)}
                  >
                    <span className="role-radio" aria-hidden="true">
                      {role === option.role && <CheckMark size={11} />}
                    </span>
                    <span className="role-name" id={`role-${option.role}`}>
                      {option.label}
                    </span>
                    <span className="role-about" id={`role-${option.role}-about`}>
                      {option.about}
                    </span>
                  </button>
                ))}
              </div>

              {role === "CLINICIAN" && (
                <div className="sheet-grid clinician-fields">
                  <Field label="Specialty" value={form.specialty} onChange={set("specialty")} error={errors.specialty} autoComplete="off" />
                  <Field
                    label="Year on the Order's roll"
                    inputMode="numeric"
                    value={form.registrationYear}
                    onChange={set("registrationYear")}
                    error={errors.registrationYear}
                    autoComplete="off"
                  />
                  <Field label="Ordre number" value={form.ordreNumber} onChange={set("ordreNumber")} error={errors.ordreNumber} autoComplete="off" />
                  <div className="field">
                    <span className="field-label" id="staff-languages">
                      Consults in
                    </span>
                    <div className="chips" role="group" aria-labelledby="staff-languages">
                      {(PACK.languages ?? ["fr", "en"]).map(String).map((code) => (
                        <button
                          key={code}
                          type="button"
                          aria-pressed={languages.includes(code)}
                          className={`chip-choice${languages.includes(code) ? " chip-on" : ""}`}
                          onClick={() =>
                            setLanguages((current) => (current.includes(code) ? current.filter((c) => c !== code) : [...current, code]))
                          }
                        >
                          {code === "fr" ? "French" : code === "en" ? "English" : code}
                        </button>
                      ))}
                    </div>
                    {errors.languages && <p className="field-error">{errors.languages}</p>}
                  </div>
                </div>
              )}

              <ul className="allowances" aria-label="What this role can do">
                {allowances(role).map(({ text, yes }) => (
                  <li key={text} className={yes ? "allow-yes" : "allow-no"}>
                    <span aria-hidden="true">{yes ? <CheckMark size={11} /> : <Close size={11} />}</span>
                    <span>
                      {text}
                      <span className="visually-hidden">{yes ? ": yes" : ": no"}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {failure && <Notice tone="error">{failure}</Notice>}
            </div>
            <footer className="sheet-foot">
              <span>Creating an account is logged against your admin user.</span>
              <button type="button" className="outline-button sheet-cancel" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="staff-primary sheet-primary" disabled={busy} aria-busy={busy || undefined}>
                {busy ? <LoadingIndicator size={20} label="Creating the account" /> : null}
                {busy ? "Creating" : "Create account"}
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}

function Secret({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="secret">
      <span className="secret-label">{label}</span>
      <span className={`secret-value${mono ? " secret-mono" : ""}`}>{value}</span>
      <button
        type="button"
        className="secret-copy"
        onClick={() =>
          void navigator.clipboard?.writeText(value).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
      >
        {copied ? <CheckMark size={14} /> : <Clipboard size={14} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
