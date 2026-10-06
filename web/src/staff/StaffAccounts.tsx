/**
 * Staff accounts, and "Admin · Create staff account" (103:2): a tenant
 * administrator creates an account with its role and a temporary password
 * (FR-ACC-03, FR-ACC-04). Only an administrator reaches this; the API
 * decides that too (staff.create).
 *
 * The list is "Admin · Staff accounts" (94:2), from GET /admin/staff: each
 * account with its group, status and role, and the two actions Phase 1 has on
 * an account, changing its role (FR-ACC-18) and suspending it. The API
 * searches, filters and pages it (NFR-PERF-04), so the console asks for one
 * page at a time, as many rows as the card holds; the search bar guesses people, roles, clinics and
 * statuses as the administrator types. Last sign-in is not recorded in Phase 1, so that column
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

import { type CSSProperties, type FormEvent, Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Navigate, useLocation } from "react-router-dom";

import { api } from "../api/client";
import { type CountryCode, HOME_COUNTRY, PACK, normalisePhone } from "../auth/phone";
import { useSession } from "../auth/session";
import { Field, Notice } from "../components/controls";
import { LoadingRow } from "../components/LoadingPane";
import { ChipRow, FilterMenu, type FilterOption } from "../components/FilterMenu";
import { Building, CheckMark, Clipboard, Close, Download, Filter, Info, Key, Lock, Plus, Repeat, Shield, Star, Trash, Undo, Upload, User } from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { Pager } from "../components/Pager";
import { SelectMenu } from "../components/Pickers";
import { PhoneField } from "../components/PhoneField";
import { SearchSuggest, type SuggestionGroup } from "../components/SearchSuggest";
import { MATRIX, REQUIRED_ON_CREATE, type Role } from "../generated/permissions";
import { useTier } from "../layout/fit";
import { initials } from "../patient/data";
import { roleOf, useStaffData } from "./data";
import { phoneShown } from "./Patients";
import { BatchRestoreDialog, DeleteAccountDialog, daysLeft, RestoreDialog } from "../components/DeleteAccountDialog";
import { sentence } from "./labels";
import { Snackbar } from "./Snackbar";
import { forEach, SelectBox, SelectionBar, useSelection } from "../components/Selection";
import { BatchStaffImport } from "./BatchStaffImport";
import { downloadBatchStaffPdf, downloadSingleStaffPdf, type StaffCredential } from "../utils/credentialPdf";

type StaffRole = Exclude<Role, "PATIENT">;

const ROLES: { role: StaffRole; label: string; about: string }[] = [
  { role: "RECEPTIONIST", label: "Receptionist", about: "Books, checks in and runs the day. No care context." },
  { role: "CLINICIAN", label: "Clinician", about: "Own list and queue, and their own patients' care context." },
  { role: "CLINIC_MANAGER", label: "Unit manager", about: "Receptionist, plus the rota, reporting and audit." },
  { role: "TENANT_ADMIN", label: "Tenant administrator", about: "Accounts, settings, fees and policy. No care context." },
];

/** What the role may do, in the frame's words, read from the permission matrix. */
function allowances(role: StaffRole): { text: string; yes: boolean }[] {
  const read = MATRIX["appointment.read"][role];
  return [
    {
      text: read === "own" ? "View their own calendar" : read === "tenant" ? "View every unit's schedule" : "View and manage the unit's schedule",
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
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "DELETION_PENDING" | "ENDED";
  mustSetPassword: boolean | null;
  /** Deleted and waiting out its 30 days: when it becomes final. */
  purgeAt?: string | null;
  /** The only staff priority there is: explicit, monthly, and shown with its usage (FR-STF-13). */
  priorityAllowance?: { quotaPerMonth: number; usedThisMonth: number } | null;
}

type Status = "awaiting" | "active" | "suspended" | "deleted";

const STATUS_NAME: Record<Status, string> = {
  awaiting: "Awaiting first sign-in",
  active: "Active",
  suspended: "Suspended",
  deleted: "Deleted",
};

interface Page {
  count: number;
  total: number;
  accounts: Listed[];
  nextCursor: string | null;
  facets: { roles: Record<string, number>; clinics: Record<string, number>; status: Record<string, number> };
}

/**
 * Accounts a page on a phone, where the page scrolls anyway. Wider, a page is
 * as many rows as the card holds, so the list never scrolls and the pager is
 * always in view. Either way well inside the API's 50 (NFR-PERF-04).
 */
const PAGE_SIZE = 10;
/** A row's height and the gap under it, until a row is there to measure. */
const ROW_PITCH = 76;

/** Most accounts first, as the filter row and menu offer them. */
const byCount = (counts: Record<string, number>, label: (id: string) => string): FilterOption[] =>
  Object.entries(counts)
    .sort(([a, x], [b, y]) => y - x || label(a).localeCompare(label(b)))
    .map(([id, count]) => ({ id, label: label(id), count }));

const ROLE_NAME: Record<StaffRole, string> = {
  RECEPTIONIST: "Receptionist",
  CLINICIAN: "Clinician",
  CLINIC_MANAGER: "Unit manager",
  TENANT_ADMIN: "Administrator",
};

/** Roles an account can move between without new details: both work at one clinic and need nothing more. */
const INTERCHANGEABLE: StaffRole[] = ["RECEPTIONIST", "CLINIC_MANAGER"];

export function StaffAccounts() {
  const { state } = useSession();
  const { state: directory } = useStaffData();
  // The page shown, with where it sits in the list, and whether the next one is on its way.
  const [page, setPage] = useState<(Page & { at: number }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [fresh, setFresh] = useState(0);
  const [query, setQuery] = useState("");
  const [words, setWords] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [clinic, setClinic] = useState<string | null>(null);
  const [sort, setSort] = useState<"name_asc" | "name_desc" | "date_desc" | "date_asc">("name_asc");
  // The cursor of each page reached so far, so Previous can go back.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [menuOpen, setMenuOpen] = useState(false);
  const filterButton = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  // The overview's "Create account" arrives with ?create=1 and opens the form.
  const [creating, setCreating] = useState(() => new URLSearchParams(location.search).get("create") === "1");
  const [changing, setChanging] = useState<Listed | null>(null);
  const [suspending, setSuspending] = useState<Listed | null>(null);
  const [deleting, setDeleting] = useState<Listed | null>(null);
  const [restoring, setRestoring] = useState<Listed | null>(null);
  const [granting, setGranting] = useState<Listed | null>(null);
  // Accounts being given a new temporary password: one from its row, or a selection.
  const [issuing, setIssuing] = useState<Listed[] | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const admin = state.status === "signed-in" && roleOf(state.me) === "TENANT_ADMIN";
  const phone = useTier() === "mobile";
  const rowsBox = useRef<HTMLUListElement>(null);
  const [pageSize, setPageSize] = useState<number | null>(null);
  // Rows chosen for a batch delete or restore.
  const [batch, setBatch] = useState(false);
  const [batchRestore, setBatchRestore] = useState(false);
  const [batchImporting, setBatchImporting] = useState(false);
  const selectable = (page?.accounts ?? [])
    .filter((a) => !(state.status === "signed-in" && state.me.staffId === a.staffId))
    .map((a) => a.staffId);
  const selection = useSelection(selectable, `${cursors.length}|${words}|${status}|${role}|${clinic}|${sort}`);

  // How many rows the card holds, measured before the first page is asked for.
  useLayoutEffect(() => {
    if (phone) {
      setPageSize(PAGE_SIZE);
      return;
    }
    const box = rowsBox.current;
    if (!box) return;
    const measure = () => {
      // Nothing laid out (a test, say): the phone's page length will do.
      if (!box.clientHeight) {
        setPageSize(PAGE_SIZE);
        return;
      }
      const row = box.querySelector<HTMLElement>(".account-row");
      const pitch = row ? row.offsetHeight + 8 : ROW_PITCH;
      setPageSize(Math.max(3, Math.min(50, Math.floor((box.clientHeight + 8) / pitch))));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [phone, admin]);

  // Search as the administrator types, a beat after they pause.
  useEffect(() => {
    const later = window.setTimeout(() => setWords(query.trim()), 220);
    return () => window.clearTimeout(later);
  }, [query]);
  // A new search, filter, sort or page length starts again at the first page.
  useEffect(() => setCursors([null]), [words, status, role, clinic, sort, pageSize]);

  useEffect(() => {
    if (!admin || !pageSize) return;
    let live = true;
    const ask = new URLSearchParams({ limit: String(pageSize) });
    if (words) ask.set("q", words);
    if (status) ask.set("status", status);
    if (role) ask.set("role", role);
    if (clinic) ask.set("clinic", clinic);
    if (sort && sort !== "name_asc") ask.set("sort", sort);
    const cursor = cursors[cursors.length - 1];
    if (cursor) ask.set("cursor", cursor);
    setLoading(true);
    api<Page>(`/admin/staff?${ask}`)
      .then((found) => {
        if (!live) return;
        setPage({ ...found, at: cursors.length - 1 });
        setFailure(null);
      })
      .catch((error: unknown) => live && setFailure(error instanceof Error ? sentence(error.message) : "The accounts could not be loaded."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [admin, fresh, words, status, role, clinic, sort, cursors, pageSize]);

  if (state.status !== "signed-in") return null;
  if (!admin) return <Navigate to="/console" replace />;

  const clinics = directory.status === "ready" ? directory.data.clinics : [];
  const clinicName = (id: string | null) => clinics.find((c) => c.clinicId === id)?.name;
  const facets = page?.facets ?? { roles: {}, clinics: {}, status: {} };
  const statusOptions = byCount(facets.status, (id) => STATUS_NAME[id as Status] ?? id);
  const roleOptions = byCount(facets.roles, (id) => ROLE_NAME[id as StaffRole] ?? id);
  const clinicOptions = byCount(facets.clinics, (id) => clinicName(id) ?? "Another unit");
  const awaiting = facets.status.awaiting ?? 0;
  const accounts = page?.accounts ?? [];
  const chosenAccounts = accounts.filter((a) => selection.has(a.staffId));
  const hasDeleted = chosenAccounts.some((a) => a.status === "DELETION_PENDING");
  const hasNonDeleted = chosenAccounts.some((a) => a.status !== "DELETION_PENDING");
  const canBatchDelete = selection.count > 0 && hasNonDeleted && !hasDeleted;
  const canBatchRestore = selection.count > 0 && hasDeleted && !hasNonDeleted;
  // A new temporary password is for an account that can sign in: not one
  // suspended or being deleted.
  const passwordable = chosenAccounts.filter((a) => a.status === "INVITED" || a.status === "ACTIVE");
  const size = pageSize ?? PAGE_SIZE;
  const first = (page?.at ?? 0) * size + 1;
  const pages = page ? Math.max(1, Math.ceil(page.count / size)) : 1;
  const menuFilters = [role, clinic].filter(Boolean).length;
  const done = (message: string) => {
    setSaid(message);
    setFresh((n) => n + 1);
  };
  const clearSearch = () => {
    setQuery("");
    setWords("");
  };

  // What the search bar guesses from: the people the search finds, and every filter it could mean.
  const suggestions: SuggestionGroup[] = [
    {
      id: "people",
      label: "People",
      icon: User,
      items: words && words === query.trim()
        ? accounts.slice(0, 4).map((a) => {
            const name = [a.givenName, a.familyName].filter(Boolean).join(" ") || "Unnamed account";
            return {
              id: a.staffId,
              label: name,
              hint: [a.roles.map((r) => ROLE_NAME[r] ?? r).join(", "), a.signInName].filter(Boolean).join(" · "),
              also: [a.signInName ?? ""],
              onPick: () => setQuery(name),
            };
          })
        : [],
    },
    {
      id: "roles",
      label: "Roles",
      icon: Shield,
      items: roleOptions.map((o) => ({
        id: o.id,
        label: o.label,
        hint: `${o.count} ${o.count === 1 ? "account" : "accounts"}`,
        also: [ROLES.find((r) => r.role === o.id)?.label ?? ""],
        onPick: () => {
          clearSearch();
          setRole(o.id);
        },
      })),
    },
    {
      id: "clinics",
      label: "Units",
      icon: Building,
      items: clinicOptions.map((o) => ({
        id: o.id,
        label: o.label,
        hint: `${o.count} ${o.count === 1 ? "account" : "accounts"}`,
        onPick: () => {
          clearSearch();
          setClinic(o.id);
        },
      })),
    },
    {
      id: "status",
      label: "Status",
      icon: Info,
      items: statusOptions.map((o) => ({
        id: o.id,
        label: o.label,
        hint: `${o.count} ${o.count === 1 ? "account" : "accounts"}`,
        onPick: () => {
          clearSearch();
          setStatus(o.id);
        },
      })),
    },
  ];

  return (
    <div className="accounts-page">
      <header className="accounts-top">
        <div>
          <h1>Staff accounts</h1>
          <p>Everyone who can sign in to the staff console</p>
        </div>
        <div className="accounts-actions">
          <button type="button" className="outline-button accounts-new" onClick={() => setBatchImporting(true)}>
            <Upload size={16} />
            Import Excel
          </button>
          <button type="button" className="staff-primary accounts-new" onClick={() => setCreating(true)}>
            <Plus size={16} />
            Create staff account
          </button>
        </div>
      </header>

      <div className="accounts-tools">
        <SearchSuggest
          className="find-search accounts-search"
          label="Search accounts"
          placeholder="Search by name, email, mobile or role"
          value={query}
          onChange={setQuery}
          groups={suggestions}
          trailing={
            <button
              ref={filterButton}
              type="button"
              className={`filter-button${menuOpen || menuFilters ? " filter-on" : ""}`}
              aria-label="Filters"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <Filter size={17} />
            </button>
          }
        />
        <div className="accounts-filters">
          <ChipRow
            variant="week"
            label="Show"
            options={statusOptions}
            value={status}
            onChange={setStatus}
            allLabel="All users"
            onMore={() => setMenuOpen(true)}
            moreActive={menuFilters}
            moreAlways
          />
          <div className="accounts-sort-select">
            <SelectMenu
              label="Sort by"
              value={sort}
              width={200}
              options={[
                { id: "name_asc", label: "Name (A to Z)" },
                { id: "name_desc", label: "Name (Z to A)" },
                { id: "date_desc", label: "Creation date (Newest)" },
                { id: "date_asc", label: "Creation date (Oldest)" },
              ]}
              onChange={(v) => setSort(v as typeof sort)}
            />
          </div>
          {selection.count ? (
            <SelectionBar
              count={selection.count}
              noun={["account", "accounts"]}
              onDelete={canBatchDelete ? () => setBatch(true) : undefined}
              onRestore={canBatchRestore ? () => setBatchRestore(true) : undefined}
              onClear={selection.clear}
            >
              {passwordable.length > 0 && (
                <button type="button" className="selection-restore" onClick={() => setIssuing(passwordable)}>
                  <Key size={15} />
                  New passwords
                </button>
              )}
            </SelectionBar>
          ) : (
            <span className="accounts-count" aria-live="polite">
              {page ? (page.count === page.total ? `${page.total} users` : `${page.count} of ${page.total} users`) : ""}
            </span>
          )}
        </div>
      </div>
      <FilterMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchor={filterButton}
        title="Filter accounts"
        sections={[
          { id: "status", label: "Status", options: statusOptions, value: status, onChange: setStatus, allLabel: "Any status" },
          { id: "role", label: "Role", options: roleOptions, value: role, onChange: setRole, allLabel: "Any role" },
          { id: "clinic", label: "Unit", options: clinicOptions, value: clinic, onChange: setClinic, allLabel: "Every unit" },
        ]}
        results={page ? (page.count === 1 ? "Show 1 account" : `Show ${page.count} accounts`) : "Show accounts"}
        onClear={() => {
          setStatus(null);
          setRole(null);
          setClinic(null);
        }}
      />

      <section className="glass accounts-card" aria-label="Staff accounts" aria-busy={!page || undefined}>
        {failure && <Notice tone="error">{failure} Check your connection and try again.</Notice>}
        <div className="accounts-head staff-head">
          <span className="accounts-head-first">
            <SelectBox
              checked={selection.all}
              mixed={selection.some}
              label="Select every account on this page"
              disabled={!selectable.length}
              onChange={selection.toggleAll}
            />
            <button
              type="button"
              className={`accounts-head-sort-btn${sort.startsWith("name") ? " sort-active" : ""}`}
              onClick={() => setSort(sort === "name_asc" ? "name_desc" : "name_asc")}
              title="Click to sort alphabetically"
            >
              USER {sort === "name_asc" ? "▲" : sort === "name_desc" ? "▼" : ""}
            </button>
          </span>
          <span aria-hidden="true">GROUP</span>
          <button
            type="button"
            className={`accounts-head-sort-btn${sort.startsWith("date") ? " sort-active" : ""}`}
            onClick={() => setSort(sort === "date_desc" ? "date_asc" : "date_desc")}
            title="Click to sort by creation date"
          >
            ACCOUNT STATUS {sort === "date_desc" ? "▼ (Newest)" : sort === "date_asc" ? "▲ (Oldest)" : ""}
          </button>
          <span aria-hidden="true">ROLE</span>
        </div>
        <ul ref={rowsBox} className={`accounts-rows${loading && page ? " accounts-rows-loading" : ""}`}>
          {!page
            ? [<LoadingRow key="loading" />]
            : accounts.map((account, index) => {
                const deleted = account.status === "DELETION_PENDING";
                const off = deleted || account.status === "SUSPENDED" || account.status === "ENDED";
                const adminRole = account.roles.includes("TENANT_ADMIN");
                const self = state.me.staffId === account.staffId;
                const left = daysLeft(account.purgeAt);
                const shownStatus = deleted
                  ? { label: `Deleted · ${left} ${left === 1 ? "day" : "days"} to restore`, tone: "cancelled" }
                  : off
                  ? { label: "Suspended", tone: "neutral" }
                  : account.mustSetPassword
                    ? { label: STATUS_NAME.awaiting, tone: "awaiting" }
                    : { label: "Active", tone: "confirmed" };
                const name = [account.givenName, account.familyName].filter(Boolean).join(" ") || "Unnamed account";
                return (
                  <li
                    key={account.staffId}
                    className={`account-row staff-row${off ? " account-row-off" : ""}${selection.has(account.staffId) ? " account-row-chosen" : ""}`}
                    style={{ "--i": index } as CSSProperties}
                  >
                    <span className="account-who">
                      {selectable.includes(account.staffId) ? (
                        <SelectBox checked={selection.has(account.staffId)} label={`Select ${name}`} onChange={() => selection.toggle(account.staffId)} />
                      ) : (
                        <span className="select-box-space" aria-hidden="true" />
                      )}
                      <span className={`account-avatar${adminRole ? " account-avatar-admin" : ""}`} aria-hidden="true">
                        {initials(account.givenName, account.familyName) || "?"}
                      </span>
                      <span className="account-text">
                        <span className="account-name">{name}</span>
                        <span className="account-sub">{account.signInName ? (account.signInName.startsWith("+") ? phoneShown(account.signInName) : account.signInName) : "No sign-in name"}</span>
                      </span>
                    </span>
                    <span>
                      <span className={`chip ${adminRole ? "chip-admin" : "chip-booked"}`}>{adminRole ? "ADMIN" : "STAFF"}</span>
                    </span>
                    <span>
                      <span className={`chip chip-${shownStatus.tone}`}>{shownStatus.label}</span>
                    </span>
                    <span className="account-role">
                      <span>{account.roles.map((r) => ROLE_NAME[r] ?? r).join(", ")}</span>
                      <span>
                        {account.priorityAllowance
                          ? `Priority ${account.priorityAllowance.usedThisMonth} of ${account.priorityAllowance.quotaPerMonth} used`
                          : (clinicName(account.clinicId) ?? (adminRole ? "Every unit" : ""))}
                      </span>
                    </span>
                    <span className="account-actions">
                      {deleted ? (
                        <button type="button" className="tonal-button account-restore" onClick={() => setRestoring(account)}>
                          <Undo size={15} />
                          Restore
                        </button>
                      ) : (
                      <>
                      <button
                        type="button"
                        className="square-button"
                        aria-label={`${name}'s priority allowance`}
                        title="Priority allowance"
                        disabled={off || adminRole}
                        onClick={() => setGranting(account)}
                      >
                        <Star size={15} />
                      </button>
                      <button
                        type="button"
                        className="square-button"
                        aria-label={`New temporary password for ${name}`}
                        title="New temporary password"
                        disabled={off || self}
                        onClick={() => setIssuing([account])}
                      >
                        <Key size={15} />
                      </button>
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
                      <button
                        type="button"
                        className="square-button account-suspend"
                        aria-label={`Delete ${name}`}
                        title="Delete"
                        disabled={self}
                        onClick={() => setDeleting(account)}
                      >
                        <Trash size={15} />
                      </button>
                      </>
                      )}
                    </span>
                  </li>
                );
              })}
          {page && !accounts.length && <li className="today-empty">No accounts match.</li>}
        </ul>
        <Pager
          noun="accounts"
          first={first}
          last={first + accounts.length - 1}
          total={page?.count ?? 0}
          page={page?.at ?? 0}
          pages={pages}
          busy={loading}
          hasNext={Boolean(page?.nextCursor)}
          note={
            awaiting > 0
              ? `${awaiting === 1 ? "1 account has" : `${awaiting} accounts have`} a temporary password to replace at first sign-in`
              : undefined
          }
          onPrevious={() => setCursors((c) => c.slice(0, -1))}
          onNext={() => {
            const next = page?.nextCursor;
            if (next) setCursors((c) => [...c, next]);
          }}
        />
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
      {granting && (
        <PriorityAllowance
          account={granting}
          onClose={() => setGranting(null)}
          onDone={(message) => {
            setGranting(null);
            done(message);
          }}
        />
      )}
      {issuing && (
        <IssuePasswords
          accounts={issuing}
          clinics={clinics}
          onClose={() => setIssuing(null)}
          onDone={(message) => {
            setIssuing(null);
            selection.clear();
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
      {deleting && (
        <DeleteAccountDialog
          title={`Delete ${[deleting.givenName, deleting.familyName].filter(Boolean).join(" ") || "this account"}?`}
          lede="They are signed out everywhere and cannot sign in to the console."
          points={[
            "Their roles stop at once; a clinician leaves the directory.",
            "You can restore the account from this list for 30 days.",
            "After 30 days the sign-in and their details are erased.",
          ]}
          confirmLabel="Delete account"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api(`/admin/staff/${encodeURIComponent(deleting.staffId)}`, { method: "DELETE" });
            setDeleting(null);
            done("Account deleted. It can be restored for 30 days.");
          }}
        />
      )}
      {batch && (
        <DeleteAccountDialog
          title={`Delete ${selection.count} ${selection.count === 1 ? "account" : "accounts"}?`}
          lede="Each is signed out everywhere and cannot sign in to the console."
          points={[
            "Their roles stop at once; clinicians leave the directory.",
            "Each can be restored from this list for 30 days.",
            "After 30 days the sign-ins and their details are erased.",
          ]}
          confirmLabel={`Delete ${selection.count} ${selection.count === 1 ? "account" : "accounts"}`}
          onClose={() => setBatch(false)}
          onConfirm={async () => {
            const result = await forEach([...selection.chosen], (id) =>
              api(`/admin/staff/${encodeURIComponent(id)}`, { method: "DELETE" }),
            );
            setBatch(false);
            selection.clear();
            done(
              result.failed
                ? `${result.done} deleted; ${result.failed} could not be. They can be restored for 30 days.`
                : `${result.done} ${result.done === 1 ? "account" : "accounts"} deleted. They can be restored for 30 days.`,
            );
          }}
        />
      )}
      {restoring && (
        <RestoreDialog
          name={[restoring.givenName, restoring.familyName].filter(Boolean).join(" ") || "this account"}
          onClose={() => setRestoring(null)}
          onConfirm={async () => {
            await api(`/admin/staff/${encodeURIComponent(restoring.staffId)}/restore`, { method: "POST" });
            setRestoring(null);
            done("Account restored. They can sign in again.");
          }}
        />
      )}
      {batchRestore && (
        <BatchRestoreDialog
          count={selection.count}
          noun="account"
          onClose={() => setBatchRestore(false)}
          onConfirm={async () => {
            const result = await forEach([...selection.chosen], (id) =>
              api(`/admin/staff/${encodeURIComponent(id)}/restore`, { method: "POST" }),
            );
            setBatchRestore(false);
            selection.clear();
            done(
              result.failed
                ? `${result.done} restored; ${result.failed} could not be.`
                : `${result.done} ${result.done === 1 ? "account" : "accounts"} restored. They can sign in again.`,
            );
          }}
        />
      )}
      {batchImporting && (
        <BatchStaffImport
          onClose={() => setBatchImporting(false)}
          onDone={(count) => {
            setBatchImporting(false);
            done(`${count} ${count === 1 ? "staff account" : "staff accounts"} created.`);
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

  return createPortal(
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
                {busy ? <LoadingIndicator size={20} label="Saving" /> : null}
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
    </div>,
    document.body,
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

  return createPortal(
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="suspend-title" onClick={(e) => e.stopPropagation()}>
        <span className="dialog-icon" aria-hidden="true">
          <Lock size={22} />
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
    </div>,
    document.body,
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
  const [country, setCountry] = useState<CountryCode>(HOME_COUNTRY);
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
    const phone = normalisePhone(form.phone, country);
    if (!form.givenName.trim()) found.givenName = "Enter their given name.";
    if (!form.familyName.trim()) found.familyName = "Enter their family name.";
    if (!E164.test(phone)) found.phone = `Enter their mobile with its country code, such as ${PACK.dialCode ?? "+237"} 6 70 00 00 00.`;
    if (needs.has("email") && !form.email.trim()) found.email = "An administrator signs in with an email address. Enter theirs.";
    else if (form.email.trim() && !EMAIL.test(form.email.trim())) found.email = "That is not an email address. Check it and try again.";
    if (needs.has("clinicId") && !form.clinicId) found.clinicId = "Choose the unit they work in.";
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
      phoneE164: normalisePhone(form.phone, country),
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

  return createPortal(
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
                The temporary password works for 7 days. At first sign-in they choose their own, on the staff sign-in
                page.
              </Notice>
            </div>
            <footer className="sheet-foot">
              <span>Creating the account was logged against your admin user.</span>
              <button
                type="button"
                className="outline-button"
                onClick={() => {
                  downloadSingleStaffPdf({
                    name,
                    role: ROLE_NAME[role] ?? role,
                    unit: clinics.find((c) => c.clinicId === form.clinicId)?.name ?? "All units",
                    signInName: created.signInName,
                    temporaryPassword: created.temporaryPassword,
                    email: form.email || null,
                    phone: form.phone || null,
                  });
                }}
              >
                <Download size={16} />
                Download credentials (PDF)
              </button>
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
                <PhoneField
                  label="Mobile"
                  value={form.phone}
                  onChange={(phone) => setForm((current) => ({ ...current, phone }))}
                  country={country}
                  onCountry={setCountry}
                  error={errors.phone}
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
                    <span className="field-label">Unit</span>
                    <SelectMenu
                      label="Unit"
                      placeholder="Choose a unit"
                      value={form.clinicId || null}
                      width={340}
                      className={`field-select${errors.clinicId ? " select-invalid" : ""}`}
                      options={clinics.map((clinic) => ({ id: clinic.clinicId, label: clinic.name }))}
                      onChange={(id) => set("clinicId")({ target: { value: id } })}
                    />
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
    </div>,
    document.body,
  );
}

/**
 * A fresh temporary password for one account or a selection: for a first one
 * that expired before it was used (the pool then refuses it for good), or a
 * colleague who forgot theirs (2026-10-06). Each is shown once, here, with the
 * same credentials sheet as a new account.
 */
function IssuePasswords({
  accounts,
  clinics,
  onClose,
  onDone,
}: {
  accounts: Listed[];
  clinics: { clinicId: string; name: string }[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [issued, setIssued] = useState<StaffCredential[] | null>(null);
  const [missed, setMissed] = useState(0);
  const nameOf = (a: Pick<Listed, "givenName" | "familyName">) => [a.givenName, a.familyName].filter(Boolean).join(" ") || "Unnamed account";
  const one = accounts.length === 1 ? accounts[0] : undefined;

  async function issue() {
    setBusy(true);
    setFailure(null);
    const made: StaffCredential[] = [];
    let failed = 0;
    for (const account of accounts) {
      try {
        const got = await api<Created & { email: string | null; phoneE164: string | null }>(
          `/admin/staff/${account.staffId}/temporary-password`,
          { method: "POST" },
        );
        made.push({
          name: nameOf(account),
          role: account.roles.map((r) => ROLE_NAME[r] ?? r).join(", "),
          unit: clinics.find((c) => c.clinicId === account.clinicId)?.name ?? "All units",
          signInName: got.signInName,
          temporaryPassword: got.temporaryPassword,
          email: got.email,
          phone: got.phoneE164,
        });
      } catch (caught) {
        failed += 1;
        if (one) setFailure(`${sentence(caught instanceof Error ? caught.message : "No new password was issued")} Nothing was changed.`);
      }
    }
    setBusy(false);
    if (!made.length) {
      if (!one) setFailure("No new passwords were issued. Check the connection and try again.");
      return;
    }
    setMissed(failed);
    setIssued(made);
  }

  return createPortal(
    <div className="scrim" onClick={() => !busy && !issued && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="issue-title" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <span className="sheet-icon" aria-hidden="true">
            <Key size={22} />
          </span>
          <span>
            <h2 id="issue-title">{one ? `New temporary password for ${nameOf(one)}` : `New temporary passwords for ${accounts.length} accounts`}</h2>
            <p>
              {issued
                ? "Shown once. Pass each on in person or by a trusted channel."
                : "The current password stops working and any open session ends. At the next sign-in they choose their own."}
            </p>
          </span>
          {!issued && (
            <button type="button" className="square-button" aria-label="Close" onClick={onClose} disabled={busy}>
              <Close size={16} />
            </button>
          )}
        </header>
        {issued ? (
          <>
            <div className="sheet-body">
              {issued.map((c) => (
                <Fragment key={c.signInName}>
                  {!one && <p className="dialog-label">{c.name.toUpperCase()}</p>}
                  <Secret label="Sign-in name" value={c.signInName} />
                  <Secret label="Temporary password" value={c.temporaryPassword} mono />
                </Fragment>
              ))}
              {missed > 0 && (
                <Notice tone="error">
                  {missed === 1 ? "1 account was" : `${missed} accounts were`} not given a new password. Try those again from the list.
                </Notice>
              )}
              <Notice>The temporary password works for 7 days.</Notice>
            </div>
            <footer className="sheet-foot">
              <span>Issuing passwords was logged against your admin user.</span>
              <button
                type="button"
                className="outline-button"
                onClick={() => (issued.length === 1 ? downloadSingleStaffPdf(issued[0]!) : downloadBatchStaffPdf(issued))}
              >
                <Download size={16} />
                Download credentials (PDF)
              </button>
              <button
                type="button"
                className="staff-primary sheet-primary"
                onClick={() =>
                  onDone(issued.length === 1 ? `${issued[0]!.name} has a new temporary password.` : `${issued.length} accounts have new temporary passwords.`)
                }
              >
                Done
              </button>
            </footer>
          </>
        ) : (
          <>
            {failure && (
              <div className="sheet-body">
                <Notice tone="error">{failure}</Notice>
              </div>
            )}
            <footer className="sheet-foot">
              <span>{one ? one.signInName : `${accounts.length} accounts`}</span>
              <button type="button" className="outline-button" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="staff-primary sheet-primary" onClick={() => void issue()} disabled={busy} aria-busy={busy || undefined}>
                {busy ? <LoadingIndicator size={20} label="Issuing" /> : null}
                {busy ? "Issuing" : one ? "Issue password" : "Issue passwords"}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>,
    document.body,
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

/**
 * A staff member's monthly priority allowance (FR-STF-13, guard BOUNDED_PRIORITY).
 *
 * The only staff priority Atria has: a number of priority places a month,
 * granted here by an administrator, shown with its usage, and nowhere
 * implicit. None withdraws it.
 */
function PriorityAllowance({ account, onClose, onDone }: { account: Listed; onClose: () => void; onDone: (message: string) => void }) {
  const [quota, setQuota] = useState(String(account.priorityAllowance?.quotaPerMonth ?? 0));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const name = [account.givenName, account.familyName].filter(Boolean).join(" ");

  async function save() {
    setBusy(true);
    setFailure(null);
    try {
      await api(`/admin/staff/${account.staffId}/priority-allowance`, { method: "PUT", json: { quotaPerMonth: Number(quota) } });
      onDone(Number(quota) ? `${name} holds ${quota} priority ${Number(quota) === 1 ? "place" : "places"} a month.` : `${name} holds no priority allowance.`);
    } catch (caught) {
      setFailure(`${sentence(caught instanceof Error ? caught.message : "The allowance could not be saved")} Nothing was changed.`);
      setBusy(false);
    }
  }

  return createPortal(
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div className="dialog staff-dialog" role="dialog" aria-modal="true" aria-labelledby="priority-title" onClick={(e) => e.stopPropagation()}>
        <span className="dialog-icon dialog-icon-blue accounts-dialog-icon" aria-hidden="true">
          <Star size={22} />
        </span>
        <h2 id="priority-title">Priority for {name}</h2>
        <p className="dialog-lede">
          The only priority staff have: a set number of priority places in a month, for their own or a dependant's visit. It is shown on
          this list with how much is used, and every use is in the audit log.
        </p>
        <div className="off-fields">
          <div className="off-field">
            <span>A month</span>
            <SelectMenu
              label="Priority places a month"
              value={quota}
              width={220}
              options={[0, 1, 2, 3, 4, 5].map((n) => ({ id: String(n), label: n ? `${n} ${n === 1 ? "place" : "places"}` : "None" }))}
              onChange={setQuota}
            />
          </div>
          {account.priorityAllowance && (
            <div className="off-field">
              <span>Used this month</span>
              <span className="settings-value">
                {account.priorityAllowance.usedThisMonth} of {account.priorityAllowance.quotaPerMonth}
              </span>
            </div>
          )}
        </div>
        {failure && <Notice tone="error">{failure}</Notice>}
        <div className="dialog-actions">
          <button type="button" className="outline-button keep" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="staff-primary" onClick={() => void save()} disabled={busy} aria-busy={busy || undefined}>
            {busy ? <LoadingIndicator size={20} label="Saving" /> : null}
            {busy ? "Saving" : "Save allowance"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
