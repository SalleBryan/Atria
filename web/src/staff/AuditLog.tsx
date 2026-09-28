/**
 * The audit log (FR-ADM-04, FR-ADM-05): every time staff opened or changed a
 * patient's record, and every other privileged change, newest first. A tenant
 * administrator sees every unit; a unit manager sees their own. The API
 * decides that too (audit.read).
 *
 * Built from Staff accounts' parts: the same header, card, column heads,
 * rows, chip row and filter menu, so it reads as the same console. The chip
 * row picks the period; who acted, what they did and whether it was a read
 * or a change sit in the menu under "More".
 *
 * A row says how many patients an action touched, never who they were: the
 * console shows aggregates by default (FR-ADM-05). The export names each
 * patient record, and exporting is itself recorded.
 */

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { api, apiFile } from "../api/client";
import { useSession } from "../auth/session";
import { Notice } from "../components/controls";
import { LoadingRow } from "../components/LoadingPane";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { ChipRow, FilterMenu, type FilterOption } from "../components/FilterMenu";
import { ChevronLeft, ChevronRight, Download, Shield } from "../components/icons";
import { Pager, usePages, useRowsThatFit } from "../components/Pager";
import { initials } from "../patient/data";
import { roleOf, useStaffData } from "./data";
import { sentence } from "./labels";
import { Snackbar } from "./Snackbar";

export interface AuditEntry {
  auditEntryId: string;
  occurredAt: string;
  actorPersonId: string;
  actorName: string;
  actorRole: string | null;
  action: string;
  kind: "READ" | "WRITE";
  subjectType: string;
  subjectId: string;
  clinicId: string | null;
  patientCount: number;
  reason: string | null;
  flags: string[];
  source: { ip: string };
}

interface Page {
  from: string;
  to: string;
  count: number;
  nextCursor: string | null;
  entries: AuditEntry[];
  actors: { personId: string; name: string; role: string | null }[];
  actions: string[];
}

/** What each recorded action is called here. An action not listed shows its own name. */
export const ACTION_LABEL: Record<string, string> = {
  "appointment.read": "Opened a visit",
  "appointment.create": "Booked a visit",
  "appointment.cancel": "Cancelled a visit",
  "appointment.reschedule": "Moved a visit",
  "appointment.confirm": "Confirmed a visit",
  "appointment.arrive": "Recorded an arrival",
  "appointment.start": "Started a consultation",
  "appointment.complete": "Completed a visit",
  "appointment.no_show": "Marked a no-show",
  "schedule.day": "Viewed a unit's day",
  "schedule.calendar": "Viewed a calendar",
  "availability.hours": "Changed working hours",
  "availability.time_off": "Took time off",
  "availability.give_back": "Gave back time off",
  "staff.create": "Created a staff account",
  "staff.update_roles": "Changed a role",
  "staff.suspend": "Suspended an account",
  "audit.export": "Exported the audit log",
};

const SUBJECT_LABEL: Record<string, string> = {
  APPOINTMENT: "Visit",
  CLINIC: "Unit day list",
  CLINICIAN: "Clinician",
  STAFF: "Staff account",
  AUDIT_LOG: "Audit log",
};

const ROLE_NAME: Record<string, string> = {
  RECEPTIONIST: "Front desk",
  CLINICIAN: "Clinician",
  CLINIC_MANAGER: "Unit manager",
  TENANT_ADMIN: "Administrator",
};

const FLAG_LABEL: Record<string, string> = {
  POTENTIAL_SELF_BENEFIT: "Near their own visit",
};

/** Today is the row's first chip, the one a chip row calls "all". */
const PERIODS: FilterOption[] = [
  { id: "7", label: "Last 7 days" },
  { id: "31", label: "Last 31 days" },
];

const KINDS: FilterOption[] = [
  { id: "READ", label: "Patient data opened" },
  { id: "WRITE", label: "Changes" },
];

const ROW_PITCH = 76;

function day(offset: number) {
  const date = new Date(Date.now());
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function patients(count: number) {
  if (!count) return "No patient data";
  return count === 1 ? "1 patient" : `${count} patients`;
}

export function AuditLog() {
  const { state } = useSession();
  const { state: directory } = useStaffData();
  const role = state.status === "signed-in" ? roleOf(state.me) : null;
  const allowed = role === "TENANT_ADMIN" || role === "CLINIC_MANAGER";

  const [period, setPeriod] = useState<string | null>("7");
  const [actor, setActor] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState<(Page & { at: number }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  // A unit manager opens on the week's changes (FR-STF-13); an administrator on the log.
  const [view, setView] = useState<"changes" | "log">(role === "CLINIC_MANAGER" ? "changes" : "log");
  const more = useRef<HTMLButtonElement>(null);
  const rowsBox = useRef<HTMLUListElement>(null);
  const size = useRowsThatFit(rowsBox, { row: ".audit-row", pitch: ROW_PITCH });

  const ask = new URLSearchParams({ from: day(Number(period ?? "1") - 1), to: day(0) });
  if (actor) ask.set("actor", actor);
  if (action) ask.set("action", action);
  if (kind) ask.set("kind", kind);
  const filters = ask.toString();

  useEffect(() => setCursors([null]), [filters, size]);

  useEffect(() => {
    if (!allowed) return;
    let live = true;
    const paged = new URLSearchParams(filters);
    paged.set("limit", String(size));
    const cursor = cursors[cursors.length - 1];
    if (cursor) paged.set("cursor", cursor);
    setLoading(true);
    api<Page>(`/audit?${paged}`)
      .then((found) => {
        if (!live) return;
        setPage({ ...found, at: cursors.length - 1 });
        setFailure(null);
      })
      .catch((error: unknown) => live && setFailure(error instanceof Error ? sentence(error.message) : "The log could not be loaded."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [allowed, filters, cursors, size]);

  if (state.status !== "signed-in") return null;
  if (!allowed) return <Navigate to="/console" replace />;

  const clinics = directory.status === "ready" ? directory.data.clinics : [];
  const clinicName = (id: string | null) => clinics.find((c) => c.clinicId === id)?.name;
  const entries = page?.entries ?? [];
  const first = (page?.at ?? 0) * size + 1;
  const pages = page ? Math.max(1, Math.ceil(page.count / size)) : 1;
  const actorOptions: FilterOption[] = (page?.actors ?? []).map((a) => ({ id: a.personId, label: a.name }));
  const actionOptions: FilterOption[] = (page?.actions ?? []).map((id) => ({ id, label: ACTION_LABEL[id] ?? id }));
  const menuFilters = [actor, action, kind].filter(Boolean).length;
  const flagged = entries.filter((e) => e.flags.length).length;

  const download = async () => {
    setExporting(true);
    try {
      const file = await apiFile(`/audit/export?${filters}`);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(file.blob);
      link.download = file.name ?? "atria-audit.csv";
      link.click();
      URL.revokeObjectURL(link.href);
      setSaid("Export downloaded. The export is recorded in the log.");
    } catch (error) {
      setSaid(error instanceof Error ? sentence(error.message) : "The export could not be made.");
    } finally {
      setExporting(false);
    }
  };

  const tabs = (
    <div className="segmented settings-tabs" role="tablist" aria-label="Audit">
      {(
        [
          ["changes", "This week's changes"],
          ["log", "Full log"],
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
  const heading = (
    <header className="accounts-top">
      <div>
        <h1>Audit log</h1>
        <p>
          {role === "TENANT_ADMIN" ? "Every unit" : (clinicName(state.me.clinicId) ?? "Your unit")} · who opened or changed what, and when
        </p>
      </div>
      {view === "log" && (
        <button type="button" className="tonal-button audit-export" onClick={() => void download()} disabled={exporting || !page?.count}>
          <Download size={16} />
          {exporting ? <LoadingIndicator size={20} label="Exporting" /> : null}
          {exporting ? "Exporting" : "Export CSV"}
        </button>
      )}
    </header>
  );

  if (view === "changes") {
    return (
      <div className="accounts-page audit-page">
        {heading}
        {tabs}
        <WeeklyChanges />
      </div>
    );
  }

  return (
    <div className="accounts-page audit-page">
      {heading}
      {tabs}

      <p className="accounts-banner">
        <Shield size={18} />
        Entries cannot be edited or deleted. Rows count the patients an action touched; the export names their records and is itself
        recorded.
      </p>

      <div className="accounts-filters">
        <ChipRow
          variant="week"
          label="Period"
          options={PERIODS}
          value={period}
          onChange={setPeriod}
          allLabel="Today"
          onMore={() => setMenuOpen(true)}
          moreActive={menuFilters}
          moreRef={more}
          moreAlways
        />
        <span className="accounts-count" aria-live="polite">
          {page ? (page.count === 1 ? "1 entry" : `${page.count} entries`) : ""}
        </span>
      </div>
      <FilterMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchor={more}
        title="Filter the log"
        sections={[
          { id: "kind", label: "Kind", options: KINDS, value: kind, onChange: setKind, allLabel: "Everything" },
          { id: "actor", label: "Who", options: actorOptions, value: actor, onChange: setActor, allLabel: "Anyone" },
          { id: "action", label: "Action", options: actionOptions, value: action, onChange: setAction, allLabel: "Any action" },
        ]}
        results={page ? (page.count === 1 ? "Show 1 entry" : `Show ${page.count} entries`) : "Show entries"}
        onClear={() => {
          setKind(null);
          setActor(null);
          setAction(null);
        }}
      />

      <section className="glass accounts-card" aria-label="Audit entries" aria-busy={!page || undefined}>
        {failure && <Notice tone="error">{failure} Check your connection and try again.</Notice>}
        <div className="accounts-head audit-head" aria-hidden="true">
          <span>WHO</span>
          <span>ACTION</span>
          <span>RECORD</span>
          <span>WHEN</span>
        </div>
        <ul ref={rowsBox} className={`accounts-rows${loading && page ? " accounts-rows-loading" : ""}`}>
          {!page
            ? [<LoadingRow key="loading" />]
            : entries.map((entry, index) => {
                const [given, ...rest] = entry.actorName.split(" ");
                return (
                  <li key={entry.auditEntryId} className="account-row audit-row" style={{ "--i": index } as CSSProperties}>
                    <span className="account-who">
                      <span
                        className={`account-avatar${entry.actorRole === "TENANT_ADMIN" ? " account-avatar-admin" : ""}`}
                        aria-hidden="true"
                      >
                        {initials(given, rest.join(" ")) || "?"}
                      </span>
                      <span className="account-text">
                        <span className="account-name">{entry.actorName}</span>
                        <span className="account-sub">{ROLE_NAME[entry.actorRole ?? ""] ?? "Staff"}</span>
                      </span>
                    </span>
                    <span className="audit-action">
                      <span className="account-name">
                        {ACTION_LABEL[entry.action] ?? entry.action}
                        {entry.flags.map((flag) => (
                          <span key={flag} className="chip chip-awaiting audit-flag">
                            {FLAG_LABEL[flag] ?? flag}
                          </span>
                        ))}
                      </span>
                      <span className="account-sub">
                        {entry.reason ? `“${entry.reason}”` : entry.kind === "READ" ? "Read only" : "Change"}
                      </span>
                    </span>
                    <span className="account-role audit-record">
                      <span>{SUBJECT_LABEL[entry.subjectType] ?? entry.subjectType}</span>
                      <span>{patients(entry.patientCount)}</span>
                    </span>
                    <span className="account-role audit-when">
                      <span>{when.format(new Date(entry.occurredAt))}</span>
                      <span>{entry.source.ip || "Unknown address"}</span>
                    </span>
                  </li>
                );
              })}
          {page && !entries.length && <li className="today-empty">Nothing recorded for this period.</li>}
        </ul>
        <Pager
          noun="entries"
          first={first}
          last={first + entries.length - 1}
          total={page?.count ?? 0}
          page={page?.at ?? 0}
          pages={pages}
          busy={loading}
          hasNext={Boolean(page?.nextCursor)}
          note={flagged ? `${flagged === 1 ? "1 entry" : `${flagged} entries`} on this page flagged for review` : undefined}
          onPrevious={() => setCursors((c) => c.slice(0, -1))}
          onNext={() => {
            const next = page?.nextCursor;
            if (next) setCursors((c) => [...c, next]);
          }}
        />
      </section>
      <Snackbar message={said} onDone={() => setSaid(null)} />
    </div>
  );
}

interface ChangeGroup {
  actorPersonId: string;
  actorName: string;
  actorRole: string | null;
  cancellations: number;
  reschedules: number;
  flagged: number;
  changes: { auditEntryId: string; occurredAt: string; action: string; appointmentId: string; reason: string | null; flags: string[] }[];
}

interface Week {
  week: string;
  to: string;
  actors: ChangeGroup[];
  total: number;
  flagged: number;
}

function monday(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

/**
 * Every reschedule and cancellation made by staff in a week, grouped by who
 * made them, flagged ones first (FR-STF-13). Read-only, from the audit trail.
 */
function WeeklyChanges() {
  const thisWeek = monday(new Date());
  const [week, setWeek] = useState(thisWeek);
  const [found, setFound] = useState<Week | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const groupsBox = useRef<HTMLUListElement>(null);
  // A page is as many people as the card holds, never an endless scroll.
  const size = useRowsThatFit(groupsBox, { row: ".changes-group", pitch: 220, gap: 12, least: 1 });
  const pages = usePages(found?.actors ?? [], size, week);

  useEffect(() => {
    let live = true;
    setFound(null);
    api<Week>(`/audit/changes?week=${week}`)
      .then((data) => live && setFound(data))
      .catch((error: unknown) => live && setFailure(error instanceof Error ? sentence(error.message) : "The week could not be loaded."));
    return () => {
      live = false;
    };
  }, [week]);

  const step = (days: number) => setWeek(new Date(Date.parse(`${week}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10));
  const range = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

  return (
    <section className="glass accounts-card changes-card" aria-label="This week's changes">
      <div className="settings-card-top">
        <div className="changes-week">
          <button type="button" className="square-button" aria-label="Previous week" onClick={() => step(-7)}>
            <ChevronLeft size={16} />
          </button>
          <span>
            {range.format(new Date(`${week}T12:00:00Z`))} to {range.format(new Date(Date.parse(`${week}T12:00:00Z`) + 6 * 86400000))}
          </span>
          <button type="button" className="square-button" aria-label="Next week" disabled={week >= thisWeek} onClick={() => step(7)}>
            <ChevronRight size={16} />
          </button>
        </div>
        <p>
          {found
            ? `${found.total} ${found.total === 1 ? "change" : "changes"}${found.flagged ? `, ${found.flagged} flagged for review` : ""}`
            : "Loading"}
        </p>
      </div>
      {failure && <Notice tone="error">{failure}</Notice>}
      <ul ref={groupsBox} className="accounts-rows changes-list">
        {!found ? (
          <LoadingRow />
        ) : found.actors.length ? (
          pages.shown.map((group, index) => {
            const [given, ...rest] = group.actorName.split(" ");
            return (
              <li key={group.actorPersonId} className="changes-group" style={{ "--i": index } as CSSProperties}>
                <div className="account-who">
                  <span className="account-avatar" aria-hidden="true">
                    {initials(given, rest.join(" ")) || "?"}
                  </span>
                  <span className="account-text">
                    <span className="account-name">{group.actorName}</span>
                    <span className="account-sub">
                      {ROLE_NAME[group.actorRole ?? ""] ?? "Staff"} · {group.reschedules} moved, {group.cancellations} cancelled
                    </span>
                  </span>
                  {group.flagged > 0 && <span className="chip chip-awaiting">{group.flagged} flagged</span>}
                </div>
                <ol className="changes-rows">
                  {group.changes.map((change) => (
                    <li key={change.auditEntryId}>
                      <span className="changes-when">{when.format(new Date(change.occurredAt))}</span>
                      <span className="changes-what">
                        {ACTION_LABEL[change.action] ?? change.action}
                        {change.flags.map((flag) => (
                          <span key={flag} className="chip chip-awaiting audit-flag">
                            {FLAG_LABEL[flag] ?? flag}
                          </span>
                        ))}
                      </span>
                      <span className="changes-why">{change.reason ? `“${change.reason}”` : "No reason recorded"}</span>
                      <Link className="link" to={`/console/visits/${change.appointmentId}`}>
                        Open visit
                      </Link>
                    </li>
                  ))}
                </ol>
              </li>
            );
          })
        ) : (
          <li className="today-empty">No reschedules or cancellations by staff this week.</li>
        )}
      </ul>
      {found && found.actors.length > 0 && (
        <Pager
          noun="people"
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
  );
}
