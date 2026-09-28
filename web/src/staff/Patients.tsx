/**
 * The patient register and a patient's record, for staff (FR-STF-06, FR-STF-07, FR-BKG-07).
 *
 * The register is one search: a name, a mobile number or a patient number,
 * answered as the desk types. A patient not yet in it is added with a minimal
 * record (a name and a mobile), and booked straight away. The record shows
 * contact details, whether they can sign in and what has been proven, and the
 * visits the viewer's role may see: a unit's desk its unit's, a clinician
 * their own. Care context is never here. Every search and record is in the
 * audit log, with the patients it showed.
 *
 * Built from Staff accounts' parts: the header, the search field, the glass
 * card and account rows, and Availability's dialog.
 */

import { type CSSProperties, type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api, apiAll, ApiError } from "../api/client";
import { useSession } from "../auth/session";
import { Checkbox, Field, Notice } from "../components/controls";
import { ArrowLeft, Calendar, ChevronRight, Close, Phone, Plus, Search, Shield, User } from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { LoadingPane } from "../components/LoadingPane";
import { LoadingRow } from "../components/LoadingPane";
import { SelectMenu } from "../components/Pickers";
import { Pager, usePages, useRowsThatFit } from "../components/Pager";
import { MATRIX } from "../generated/permissions";
import { clock, initials, languageName, type Appointment } from "../patient/data";
import { doctor, roleOf, useStaffData } from "./data";
import { CHANNEL, sentence, staffState } from "./labels";
import { Snackbar } from "./Snackbar";

export interface RegisterEntry {
  patientProfileId: string;
  givenName: string | null;
  familyName: string | null;
  phoneE164: string | null;
  patientNumber: string | null;
  dateOfBirth: string | null;
}

interface PatientRecord extends RegisterEntry {
  email: string | null;
  preferredLanguage: string | null;
  hasAccount: boolean;
  phoneVerified: boolean;
  emailVerified: boolean;
  source: "SELF" | "DESK";
  createdAt: string | null;
  visitScope: "own" | "clinic" | "tenant";
  appointments: Appointment[];
}

export const fullName = (p: Pick<RegisterEntry, "givenName" | "familyName">) =>
  [p.givenName, p.familyName].filter(Boolean).join(" ") || "Unnamed patient";

/** +237 6 91 23 45 67, as the desk reads a Cameroonian mobile. */
export function phoneShown(phone: string | null | undefined): string {
  if (!phone) return "No phone";
  const cm = /^\+237(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(phone);
  if (cm) return `+237 ${cm.slice(1).join(" ")}`;
  // The fictional North American numbers used in testing: +1 202 555 0147.
  const nanp = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone);
  return nanp ? `+1 ${nanp.slice(1).join(" ")}` : phone;
}

export function age(dateOfBirth: string | null | undefined): string | null {
  if (!dateOfBirth) return null;
  const born = new Date(`${dateOfBirth}T12:00:00Z`);
  const now = new Date();
  let years = now.getUTCFullYear() - born.getUTCFullYear();
  if (now.getUTCMonth() < born.getUTCMonth() || (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate()))
    years -= 1;
  return years < 1 ? "Under 1" : `${years} years`;
}

const can = (role: string, permission: keyof typeof MATRIX) => (MATRIX[permission] as Record<string, string>)[role] !== "none";

/**
 * Searched as the desk types, a beat after they pause. With `everyone`, no
 * search lists the whole register, newest first (2026-09-28).
 */
export function useRegisterSearch(query: string, { everyone = false }: { everyone?: boolean } = {}) {
  const [results, setResults] = useState<RegisterEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    const words = query.trim();
    const listing = everyone && words.length === 0;
    if (words.length < 2 && !listing) {
      setResults(null);
      setBusy(false);
      return;
    }
    let live = true;
    setBusy(true);
    const later = window.setTimeout(() => {
      (listing
        ? apiAll<{ results: RegisterEntry[]; nextCursor?: string | null }>("/patients", "results")
        : api<{ results: RegisterEntry[] }>(`/patients?q=${encodeURIComponent(words)}`)
      )
        .then((found) => {
          if (!live) return;
          setResults(found.results);
          setFailure(null);
        })
        .catch(
          (error: unknown) => live && setFailure(error instanceof Error ? sentence(error.message) : "The register could not be searched."),
        )
        .finally(() => live && setBusy(false));
    }, listing ? 0 : 250);
    return () => {
      live = false;
      window.clearTimeout(later);
    };
  }, [query, everyone]);
  return { results, busy, failure };
}

export function Patients() {
  const { state } = useSession();
  const role = state.status === "signed-in" ? roleOf(state.me) : "RECEPTIONIST";
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const { results, busy, failure } = useRegisterSearch(query, { everyone: true });
  const [adding, setAdding] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const rowsBox = useRef<HTMLUListElement>(null);
  const size = useRowsThatFit(rowsBox, { row: ".patient-row", pitch: 76 });
  const pages = usePages(results ?? [], size, query);
  const creates = can(role, "patient.create");

  return (
    <div className="accounts-page patients-page">
      <header className="accounts-top">
        <div>
          <h1>Patients</h1>
          <p>The hospital's register. Search by name, mobile number or patient number.</p>
        </div>
        {creates && (
          <button type="button" className="staff-primary accounts-new" onClick={() => setAdding(true)}>
            <Plus size={16} />
            New patient
          </button>
        )}
      </header>

      <label className="find-search patients-search">
        <Search size={17} />
        <input
          type="text"
          enterKeyHint="search"
          aria-label="Search patients"
          placeholder="Amina Ngo, 691 23 45 67 or RHB-000123"
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
        />
        {busy && <LoadingIndicator size={18} label="Searching" />}
      </label>

      <section className="glass accounts-card" aria-label="Patients found">
        {failure && <Notice tone="error">{failure}</Notice>}
        <div className="accounts-head patients-head" aria-hidden="true">
          <span>PATIENT</span>
          <span>MOBILE</span>
          <span>AGE</span>
        </div>
        <ul ref={rowsBox} className="accounts-rows">
          {results === null && busy ? (
            <LoadingRow label="Loading the register" />
          ) : results === null ? (
            <li className="today-empty patients-empty">
              <Search size={20} />
              Type two letters or more to search. Every search is recorded in the audit log.
            </li>
          ) : results.length ? (
            pages.shown.map((p, index) => (
              <li key={p.patientProfileId} className="account-row patient-row" style={{ "--i": index } as CSSProperties}>
                <Link to={`/console/patients/${p.patientProfileId}`} className="patient-link">
                  <span className="account-who">
                    <span className="account-avatar" aria-hidden="true">
                      {initials(p.givenName, p.familyName) || "?"}
                    </span>
                    <span className="account-text">
                      <span className="account-name">{fullName(p)}</span>
                      <span className="account-sub">{p.patientNumber ?? "No patient number"}</span>
                    </span>
                  </span>
                  <span className="account-role">
                    <span>{phoneShown(p.phoneE164)}</span>
                  </span>
                  <span className="account-role">
                    <span>{age(p.dateOfBirth) ?? "Not given"}</span>
                  </span>
                  <span className="patient-go" aria-hidden="true">
                    <ChevronRight size={16} />
                  </span>
                </Link>
              </li>
            ))
          ) : (
            <li className="today-empty patients-empty">
              No patient matches “{query.trim()}”.{" "}
              {creates && (
                <button type="button" className="link" onClick={() => setAdding(true)}>
                  Add them as a new patient
                </button>
              )}
            </li>
          )}
        </ul>
        {results && results.length > 0 && (
          <Pager
            noun="patients"
            first={pages.first}
            last={pages.last}
            total={pages.total}
            page={pages.page}
            pages={pages.pages}
            onPrevious={pages.previous}
            onNext={pages.next}
            note={results.length >= 20 ? "the first 20; type more to narrow it" : undefined}
          />
        )}
      </section>

      {adding && (
        <NewPatient
          start={query}
          onClose={() => setAdding(false)}
          onDone={(made, book) => {
            setAdding(false);
            if (book) navigate(`/console/book?patient=${made.patientProfileId}`);
            else {
              setSaid(`${fullName(made)} added as ${made.patientNumber}.`);
              navigate(`/console/patients/${made.patientProfileId}`);
            }
          }}
        />
      )}
      <Snackbar message={said} onDone={() => setSaid(null)} />
    </div>
  );
}

/** A minimal record: a name, a mobile number, the date of birth if known (FR-BKG-07). */
export function NewPatient({
  start = "",
  onClose,
  onDone,
}: {
  start?: string;
  onClose: () => void;
  onDone: (made: RegisterEntry, book: boolean) => void;
}) {
  const guess = /\d/.test(start) ? { name: "", phone: start } : { name: start.trim(), phone: "" };
  const [given, setGiven] = useState(guess.name.split(" ")[0] ?? "");
  const [family, setFamily] = useState(guess.name.split(" ").slice(1).join(" "));
  const [phone, setPhone] = useState(guess.phone);
  const [born, setBorn] = useState("");
  const [language, setLanguage] = useState<"en" | "fr">("en");
  const [shared, setShared] = useState<RegisterEntry[] | null>(null);
  const [sameNumber, setSameNumber] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  function e164(raw: string) {
    const digits = raw.replace(/[\s().-]/g, "");
    if (digits.startsWith("+")) return digits;
    if (/^6\d{8}$/.test(digits)) return `+237${digits}`;
    if (/^237\d{9}$/.test(digits)) return `+${digits}`;
    return digits;
  }

  async function submit(event: FormEvent, book: boolean) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const made = await api<RegisterEntry>("/patients", {
        method: "POST",
        json: {
          givenName: given.trim(),
          familyName: family.trim(),
          phoneE164: e164(phone),
          ...(born ? { dateOfBirth: born } : {}),
          preferredLanguage: language,
          ...(sameNumber ? { sameNumberConfirmed: true } : {}),
        },
      });
      onDone(made, book);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setShared(((caught.detail as { patients?: RegisterEntry[] } | undefined)?.patients ?? []) as RegisterEntry[]);
      } else {
        setFailure(`${sentence(caught instanceof Error ? caught.message : "The record could not be made")} Nothing was saved.`);
      }
      setBusy(false);
    }
  }

  const ready = given.trim() && family.trim() && e164(phone).length >= 10 && (!shared || sameNumber);

  return (
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div
        className="dialog staff-dialog move-dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-patient-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="icon-button dialog-close" aria-label="Close" onClick={onClose} disabled={busy}>
          <Close size={16} />
        </button>
        <div className="move-scroll">
          <span className="dialog-icon dialog-icon-blue" aria-hidden="true">
            <User size={22} />
          </span>
          <h2 id="new-patient-title">New patient</h2>
          <p className="dialog-lede">
            A minimal record, with a patient number, so they can be booked now. They can create an account later with the same mobile
            number.
          </p>
          <form id="new-patient-form" className="settings-dialog-form" onSubmit={(event) => void submit(event, true)}>
            <div className="off-fields">
              <Field label="Given name" value={given} maxLength={60} onChange={(e) => setGiven(e.target.value)} />
              <Field label="Family name" value={family} maxLength={60} onChange={(e) => setFamily(e.target.value)} />
            </div>
            <Field
              label="Mobile number"
              icon={Phone}
              inputMode="tel"
              placeholder="6 91 23 45 67"
              hint="Reminders go here by SMS."
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setShared(null);
                setSameNumber(false);
              }}
            />
            <div className="off-fields">
              <BirthDate value={born} onChange={setBorn} />
            </div>
            <div className="off-fields">
              <div className="off-field">
                <span>Messages in</span>
                <div className="segmented" role="radiogroup" aria-label="Messages in">
                  {(["en", "fr"] as const).map((code) => (
                    <button
                      key={code}
                      type="button"
                      role="radio"
                      aria-checked={language === code}
                      className={`segment${language === code ? " segment-on" : ""}`}
                      onClick={() => setLanguage(code)}
                    >
                      {languageName(code)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {shared && (
              <div className="patients-shared">
                <Notice tone="info">
                  {shared.length === 1 ? "A patient already has" : `${shared.length} patients already have`} this number. Families often
                  share a phone; if this is one of them, open their record instead.
                </Notice>
                <ul>
                  {shared.map((p) => (
                    <li key={p.patientProfileId}>
                      <Link to={`/console/patients/${p.patientProfileId}`} onClick={onClose}>
                        {fullName(p)} · {p.patientNumber}
                      </Link>
                    </li>
                  ))}
                </ul>
                <Checkbox checked={sameNumber} onChange={setSameNumber}>
                  This is someone else sharing the number
                </Checkbox>
              </div>
            )}
            {failure && <Notice tone="error">{failure}</Notice>}
          </form>
        </div>
        <div className="dialog-actions move-actions">
          <button type="button" className="outline-button keep" disabled={busy || !ready} onClick={(event) => void submit(event, false)}>
            Save only
          </button>
          <button type="submit" form="new-patient-form" className="staff-primary" disabled={busy || !ready} aria-busy={busy || undefined}>
            {busy ? <LoadingIndicator size={20} label="Saving" /> : null}
            {busy ? "Saving" : "Save and book"}
          </button>
        </div>
      </div>
    </div>
  );
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A date of birth from three menus: a month grid is no way to reach 1958. */
function BirthDate({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const [year, month, day] = value ? value.split("-") : ["", "", ""];
  const [parts, setParts] = useState({ year: year ?? "", month: month ?? "", day: day ?? "" });
  const thisYear = new Date().getUTCFullYear();
  const set = (patch: Partial<typeof parts>) => {
    const next = { ...parts, ...patch };
    setParts(next);
    if (next.year && next.month && next.day) {
      const days = new Date(Date.UTC(Number(next.year), Number(next.month), 0)).getUTCDate();
      const d = String(Math.min(Number(next.day), days)).padStart(2, "0");
      onChange(`${next.year}-${next.month}-${d}`);
    } else onChange("");
  };
  return (
    <div className="off-field birth-date">
      <span>Date of birth, if known</span>
      <span className="settings-inline">
        <SelectMenu
          label="Day"
          value={parts.day || null}
          width={120}
          options={Array.from({ length: 31 }, (_, n) => ({ id: String(n + 1).padStart(2, "0"), label: String(n + 1) }))}
          onChange={(v) => set({ day: v })}
        />
        <SelectMenu
          label="Month"
          value={parts.month || null}
          width={180}
          options={MONTHS.map((name, n) => ({ id: String(n + 1).padStart(2, "0"), label: name }))}
          onChange={(v) => set({ month: v })}
        />
        <SelectMenu
          label="Year"
          value={parts.year || null}
          width={130}
          options={Array.from({ length: 110 }, (_, n) => ({ id: String(thisYear - n), label: String(thisYear - n) }))}
          onChange={(v) => set({ year: v })}
        />
      </span>
    </div>
  );
}

export function PatientRecordPage() {
  const { id = "" } = useParams();
  const { state } = useSession();
  const { state: directory } = useStaffData();
  const role = state.status === "signed-in" ? roleOf(state.me) : "RECEPTIONIST";
  const [record, setRecord] = useState<PatientRecord | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const rowsBox = useRef<HTMLUListElement>(null);
  const size = useRowsThatFit(rowsBox, { row: ".patient-visit", pitch: 70 });
  const pages = usePages(record?.appointments ?? [], size, id);

  useEffect(() => {
    let live = true;
    setRecord(null);
    api<PatientRecord>(`/patients/${encodeURIComponent(id)}`)
      .then((found) => live && setRecord(found))
      .catch((error: unknown) => live && setFailure(error instanceof Error ? sentence(error.message) : "The record could not be loaded."));
    return () => {
      live = false;
    };
  }, [id]);

  const clinicians = directory.status === "ready" ? directory.data.clinicians : [];
  const clinics = directory.status === "ready" ? directory.data.clinics : [];
  const books = can(role, "appointment.create");
  const scopeNote = { own: "Your visits with them", clinic: "Visits in your unit", tenant: "Every visit at the hospital" };

  return (
    <div className="accounts-page patient-record-page">
      <header className="accounts-top">
        <div className="patient-record-head">
          <Link to="/console/patients" className="square-button" aria-label="Back to patients">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <h1>{record ? fullName(record) : "Patient"}</h1>
            <p>{record ? [record.patientNumber, age(record.dateOfBirth)].filter(Boolean).join(" · ") : "Loading the record"}</p>
          </div>
        </div>
        {books && record && (
          <Link to={`/console/book?patient=${record.patientProfileId}`} className="staff-primary accounts-new">
            <Calendar size={16} />
            Book a visit
          </Link>
        )}
      </header>

      {failure && <Notice tone="error">{failure}</Notice>}

      {!record ? (
        !failure && <LoadingPane label="Loading the record" />
      ) : (
        <div className="availability-cols patient-record-cols">
          <section className="glass availability-card" aria-labelledby="contact-title">
            <h2 id="contact-title">Contact</h2>
            <dl className="patient-facts">
              <dt>Mobile</dt>
              <dd>
                {phoneShown(record.phoneE164)}
                <span className={`chip ${record.phoneVerified ? "chip-confirmed" : "chip-neutral"}`}>
                  {record.phoneVerified ? "Verified" : "Not verified"}
                </span>
              </dd>
              <dt>Email</dt>
              <dd>
                {record.email ?? "None"}
                {record.email && (
                  <span className={`chip ${record.emailVerified ? "chip-confirmed" : "chip-neutral"}`}>
                    {record.emailVerified ? "Verified" : "Not verified"}
                  </span>
                )}
              </dd>
              <dt>Date of birth</dt>
              <dd>{record.dateOfBirth ? clock.long(`${record.dateOfBirth}T12:00:00Z`) : "Not given"}</dd>
              <dt>Messages in</dt>
              <dd>{record.preferredLanguage ? languageName(record.preferredLanguage) : "Not chosen"}</dd>
              <dt>Account</dt>
              <dd>
                {record.hasAccount ? "Signs in to Atria" : "No account yet"}
                <span className="chip chip-booked">{record.source === "DESK" ? "Registered at the desk" : "Registered online"}</span>
              </dd>
            </dl>
            <p className="accounts-banner patient-privacy">
              <Shield size={16} />
              Care context, what a patient sends ahead of a visit, is never shown here. This record's opening is in the audit log.
            </p>
          </section>

          <section className="glass availability-card patient-visits" aria-labelledby="visits-title">
            <div className="availability-head">
              <h2 id="visits-title">Visits</h2>
              <span className="accounts-count">{scopeNote[record.visitScope]}</span>
            </div>
            <ul ref={rowsBox} className="accounts-rows">
              {record.appointments.length ? (
                pages.shown.map((visit, index) => {
                  const clinician = clinicians.find((c) => c.clinicianProfileId === visit.clinicianProfileId);
                  const shown = staffState(visit.state);
                  return (
                    <li key={visit.appointmentId} className="account-row patient-visit" style={{ "--i": index } as CSSProperties}>
                      <Link to={`/console/visits/${visit.appointmentId}`} className="patient-link">
                        <span className="account-text">
                          <span className="account-name">
                            {clock.day(visit.startAt)}, {clock.time(visit.startAt)}
                          </span>
                          <span className="account-sub">
                            {[doctor(clinician), clinics.find((c) => c.clinicId === visit.clinicId)?.name, CHANNEL[visit.channel ?? ""]]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <span className={`chip chip-${shown.tone}`}>{shown.label}</span>
                        <span className="patient-go" aria-hidden="true">
                          <ChevronRight size={16} />
                        </span>
                      </Link>
                    </li>
                  );
                })
              ) : (
                <li className="today-empty">No visits to show.</li>
              )}
            </ul>
            {record.appointments.length > 0 && (
              <Pager
                first={pages.first}
                last={pages.last}
                total={pages.total}
                page={pages.page}
                pages={pages.pages}
                onPrevious={pages.previous}
                onNext={pages.next}
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
