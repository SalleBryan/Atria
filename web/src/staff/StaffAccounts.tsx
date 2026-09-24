/**
 * Staff accounts, and "Admin · Create staff account" (103:2): a tenant
 * administrator creates an account with its role and a temporary password
 * (FR-ACC-03, FR-ACC-04). Only an administrator reaches this; the API
 * decides that too (staff.create).
 *
 * The Rev A list of accounts (94:2) needs a listing that Phase 1 does not
 * have, so the page states what it does and opens the form. Where the form
 * differs from the frame it follows the API: a given and a family name rather
 * than one, a mobile number (required), an employee number in place of a job
 * title, and the clinician's roll details when the role is Clinician. Which
 * fields a role needs, and what each role may do, are read from the
 * specification (src/generated), never restated here.
 *
 * The temporary password is shown once, to be passed on in person, and is
 * never kept by the console.
 */

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";

import { api } from "../api/client";
import { PACK, normalisePhone } from "../auth/phone";
import { useSession } from "../auth/session";
import { Field, Notice } from "../components/controls";
import { CheckMark, Clipboard, Close, Plus, User } from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { MATRIX, REQUIRED_ON_CREATE, type Role } from "../generated/permissions";
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

export function StaffAccounts() {
  const { state } = useSession();
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  if (state.status !== "signed-in") return null;
  if (roleOf(state.me) !== "TENANT_ADMIN") return <Navigate to="/console" replace />;

  return (
    <div className="accounts-page">
      <header className="glass accounts-head">
        <span className="accounts-icon" aria-hidden="true">
          <User size={22} />
        </span>
        <div className="staff-title">
          <h1>Staff accounts</h1>
          <p>Every account is created here, with its role. There is no sign-up and no invitation to accept.</p>
        </div>
        <button type="button" className="staff-primary accounts-new" onClick={() => setOpen(true)}>
          <Plus size={16} />
          Create staff account
        </button>
      </header>

      <section className="glass accounts-how" aria-labelledby="how-title">
        <h2 id="how-title">How an account starts</h2>
        <ol className="accounts-steps">
          <li>
            <span className="accounts-step">1</span>
            <span>
              <span className="timeline-title">You create it, with one role</span>
              <span className="timeline-sub">The role is fixed on the account. A change takes effect at their next sign-in.</span>
            </span>
          </li>
          <li>
            <span className="accounts-step">2</span>
            <span>
              <span className="timeline-title">You hand over the sign-in name and temporary password</span>
              <span className="timeline-sub">In person. The password is shown once, and works for 3 days.</span>
            </span>
          </li>
          <li>
            <span className="accounts-step">3</span>
            <span>
              <span className="timeline-title">They choose their own password</span>
              <span className="timeline-sub">At first sign-in, on the staff sign-in page. It must differ from the temporary one.</span>
            </span>
          </li>
        </ol>
        <p className="week-note">Listing, changing roles and suspending accounts arrive with the rest of the administration console.</p>
      </section>

      {open && (
        <CreateStaff
          onClose={() => setOpen(false)}
          onDone={(name) => {
            setOpen(false);
            setSaid(`Account created for ${name}.`);
          }}
        />
      )}
      <Snackbar message={said} onDone={() => setSaid(null)} />
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
