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
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api, apiAll, ApiError } from "../api/client";
import { type CountryCode, HOME_COUNTRY, isMobile, normalisePhone } from "../auth/phone";
import { useSession } from "../auth/session";
import { BirthDateField, birthDate } from "../components/BirthDateField";
import { Checkbox, Field, Notice } from "../components/controls";
import { ArrowLeft, Calendar, ChevronRight, Close, Plus, Search, Shield, Trash, Undo, Upload, User } from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { LoadingPane } from "../components/LoadingPane";
import { LoadingRow } from "../components/LoadingPane";
import { PhoneField } from "../components/PhoneField";
import { Pager, usePages, useRowsThatFit } from "../components/Pager";
import { SelectMenu } from "../components/Pickers";
import { MATRIX } from "../generated/permissions";
import { clock, initials, type Appointment } from "../patient/data";
import { clinicianBooks, doctor, roleOf, useStaffData } from "./data";
import { BatchRestoreDialog, DeleteAccountDialog, daysLeft, RestoreDialog } from "../components/DeleteAccountDialog";
import { CHANNEL, sentence, staffState } from "./labels";
import { Snackbar } from "./Snackbar";
import { forEach, SelectBox, SelectionBar, useSelection } from "../components/Selection";
import { BatchPatientImport } from "./BatchPatientImport";

export interface RegisterEntry {
  patientProfileId: string;
  givenName: string | null;
  familyName: string | null;
  phoneE164: string | null;
  patientNumber: string | null;
  dateOfBirth: string | null;
  /** Deleted and waiting out its 30 days (the administrator sees these). */
  deletionPurgeAt?: string | null;
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

/** Whether the signed-in staff member books visits: see clinicianBooks. */
export function useBooks(): boolean {
  const { state } = useSession();
  const { state: directory } = useStaffData();
  if (state.status !== "signed-in") return false;
  const role = roleOf(state.me);
  if (!can(role, "appointment.create")) return false;
  return role !== "CLINICIAN" || (directory.status === "ready" && clinicianBooks(directory.data.types, state.me.clinicId));
}

/**
 * Searched as the desk types, a beat after they pause. With `everyone`, no
 * search lists the whole register, newest first (2026-09-28).
 */
export function useRegisterSearch(
  query: string,
  { everyone = false, fresh = 0, sort = "date_desc" }: { everyone?: boolean; fresh?: number; sort?: string } = {},
) {
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
    const sortParam = `sort=${encodeURIComponent(sort)}`;
    const later = window.setTimeout(() => {
      (listing
        ? apiAll<{ results: RegisterEntry[]; nextCursor?: string | null }>(`/patients?${sortParam}`, "results")
        : api<{ results: RegisterEntry[] }>(`/patients?q=${encodeURIComponent(words)}&${sortParam}`)
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
  }, [query, everyone, fresh, sort]);
  return { results, busy, failure };
}

export function Patients() {
  const { state } = useSession();
  const role = state.status === "signed-in" ? roleOf(state.me) : "RECEPTIONIST";
  const books = useBooks();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"date_desc" | "date_asc" | "name_asc" | "name_desc">("date_desc");
  const [fresh, setFresh] = useState(0);
  const { results, busy, failure } = useRegisterSearch(query, { everyone: true, fresh, sort });
  const [adding, setAdding] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const rowsBox = useRef<HTMLUListElement>(null);
  const size = useRowsThatFit(rowsBox, { row: ".patient-row", pitch: 76 });
  const pages = usePages(results ?? [], size, `${query}|${sort}`);
  const creates = can(role, "patient.create");
  // An administrator may delete patients' accounts, several at once from the
  // page shown; deleted ones wait out their 30 days and can be restored.
  const deletes = role === "TENANT_ADMIN";
  const [batch, setBatch] = useState(false);
  const [batchRestore, setBatchRestore] = useState(false);
  const [batchImporting, setBatchImporting] = useState(false);
  const selectable = deletes ? pages.shown.map((p) => p.patientProfileId) : [];
  const selection = useSelection(selectable, `${pages.page}|${query}|${sort}`);
  const selectedPatients = pages.shown.filter((p) => selection.has(p.patientProfileId));
  const hasActiveSelected = selectedPatients.some((p) => !p.deletionPurgeAt);
  const hasDeletedSelected = selectedPatients.some((p) => p.deletionPurgeAt);

  return (
    <div className="accounts-page patients-page">
      <header className="accounts-top">
        <div>
          <h1>Patients</h1>
          <p>The hospital's register. Search by name, mobile number or patient number.</p>
        </div>
        {creates && (
          <div className="accounts-actions">
            {role === "TENANT_ADMIN" && (
              <button type="button" className="outline-button accounts-new" onClick={() => setBatchImporting(true)}>
                <Upload size={16} />
                Import Excel
              </button>
            )}
            <button type="button" className="staff-primary accounts-new" onClick={() => setAdding(true)}>
              <Plus size={16} />
              New patient
            </button>
          </div>
        )}
      </header>

      <div className="patients-tools">
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
        <SelectMenu
          label="Sort by"
          value={sort}
          options={[
            { id: "date_desc", label: "Newest first" },
            { id: "date_asc", label: "Oldest first" },
            { id: "name_asc", label: "Name (A to Z)" },
            { id: "name_desc", label: "Name (Z to A)" },
          ]}
          onChange={(val) => setSort(val as "date_desc" | "date_asc" | "name_asc" | "name_desc")}
          width={180}
        />
        {/* Beside the search, so the list keeps its height and its page. */}
        <SelectionBar
          count={selection.count}
          noun={["patient", "patients"]}
          onDelete={hasActiveSelected && !hasDeletedSelected ? () => setBatch(true) : undefined}
          onRestore={hasDeletedSelected && !hasActiveSelected ? () => setBatchRestore(true) : undefined}
          onClear={selection.clear}
        />
      </div>

      <section className="glass accounts-card" aria-label="Patients found">
        {failure && <Notice tone="error">{failure}</Notice>}
        <div className={`accounts-head patients-head${deletes ? " patients-head-select" : ""}`}>
          {deletes ? (
            <span className="accounts-head-first">
              <SelectBox
                checked={selection.all}
                mixed={selection.some}
                label="Select every patient on this page"
                disabled={!selectable.length}
                onChange={selection.toggleAll}
              />
              <button
                type="button"
                className="accounts-head-sort-btn"
                onClick={() => setSort((s) => (s === "name_asc" ? "name_desc" : "name_asc"))}
                title="Sort by patient name"
              >
                PATIENT {sort === "name_asc" ? "↑" : sort === "name_desc" ? "↓" : ""}
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="accounts-head-sort-btn"
              onClick={() => setSort((s) => (s === "name_asc" ? "name_desc" : "name_asc"))}
              title="Sort by patient name"
            >
              PATIENT {sort === "name_asc" ? "↑" : sort === "name_desc" ? "↓" : ""}
            </button>
          )}
          <span aria-hidden="true">MOBILE</span>
          <span aria-hidden="true">AGE</span>
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
              <li
                key={p.patientProfileId}
                className={`account-row patient-row${deletes ? " patient-row-select" : ""}${selection.has(p.patientProfileId) ? " account-row-chosen" : ""}`}
                style={{ "--i": index } as CSSProperties}
              >
                {deletes &&
                  (selectable.includes(p.patientProfileId) ? (
                    <SelectBox checked={selection.has(p.patientProfileId)} label={`Select ${fullName(p)}`} onChange={() => selection.toggle(p.patientProfileId)} />
                  ) : (
                    <span className="select-box-space" aria-hidden="true" />
                  ))}
                <Link to={`/console/patients/${p.patientProfileId}`} className="patient-link">
                  <span className="account-who">
                    <span className="account-avatar" aria-hidden="true">
                      {initials(p.givenName, p.familyName) || "?"}
                    </span>
                    <span className="account-text">
                      <span className="account-name">{fullName(p)}</span>
                      <span className="account-sub">
                        {p.patientNumber ?? "No patient number"}
                        {p.deletionPurgeAt && <span className="chip chip-cancelled patient-deleted">Deleted · {daysLeft(p.deletionPurgeAt)} days</span>}
                      </span>
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
          books={books}
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
      {batch && (
        <DeleteAccountDialog
          title={`Delete ${selectedPatients.filter((p) => !p.deletionPurgeAt).length} ${selectedPatients.filter((p) => !p.deletionPurgeAt).length === 1 ? "patient's account" : "patients' accounts"}?`}
          lede="Each is signed out and cannot sign in, and receptionists no longer find them."
          points={[
            "Their upcoming visits are cancelled by the institution, so they keep a full refund.",
            "Each can be restored from their record for 30 days.",
            "After 30 days their details and sign-ins are erased; past visits stay without their names.",
          ]}
          confirmLabel={`Delete ${selectedPatients.filter((p) => !p.deletionPurgeAt).length} ${selectedPatients.filter((p) => !p.deletionPurgeAt).length === 1 ? "account" : "accounts"}`}
          onClose={() => setBatch(false)}
          onConfirm={async () => {
            const activeIds = selectedPatients.filter((p) => !p.deletionPurgeAt).map((p) => p.patientProfileId);
            const result = await forEach(activeIds, (id) =>
              api(`/admin/patients/${encodeURIComponent(id)}`, { method: "DELETE" }),
            );
            setBatch(false);
            selection.clear();
            setFresh((n) => n + 1);
            setSaid(
              result.failed
                ? `${result.done} deleted; ${result.failed} could not be. Upcoming visits were cancelled.`
                : `${result.done} ${result.done === 1 ? "account" : "accounts"} deleted. Upcoming visits were cancelled.`,
            );
          }}
        />
      )}
      {batchRestore && (
        <BatchRestoreDialog
          count={selectedPatients.filter((p) => p.deletionPurgeAt).length}
          noun="patient"
          onClose={() => setBatchRestore(false)}
          onConfirm={async () => {
            const deletedIds = selectedPatients.filter((p) => p.deletionPurgeAt).map((p) => p.patientProfileId);
            const result = await forEach(deletedIds, (id) =>
              api(`/admin/patients/${encodeURIComponent(id)}/restore`, { method: "POST" }),
            );
            setBatchRestore(false);
            selection.clear();
            setFresh((n) => n + 1);
            setSaid(
              result.failed
                ? `${result.done} restored; ${result.failed} could not be.`
                : `${result.done} ${result.done === 1 ? "patient" : "patients"} restored. They can sign in and book again.`,
            );
          }}
        />
      )}
      {batchImporting && (
        <BatchPatientImport
          onClose={() => setBatchImporting(false)}
          onDone={(count) => {
            setBatchImporting(false);
            setFresh((n) => n + 1);
            setSaid(`${count} ${count === 1 ? "patient" : "patients"} registered.`);
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
  books = true,
  onClose,
  onDone,
}: {
  start?: string;
  /** False for a clinician who books no one: the record is saved, not booked. */
  books?: boolean;
  onClose: () => void;
  onDone: (made: RegisterEntry, book: boolean) => void;
}) {
  const guess = /\d/.test(start) ? { name: "", phone: start } : { name: start.trim(), phone: "" };
  const [given, setGiven] = useState(guess.name.split(" ")[0] ?? "");
  const [family, setFamily] = useState(guess.name.split(" ").slice(1).join(" "));
  const [phone, setPhone] = useState(guess.phone);
  const [country, setCountry] = useState<CountryCode>(HOME_COUNTRY);
  const [bornText, setBornText] = useState("");
  const born = birthDate(bornText);
  const [shared, setShared] = useState<RegisterEntry[] | null>(null);
  const [sameNumber, setSameNumber] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

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
          phoneE164: normalisePhone(phone, country),
          ...(born ? { dateOfBirth: born } : {}),
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

  const bornWrong = Boolean(bornText.trim()) && !born;
  const ready = given.trim() && family.trim() && isMobile(normalisePhone(phone, country)) && !bornWrong && (!shared || sameNumber);

  return createPortal(
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div
        className="dialog staff-dialog move-dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-patient-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="move-scroll">
          <button type="button" className="icon-button dialog-close" aria-label="Close" onClick={onClose} disabled={busy}>
            <Close size={16} />
          </button>
          <span className="dialog-icon dialog-icon-blue" aria-hidden="true">
            <User size={22} />
          </span>
          <h2 id="new-patient-title">New patient</h2>
          <p className="dialog-lede">
            A minimal record, with a patient number, so they can be booked now. They can create an account later with the same mobile
            number.
          </p>
          <form id="new-patient-form" className="settings-dialog-form" onSubmit={(event) => void submit(event, books)}>
            <div className="off-fields">
              <Field label="Given name" value={given} maxLength={60} onChange={(e) => setGiven(e.target.value)} />
              <Field label="Family name" value={family} maxLength={60} onChange={(e) => setFamily(e.target.value)} />
            </div>
            <PhoneField
              label="Mobile number"
              hint="Reminders go here by SMS."
              value={phone}
              country={country}
              onCountry={setCountry}
              onChange={(next) => {
                setPhone(next);
                setShared(null);
                setSameNumber(false);
              }}
            />
            <BirthDateField
              label="Date of birth, if known"
              value={bornText}
              onChange={setBornText}
              error={bornWrong ? "Enter a real date of birth, such as 02/04/1990, or leave it empty." : undefined}
            />
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
          {books && (
            <button type="button" className="outline-button keep" disabled={busy || !ready} onClick={(event) => void submit(event, false)}>
              Save only
            </button>
          )}
          <button type="submit" form="new-patient-form" className="staff-primary" disabled={busy || !ready} aria-busy={busy || undefined}>
            {busy ? <LoadingIndicator size={20} label="Saving" /> : null}
            {busy ? "Saving" : books ? "Save and book" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function PatientRecordPage() {
  const { id = "" } = useParams();
  const { state } = useSession();
  const { state: directory } = useStaffData();
  const role = state.status === "signed-in" ? roleOf(state.me) : "RECEPTIONIST";
  const [record, setRecord] = useState<PatientRecord | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
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
  const books = useBooks();
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
        {books && record && !record.deletionPurgeAt && (
          <Link to={`/console/book?patient=${record.patientProfileId}`} className="staff-primary accounts-new">
            <Calendar size={16} />
            Book a visit
          </Link>
        )}
        {role === "TENANT_ADMIN" && record && (
          record.deletionPurgeAt ? (
            <button type="button" className="staff-primary accounts-new" onClick={() => setRestoring(true)}>
              <Undo size={16} />
              Restore account
            </button>
          ) : (
            <button type="button" className="outline-danger accounts-new" onClick={() => setDeleting(true)}>
              <Trash size={16} />
              Delete account
            </button>
          )
        )}
      </header>
      {record?.deletionPurgeAt && (
        <Notice tone="error">
          This account is deleted. It is erased in {daysLeft(record.deletionPurgeAt)} days unless you restore it.
        </Notice>
      )}
      {said && <Notice tone="success">{said}</Notice>}
      {deleting && record && (
        <DeleteAccountDialog
          title={`Delete ${fullName(record)}'s account?`}
          lede="They are signed out and cannot sign in, and receptionists no longer find them."
          points={[
            "Their upcoming visits are cancelled by the institution, so they keep a full refund.",
            "You can restore the account here for 30 days.",
            "After 30 days their details and sign-in are erased; past visits stay without their name.",
          ]}
          confirmLabel="Delete account"
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            const done = await api<{ purgeAt: string }>(`/admin/patients/${encodeURIComponent(record.patientProfileId)}`, { method: "DELETE" });
            setDeleting(false);
            setRecord({ ...record, deletionPurgeAt: done.purgeAt });
            setSaid("Account deleted. Upcoming visits were cancelled.");
          }}
        />
      )}
      {restoring && record && (
        <RestoreDialog
          name={`${fullName(record)}'s account`}
          onClose={() => setRestoring(false)}
          onConfirm={async () => {
            await api(`/admin/patients/${encodeURIComponent(record.patientProfileId)}/restore`, { method: "POST" });
            setRestoring(false);
            setRecord({ ...record, deletionPurgeAt: null });
            setSaid("Account restored. They can sign in and book again.");
          }}
        />
      )}

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
