/**
 * Hospital settings, for a tenant administrator (FR-ADM-03, FR-ADM-06,
 * FR-ADM-09, FR-TEN-02 to FR-TEN-07).
 *
 * Five tabs over one read (GET /admin/settings):
 *
 *   Hospital     name, region pack and its lock, the grid (English only
 *                until Phase 3, so no language choice),
 *                reminders, senders, and the policy switches
 *   Units        each unit's profile, services and opening hours
 *   Visit types  what can be booked, maintained without a release
 *   Fees         the fee bands, each change a new dated version
 *   Roles        what each role may do, read-only, from the same matrix the
 *                API enforces
 *
 * There is no frame for it; it extends the console's Rev A look with the
 * parts the other screens use: the header and banner, glass cards, account
 * rows, the segmented control, the platform's pickers, checkboxes and fields,
 * and the dialogs of Availability. Every change is recorded in the audit log.
 */

import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Navigate } from "react-router-dom";

import { api } from "../api/client";
import { useSession } from "../auth/session";
import { type CountryCode, HOME_COUNTRY, nationalInput, normalisePhone } from "../auth/phone";
import { Checkbox, Field, Notice } from "../components/controls";
import { DeleteAccountDialog } from "../components/DeleteAccountDialog";
import { Building, Clock, Close, Pencil, Pin, Plus, Shield, Sliders, Trash } from "../components/icons";
import { PhoneField } from "../components/PhoneField";
import type { IntakeForm, UnitLocation } from "../patient/data";
import { FormsTab } from "./IntakeForms";
import { PAGE_ROWS, Pager, usePages } from "../components/Pager";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { LoadingPane } from "../components/LoadingPane";
import { type PickerOption, SelectMenu } from "../components/Pickers";
import { daysOf, type Hours, type Week, weekFrom, WeekHours } from "../components/WeekHours";
import { MATRIX, PERMISSIONS } from "../generated/permissions";
import { roleOf } from "./data";
import { sentence } from "./labels";
import { Snackbar } from "./Snackbar";

type Line = "GENERAL" | "SPECIALIST" | "PROCEDURE";

interface TenantSettings {
  tenantId: string;
  name: string;
  regionPackCode: string;
  gridUnitMinutes: number;
  languages: string[];
  reminderLeadHours: number;
  secondReminderHours: number;
  queueMoveThresholdMinutes: number;
  noShowStrikeThreshold: number;
  noShowStrikeWindowDays: number;
  qualityProgrammeEnabled: boolean;
  ratingAffectsFee: boolean;
  guardianConsent: string;
  smsSenderId: string | null;
  emailSenderName: string | null;
  firstAppointmentAt: string | null;
  regionPackLocked: boolean;
  lockReason: string | null;
}

interface RegionPack {
  code: string;
  currency: string;
  dialCode: string;
  languages: string[];
  timezone: string;
  allowsRatingFeeLink: boolean;
}

export interface Unit {
  clinicId: string;
  name: string;
  address: string | null;
  phone: string | null;
  description: string | null;
  services: string[] | null;
  openingHours: Hours | null;
  location?: UnitLocation | null;
}

export interface VisitType {
  appointmentTypeId: string;
  code: string | null;
  name: string;
  serviceLine: Line;
  durationUnits: number | null;
  bufferUnits: number | null;
  bookableBy: "PATIENT" | "STAFF" | "BOTH";
  patientRequestable: boolean | null;
  minNoticeMinutes: number | null;
  maxAdvanceDays: number | null;
  cancellationWindowMinutes: number | null;
  feeBandId: string | null;
  clinicIds: string[] | null;
  active: boolean | null;
  /** The questions it asks at booking (FR-BKG-15). */
  intakeFormId?: string | null;
}

export interface FeeBand {
  feeBandId: string;
  practice: string;
  baseAmountMinor: number;
  scheduleReference: string | null;
  effectiveFrom: string;
}

export interface Overview {
  tenant: TenantSettings;
  regionPack: RegionPack;
  clinics: Unit[];
  appointmentTypes: VisitType[];
  feeBands: FeeBand[];
  intakeForms?: IntakeForm[];
}

type Tab = "hospital" | "units" | "types" | "forms" | "fees" | "roles";

const TABS: { id: Tab; label: string }[] = [
  { id: "hospital", label: "Hospital" },
  { id: "units", label: "Units" },
  { id: "types", label: "Visit types" },
  { id: "forms", label: "Intake forms" },
  { id: "fees", label: "Fees" },
  { id: "roles", label: "Roles" },
];

export const LINE: Record<Line, string> = { GENERAL: "General", SPECIALIST: "Specialist", PROCEDURE: "Procedure" };
const LINE_TONE: Record<Line, string> = { GENERAL: "chip-confirmed", SPECIALIST: "chip-booked", PROCEDURE: "chip-admin" };
const BOOKED_BY: Record<VisitType["bookableBy"], string> = {
  BOTH: "Patients and staff",
  STAFF: "Staff only",
  PATIENT: "Patients only",
};

const MAX_FEE = 10_000_000;
export const xaf = (amount: number) => `${new Intl.NumberFormat("en-GB").format(amount)} XAF`;

const options = (values: number[], label: (n: number) => string): PickerOption[] => values.map((n) => ({ id: String(n), label: label(n) }));

const hours = (n: number) => (n === 1 ? "1 hour" : `${n} hours`);
const minutesLabel = (n: number) => (n < 60 ? `${n} min` : n % 60 ? `${Math.floor(n / 60)} h ${n % 60} min` : hours(n / 60));
const windowLabel = (n: number) =>
  n === 0 ? "None" : n < 60 ? `${n} min` : n < 1440 ? hours(n / 60) : n === 1440 ? "1 day" : `${n / 1440} days`;

export function Settings() {
  const { state } = useSession();
  const admin = state.status === "signed-in" && roleOf(state.me) === "TENANT_ADMIN";
  const [tab, setTab] = useState<Tab>("hospital");
  const [found, setFound] = useState<Overview | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [fresh, setFresh] = useState(0);
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    if (!admin) return;
    let live = true;
    api<Overview>("/admin/settings")
      .then((data) => {
        if (!live) return;
        setFound(data);
        setFailed(null);
      })
      .catch((error: unknown) => live && setFailed(error instanceof Error ? sentence(error.message) : "Settings could not be loaded."));
    return () => {
      live = false;
    };
  }, [admin, fresh]);

  if (state.status !== "signed-in") return null;
  if (!admin) return <Navigate to="/console" replace />;

  const done = (message: string) => {
    setSaid(message);
    setFresh((n) => n + 1);
  };

  return (
    <div className="accounts-page settings-page">
      <header className="accounts-top">
        <div>
          <h1>Hospital settings</h1>
          <p>{found ? `${found.tenant.name} · ${found.clinics.length} units` : "Loading"}</p>
        </div>
      </header>

      <div className="segmented settings-tabs" role="tablist" aria-label="Settings">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`segment${tab === t.id ? " segment-on" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {failed && <Notice tone="error">{failed} Check your connection and try again.</Notice>}

      {!found ? (
        <section className="glass accounts-card settings-card" aria-busy="true">
          <LoadingPane label="Loading settings" />
        </section>
      ) : tab === "hospital" ? (
        <HospitalTab key={fresh} found={found} onSaved={done} />
      ) : tab === "units" ? (
        <UnitsTab found={found} onSaved={done} />
      ) : tab === "types" ? (
        <TypesTab found={found} onSaved={done} />
      ) : tab === "forms" ? (
        <FormsTab forms={found.intakeForms ?? []} types={found.appointmentTypes} dialog={Dialog} onSaved={done} />
      ) : tab === "fees" ? (
        <FeesTab found={found} onSaved={done} />
      ) : (
        <RolesTab />
      )}
      <Snackbar message={said} onDone={() => setSaid(null)} />
    </div>
  );
}

/** One setting: what it is and why on the left, the control on the right. */
function Row({ title, help, children }: { title: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-row-title">{title}</span>
        {help && <span className="settings-row-help">{help}</span>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function HospitalTab({ found, onSaved }: { found: Overview; onSaved: (message: string) => void }) {
  const start = found.tenant;
  const pack = found.regionPack;
  const [draft, setDraft] = useState<TenantSettings>(start);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const set = (patch: Partial<TenantSettings>) => setDraft((d) => ({ ...d, ...patch }));

  const changed = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const key of [
      "name",
      "gridUnitMinutes",
      "languages",
      "reminderLeadHours",
      "secondReminderHours",
      "queueMoveThresholdMinutes",
      "noShowStrikeThreshold",
      "noShowStrikeWindowDays",
      "qualityProgrammeEnabled",
      "smsSenderId",
      "emailSenderName",
    ] as const) {
      if (JSON.stringify(draft[key]) !== JSON.stringify(start[key])) out[key] = draft[key];
    }
    return out;
  }, [draft, start]);
  const dirty = Object.keys(changed).length > 0;

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      await api("/admin/settings", { method: "PATCH", json: changed });
      onSaved("Settings saved. They apply from the next booking or message.");
    } catch (caught) {
      setFailure(`${sentence(caught instanceof Error ? caught.message : "The settings could not be saved")} Nothing was changed.`);
      setBusy(false);
    }
  }

  const strikes = draft.noShowStrikeThreshold > 0;
  const second = draft.secondReminderHours > 0;

  return (
    <form className="settings-form" onSubmit={save}>
      <div className="settings-cols">
        <section className="glass availability-card settings-card" aria-labelledby="hospital-title">
          <h2 id="hospital-title">The hospital</h2>
          <Field label="Name" value={draft.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} />
          <Row
            title="Region pack"
            help={
              start.regionPackLocked
                ? start.lockReason
                : "Currency, phone rules, languages, clock and holidays. Locks at the first appointment."
            }
          >
            <span className="settings-pack">
              <span className="settings-pack-code">{pack.code}</span>
              {pack.currency} · {pack.dialCode} · {pack.timezone}
              {start.regionPackLocked && <span className="chip chip-neutral">Locked</span>}
            </span>
          </Row>
          <Row
            title="Calendar grid"
            help={
              start.regionPackLocked
                ? "Locked with the region pack: every held time is counted in it."
                : "The smallest step a visit's length and start are counted in."
            }
          >
            <SelectMenu
              label="Calendar grid"
              value={String(draft.gridUnitMinutes)}
              options={options([5, 10, 15, 20, 30], (n) => `${n} minutes`)}
              width={160}
              disabled={start.regionPackLocked}
              onChange={(v) => set({ gridUnitMinutes: Number(v) })}
            />
          </Row>
        </section>

        <section className="glass availability-card settings-card" aria-labelledby="messages-title">
          <h2 id="messages-title">Reminders and messages</h2>
          <Row title="Reminder" help="Sent by SMS before every booked visit.">
            <SelectMenu
              label="Reminder"
              value={String(draft.reminderLeadHours)}
              options={options([12, 24, 48, 72], (n) => `${hours(n)} before`)}
              width={180}
              icon={<Clock size={15} />}
              onChange={(v) => set({ reminderLeadHours: Number(v) })}
            />
          </Row>
          <Row title="Second reminder" help="Off by default. A short nudge on the day.">
            <span className="settings-inline">
              <Checkbox checked={second} onChange={(on) => set({ secondReminderHours: on ? 2 : 0 })}>
                Send one
              </Checkbox>
              {second && (
                <SelectMenu
                  label="Second reminder"
                  value={String(draft.secondReminderHours)}
                  options={options([1, 2, 3, 4, 6], (n) => `${hours(n)} before`)}
                  width={170}
                  onChange={(v) => set({ secondReminderHours: Number(v) })}
                />
              )}
            </span>
          </Row>
          <Row title="Queue text" help="How far a queue ticket's arrival window moves before the patient is texted.">
            <SelectMenu
              label="Queue text"
              value={String(draft.queueMoveThresholdMinutes)}
              options={options([15, 30, 45, 60], (n) => `${n} minutes`)}
              width={160}
              onChange={(v) => set({ queueMoveThresholdMinutes: Number(v) })}
            />
          </Row>
          <Field
            label="SMS sender name"
            hint="3 to 11 letters and digits. Each network registers it separately."
            value={draft.smsSenderId ?? ""}
            maxLength={11}
            onChange={(e) => set({ smsSenderId: e.target.value })}
          />
          <Field
            label="Email sender name"
            value={draft.emailSenderName ?? ""}
            maxLength={60}
            onChange={(e) => set({ emailSenderName: e.target.value })}
          />
        </section>

        <section className="glass availability-card settings-card" aria-labelledby="policy-title">
          <h2 id="policy-title">Policies</h2>
          <Row
            title="Missed visits"
            help="Off by default. When on, a patient over the limit books only up to 24 hours ahead, is told why, and is never locked out."
          >
            <span className="settings-inline settings-stack">
              <Checkbox checked={strikes} onChange={(on) => set({ noShowStrikeThreshold: on ? 3 : 0 })}>
                Limit advance booking
              </Checkbox>
              {strikes && (
                <span className="settings-inline">
                  <SelectMenu
                    label="Missed visits allowed"
                    value={String(draft.noShowStrikeThreshold)}
                    options={options([2, 3, 4, 5], (n) => `After ${n} missed`)}
                    width={160}
                    onChange={(v) => set({ noShowStrikeThreshold: Number(v) })}
                  />
                  <SelectMenu
                    label="Counted over"
                    value={String(draft.noShowStrikeWindowDays)}
                    options={options([90, 180, 365], (n) => `in ${n} days`)}
                    width={150}
                    onChange={(v) => set({ noShowStrikeWindowDays: Number(v) })}
                  />
                </span>
              )}
            </span>
          </Row>
          <Row title="Quality programme" help="Asks patients for feedback after a visit. Off by default.">
            <Checkbox checked={draft.qualityProgrammeEnabled} onChange={(on) => set({ qualityProgrammeEnabled: on })}>
              Collect feedback
            </Checkbox>
          </Row>
          <Row
            title="Ratings and fees"
            help={
              pack.allowsRatingFeeLink
                ? "Whether a clinician's rating may change a fee."
                : `Not allowed by the ${pack.code} region pack: a rating never changes a fee.`
            }
          >
            <Checkbox checked={false} disabled onChange={() => undefined}>
              Link ratings to fees
            </Checkbox>
          </Row>
          <Row title="Guardian consent" help="For a patient under 18.">
            <span className="settings-value">At the desk, or by the guardian's own account</span>
          </Row>
        </section>
      </div>

      {failure && <Notice tone="error">{failure}</Notice>}
      <div className={`settings-save${dirty ? " settings-save-on" : ""}`} aria-hidden={!dirty}>
        <span>{dirty ? `${Object.keys(changed).length} unsaved ${Object.keys(changed).length === 1 ? "change" : "changes"}` : ""}</span>
        <button type="button" className="outline-button" disabled={!dirty || busy} onClick={() => setDraft(start)}>
          Undo
        </button>
        <button type="submit" className="staff-primary" disabled={!dirty || busy} aria-busy={busy || undefined}>
          {busy ? <LoadingIndicator size={20} label="Saving" /> : null}
          {busy ? "Saving" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function pagerProps(pages: ReturnType<typeof usePages<unknown>>) {
  return {
    first: pages.first,
    last: pages.last,
    total: pages.total,
    page: pages.page,
    pages: pages.pages,
    onPrevious: pages.previous,
    onNext: pages.next,
  };
}

const today = () => String((new Date().getUTCDay() + 6) % 7);

function UnitsTab({ found, onSaved }: { found: Overview; onSaved: (message: string) => void }) {
  const [editing, setEditing] = useState<Unit | "new" | null>(null);
  const [deleting, setDeleting] = useState<Unit | null>(null);
  const pages = usePages(found.clinics, PAGE_ROWS, "units");
  return (
    <section className="glass accounts-card settings-units-card" aria-label="Units">
      <div className="settings-units-toolbar">
        <div className="settings-units-intro">
          <h3>Hospital units ({found.clinics.length})</h3>
          <p>Consultation clinics, departments and specialised care centres.</p>
        </div>
        <button type="button" className="staff-primary accounts-new" onClick={() => setEditing("new")}>
          <Plus size={16} />
          Add unit
        </button>
      </div>
      <div className="accounts-head settings-units-head" aria-hidden="true">
        <span>UNIT</span>
        <span>SERVICES</span>
        <span>TODAY</span>
      </div>
      <ul className="accounts-rows">
        {pages.shown.map((unit, index) => {
          const open = unit.openingHours?.[today()];
          return (
            <li key={unit.clinicId} className="account-row settings-unit-row" style={{ "--i": index } as CSSProperties}>
              <span className="account-who">
                <span className="account-avatar" aria-hidden="true">
                  <Building size={17} />
                </span>
                <span className="account-text">
                  <span className="account-name">{unit.name}</span>
                  <span className="account-sub">{unit.description || "No description yet"}</span>
                </span>
              </span>
              <span className="account-role">
                <span>
                  {unit.services?.length ? `${unit.services.length} ${unit.services.length === 1 ? "service" : "services"}` : "None listed"}
                </span>
                <span>{unit.services?.slice(0, 2).join(", ")}</span>
              </span>
              <span className="account-role">
                <span>{open ? `${open.start} to ${open.end}` : "Closed"}</span>
                <span>{Object.keys(unit.openingHours ?? {}).length} days a week</span>
              </span>
              <span className="account-actions">
                <button
                  type="button"
                  className="square-button"
                  aria-label={`Edit ${unit.name}`}
                  title="Edit"
                  onClick={() => setEditing(unit)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  className="square-button danger"
                  aria-label={`Delete ${unit.name}`}
                  title="Delete"
                  onClick={() => setDeleting(unit)}
                >
                  <Trash size={15} />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <Pager noun="units" {...pagerProps(pages)} />
      {editing && (
        <UnitDialog
          unit={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={(message) => {
            setEditing(null);
            onSaved(message);
          }}
        />
      )}
      {deleting && (
        <DeleteAccountDialog
          title={`Delete ${deleting.name}?`}
          lede="The unit will be removed from the directory. Patients will no longer be able to select it for bookings."
          points={[
            "The unit is removed from the directory immediately.",
            "Active sessions or assigned staff must be reassigned or closed first.",
          ]}
          confirmLabel="Delete unit"
          onConfirm={async () => {
            await api(`/admin/clinics/${encodeURIComponent(deleting.clinicId)}`, { method: "DELETE" });
            const name = deleting.name;
            setDeleting(null);
            onSaved(`${name} removed.`);
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </section>
  );
}

function Dialog({
  title,
  lede,
  icon,
  busy,
  onClose,
  formId,
  submit,
  submitLabel,
  canSubmit,
  children,
}: {
  title: string;
  lede: string;
  icon: ReactNode;
  busy: boolean;
  onClose: () => void;
  formId: string;
  submit: (event: FormEvent) => void;
  submitLabel: string;
  canSubmit: boolean;
  children: ReactNode;
}) {
  return createPortal(
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div
        className="dialog staff-dialog move-dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${formId}-title`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="move-scroll">
          <button type="button" className="icon-button dialog-close" aria-label="Close" onClick={onClose} disabled={busy}>
            <Close size={16} />
          </button>
          <span className="dialog-icon dialog-icon-blue accounts-dialog-icon" aria-hidden="true">
            {icon}
          </span>
          <h2 id={`${formId}-title`}>{title}</h2>
          <p className="dialog-lede">{lede}</p>
          <form id={formId} className="settings-dialog-form" onSubmit={submit}>
            {children}
          </form>
        </div>
        <div className="dialog-actions move-actions">
          <button type="button" className="outline-button keep" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form={formId} className="staff-primary" disabled={busy || !canSubmit} aria-busy={busy || undefined}>
            {busy ? <LoadingIndicator size={20} label="Saving" /> : null}
            {busy ? "Saving" : submitLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function UnitDialog({ unit, onClose, onDone }: { unit: Unit | null; onClose: () => void; onDone: (message: string) => void }) {
  const isNew = unit === null;
  const initial = nationalInput(unit?.phone ?? "", HOME_COUNTRY);
  const [name, setName] = useState(unit?.name ?? "");
  const [phone, setPhone] = useState(initial.text);
  const [country, setCountry] = useState<CountryCode>(initial.country);
  const [description, setDescription] = useState(unit?.description ?? "");
  const [services, setServices] = useState<string[]>(unit?.services ?? []);
  const [adding, setAdding] = useState("");
  const [week, setWeek] = useState<Week>(() => weekFrom(unit?.openingHours, { start: "07:30", end: "15:30" }));
  const [building, setBuilding] = useState(unit?.location?.building ?? "");
  const [floor, setFloor] = useState(unit?.location?.floor ?? "");
  const [way, setWay] = useState(unit?.location?.directions ?? "");
  const [lat, setLat] = useState(String(unit?.location?.lat ?? ""));
  const [lng, setLng] = useState(String(unit?.location?.lng ?? ""));
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  function add() {
    const service = adding.trim();
    if (service && !services.includes(service) && services.length < 12) setServices([...services, service]);
    setAdding("");
  }

  /** Standing at the unit's door, the administrator can take its position from the device. */
  function here() {
    if (!navigator.geolocation) {
      setFailure("This browser cannot share a position. Type the entrance's latitude and longitude instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(position.coords.latitude.toFixed(6));
        setLng(position.coords.longitude.toFixed(6));
        setLocating(false);
      },
      () => {
        setFailure("The position could not be read. Type the entrance's latitude and longitude instead.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  const placed = lat.trim() !== "" || lng.trim() !== "";
  const pointOk = !placed || (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && lat.trim() !== "" && lng.trim() !== "");
  const location =
    building.trim() || floor.trim() || way.trim() || placed
      ? {
          ...(building.trim() ? { building: building.trim() } : {}),
          ...(floor.trim() ? { floor: floor.trim() } : {}),
          ...(way.trim() ? { directions: way.trim() } : {}),
          ...(placed ? { lat: Number(lat), lng: Number(lng) } : {}),
        }
      : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const payload = {
        name: name.trim(),
        phone: phone.trim() ? normalisePhone(phone, country) : "",
        description: description.trim(),
        services,
        openingHours: daysOf(week),
        location,
      };
      if (isNew) {
        await api("/admin/clinics", {
          method: "POST",
          json: payload,
        });
        onDone(`${name.trim()} added. Patients see the unit now.`);
      } else {
        await api(`/admin/clinics/${encodeURIComponent(unit.clinicId)}`, {
          method: "PATCH",
          json: payload,
        });
        onDone(`${name.trim()} saved. Patients see the change now.`);
      }
    } catch (caught) {
      setFailure(
        `${sentence(caught instanceof Error ? caught.message : isNew ? "The unit could not be created" : "The unit could not be saved")} Nothing was changed.`,
      );
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={isNew ? "Add hospital unit" : unit.name}
      lede={
        isNew
          ? "A department or service patients can be seen in. Its visit types are added under Visit types."
          : "What patients read about the unit, and when it is open. Changes are recorded in the audit log."
      }
      icon={<Building size={22} />}
      busy={busy}
      onClose={onClose}
      formId="unit-form"
      submit={submit}
      submitLabel={isNew ? "Add unit" : "Save unit"}
      canSubmit={Boolean(name.trim()) && pointOk}
    >
      <Field label="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      <PhoneField label="Phone number" value={phone} onChange={setPhone} country={country} onCountry={setCountry} />
      <label className="settings-label" htmlFor="unit-description">
        Description
      </label>
      <textarea
        id="unit-description"
        className="dialog-text"
        maxLength={300}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <span className="settings-label">Services</span>
      {services.length > 0 && (
        <span className="settings-services">
          {services.map((service) => (
            <span key={service} className="chip chip-booked settings-service">
              {service}
              <button type="button" aria-label={`Remove ${service}`} onClick={() => setServices(services.filter((s) => s !== service))}>
                <Close size={11} />
              </button>
            </span>
          ))}
        </span>
      )}
      <div className="settings-service-row">
        <div className="input settings-grow">
          <input
            id="unit-service-input"
            aria-label="Add a service"
            placeholder="Add a service (e.g. Minor surgery, Consultation)"
            value={adding}
            maxLength={60}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
        </div>
        <button type="button" className="tonal-button" onClick={add} disabled={!adding.trim()}>
          <Plus size={15} />
          Add
        </button>
      </div>
      <span className="settings-label">Opening hours</span>
      <WeekHours week={week} onChange={setWeek} closedLabel="Closed" />
      <span className="settings-label">Where it is in the hospital</span>
      <p className="settings-hint">
        Patients see this on the hospital map, and directions take them to this entrance rather than the main gate.
      </p>
      <span className="settings-pair">
        <Field label="Building" value={building} maxLength={60} placeholder="Block B" onChange={(e) => setBuilding(e.target.value)} />
        <Field label="Floor" value={floor} maxLength={30} placeholder="Ground floor" onChange={(e) => setFloor(e.target.value)} />
      </span>
      <label className="settings-label" htmlFor="unit-way">
        Walking directions from the gate
      </label>
      <textarea
        id="unit-way"
        className="dialog-text"
        maxLength={300}
        placeholder="Follow the blue line past the pharmacy; the unit is on the left."
        value={way}
        onChange={(e) => setWay(e.target.value)}
      />
      <div className="settings-coords-row">
        <Field
          label="Entrance latitude"
          className="settings-grow"
          inputMode="decimal"
          value={lat}
          placeholder="4.1532"
          onChange={(e) => setLat(e.target.value)}
        />
        <Field
          label="Entrance longitude"
          className="settings-grow"
          inputMode="decimal"
          value={lng}
          placeholder="9.2406"
          error={pointOk ? undefined : "Both numbers, in decimal degrees"}
          onChange={(e) => setLng(e.target.value)}
        />
        <button type="button" className="tonal-button" onClick={here} disabled={locating} aria-busy={locating || undefined}>
          {locating ? <LoadingIndicator size={18} label="Finding where you are" /> : <Pin size={15} />}I am at the door
        </button>
      </div>
      {failure && <Notice tone="error">{failure}</Notice>}
    </Dialog>
  );
}

function TypesTab({ found, onSaved }: { found: Overview; onSaved: (message: string) => void }) {
  const [editing, setEditing] = useState<VisitType | "new" | null>(null);
  const grid = found.tenant.gridUnitMinutes;
  const band = (id: string | null) => found.feeBands.find((b) => b.feeBandId === id);
  const units = (ids: string[] | null) =>
    !ids?.length
      ? "Every unit"
      : ids.length === 1
        ? (found.clinics.find((c) => c.clinicId === ids[0])?.name ?? "One unit")
        : `${ids.length} units`;
  const sorted = [...found.appointmentTypes].sort(
    (a, b) => Number(b.active !== false) - Number(a.active !== false) || a.name.localeCompare(b.name),
  );
  const pages = usePages(sorted, PAGE_ROWS, "types");
  return (
    <section className="glass accounts-card" aria-label="Visit types">
      <div className="settings-card-top">
        <p>What patients and staff can book. A retired type stays on visits already booked.</p>
        <button type="button" className="staff-primary accounts-new" onClick={() => setEditing("new")}>
          <Plus size={16} />
          New visit type
        </button>
      </div>
      <div className="accounts-head settings-types-head" aria-hidden="true">
        <span>VISIT TYPE</span>
        <span>LENGTH</span>
        <span>FEE</span>
        <span>OFFERED AT</span>
      </div>
      <ul className="accounts-rows">
        {pages.shown.map((t, index) => {
          const off = t.active === false;
          return (
            <li
              key={t.appointmentTypeId}
              className={`account-row settings-type-row${off ? " account-row-off" : ""}`}
              style={{ "--i": index } as CSSProperties}
            >
              <span className="account-who">
                <span className="account-text">
                  <span className="account-name settings-type-name">
                    {t.name}
                    <span className={`chip ${LINE_TONE[t.serviceLine]}`}>{LINE[t.serviceLine]}</span>
                    {off && <span className="chip chip-neutral">Retired</span>}
                  </span>
                  <span className="account-sub">
                    {BOOKED_BY[t.bookableBy]}
                    {t.patientRequestable ? ", patients can request" : ""}
                  </span>
                </span>
              </span>
              <span className="account-role">
                <span>{t.durationUnits ? minutesLabel(t.durationUnits * grid) : "Queued"}</span>
                <span>{t.durationUnits ? `+ ${minutesLabel((t.bufferUnits ?? 0) * grid)} turnaround` : "In the day's queue"}</span>
              </span>
              <span className="account-role">
                <span>{band(t.feeBandId) ? xaf(band(t.feeBandId)!.baseAmountMinor) : "No band"}</span>
                <span>{band(t.feeBandId)?.practice}</span>
              </span>
              <span className="account-role">
                <span>{units(t.clinicIds)}</span>
                <span>Cancel {windowLabel(t.cancellationWindowMinutes ?? 0)} ahead</span>
              </span>
              <span className="account-actions">
                <button type="button" className="square-button" aria-label={`Edit ${t.name}`} title="Edit" onClick={() => setEditing(t)}>
                  <Pencil size={15} />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <Pager noun="visit types" {...pagerProps(pages)} />
      {editing && (
        <TypeDialog
          type={editing === "new" ? null : editing}
          found={found}
          onClose={() => setEditing(null)}
          onDone={(message) => {
            setEditing(null);
            onSaved(message);
          }}
        />
      )}
    </section>
  );
}

function TypeDialog({
  type,
  found,
  onClose,
  onDone,
}: {
  type: VisitType | null;
  found: Overview;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const grid = found.tenant.gridUnitMinutes;
  const [name, setName] = useState(type?.name ?? "");
  const [line, setLine] = useState<Line>(type?.serviceLine ?? "SPECIALIST");
  const [duration, setDuration] = useState(type?.durationUnits ?? 3);
  const [buffer, setBuffer] = useState(type?.bufferUnits ?? 1);
  const [bookable, setBookable] = useState<VisitType["bookableBy"]>(type?.bookableBy ?? "BOTH");
  const [requestable, setRequestable] = useState(Boolean(type?.patientRequestable));
  const [band, setBand] = useState(type?.feeBandId ?? found.feeBands[0]?.feeBandId ?? "");
  const [units, setUnits] = useState<string[]>(type?.clinicIds ?? []);
  const [notice, setNotice] = useState(type?.minNoticeMinutes ?? 30);
  const [advance, setAdvance] = useState(type?.maxAdvanceDays ?? 60);
  const [cancelWindow, setCancelWindow] = useState(type?.cancellationWindowMinutes ?? 1440);
  const [active, setActive] = useState(type?.active !== false);
  const [intakeForm, setIntakeForm] = useState(type?.intakeFormId ?? "");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const procedure = line === "PROCEDURE";
  const general = line === "GENERAL";
  const lengths = Array.from({ length: 24 }, (_, i) => i + 1);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    const body = {
      name: name.trim(),
      ...(type ? {} : { serviceLine: line }),
      durationUnits: general ? null : duration,
      bufferUnits: general ? 0 : buffer,
      bookableBy: procedure ? "STAFF" : bookable,
      patientRequestable: procedure && requestable,
      feeBandId: band,
      clinicIds: units.length ? units : null,
      minNoticeMinutes: notice,
      maxAdvanceDays: advance,
      cancellationWindowMinutes: cancelWindow,
      active,
      intakeFormId: general ? null : intakeForm || null,
    };
    try {
      if (type) {
        await api(`/admin/appointment-types/${encodeURIComponent(type.appointmentTypeId)}`, { method: "PATCH", json: body });
      } else {
        await api("/admin/appointment-types", { method: "POST", json: body });
      }
      onDone(type ? `${body.name} saved.` : `${body.name} added. It can be booked now.`);
    } catch (caught) {
      setFailure(`${sentence(caught instanceof Error ? caught.message : "The visit type could not be saved")} Nothing was changed.`);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={type ? type.name : "New visit type"}
      lede={type ? "Visits already booked keep what they were booked with." : "Offered as soon as it is saved. No release needed."}
      icon={<Sliders size={22} />}
      busy={busy}
      onClose={onClose}
      formId="type-form"
      submit={submit}
      submitLabel={type ? "Save visit type" : "Add visit type"}
      canSubmit={Boolean(name.trim() && band)}
    >
      <Field label="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      <span className="settings-label">Service line</span>
      {type ? (
        // Fixed once the type exists: its visits were booked on that line. Two
        // greyed choices beside it looked like they could be picked.
        <p className="settings-fixed">
          <span className={`chip ${LINE_TONE[type.serviceLine]}`}>{LINE[type.serviceLine]}</span>
          <span className="settings-hint">Fixed once a type is added; add a new type for another line.</span>
        </p>
      ) : (
        <div className="segmented" role="radiogroup" aria-label="Service line">
          {(["GENERAL", "SPECIALIST", "PROCEDURE"] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={line === l}
              className={`segment${line === l ? " segment-on" : ""}`}
              onClick={() => setLine(l)}
            >
              {LINE[l]}
            </button>
          ))}
        </div>
      )}
      <p className="availability-note">
        {general
          ? "A general consultation is a ticket in the day's queue, with no set length."
          : procedure
            ? "Sized and placed by staff. A patient can be allowed to request one."
            : "A set time with a named clinician."}
      </p>
      {!general && (
        <div className="off-fields">
          <div className="off-field">
            <span>Length</span>
            <SelectMenu
              label="Length"
              value={String(duration)}
              options={options(lengths, (n) => minutesLabel(n * grid))}
              width={180}
              onChange={(v) => setDuration(Number(v))}
            />
          </div>
          <div className="off-field">
            <span>Turnaround</span>
            <SelectMenu
              label="Turnaround"
              value={String(buffer)}
              options={options([0, 1, 2, 3, 4, 6], (n) => (n ? minutesLabel(n * grid) : "None"))}
              width={180}
              onChange={(v) => setBuffer(Number(v))}
            />
          </div>
        </div>
      )}
      {procedure ? (
        <Checkbox checked={requestable} onChange={setRequestable}>
          Patients can request one
        </Checkbox>
      ) : (
        <>
          <span className="settings-label">Booked by</span>
          <div className="segmented" role="radiogroup" aria-label="Booked by">
            {(["BOTH", "STAFF", "PATIENT"] as const).map((b) => (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={bookable === b}
                className={`segment${bookable === b ? " segment-on" : ""}`}
                onClick={() => setBookable(b)}
              >
                {BOOKED_BY[b]}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="off-fields">
        <div className="off-field">
          <span>Fee band</span>
          <SelectMenu
            label="Fee band"
            value={band}
            options={found.feeBands.map((b) => ({ id: b.feeBandId, label: b.practice, hint: xaf(b.baseAmountMinor) }))}
            width={260}
            onChange={setBand}
          />
        </div>
        <div className="off-field">
          <span>Free cancellation</span>
          <SelectMenu
            label="Free cancellation"
            value={String(cancelWindow)}
            options={options([0, 120, 360, 720, 1440, 2880], (n) => (n ? `Up to ${windowLabel(n)} before` : "Any time"))}
            width={220}
            onChange={(v) => setCancelWindow(Number(v))}
          />
        </div>
      </div>
      {!general && (
        <div className="off-fields">
          <div className="off-field">
            <span>Notice</span>
            <SelectMenu
              label="Notice"
              value={String(notice)}
              options={options([0, 30, 60, 120, 1440], (n) => (n ? `${windowLabel(n)} ahead` : "None"))}
              width={180}
              onChange={(v) => setNotice(Number(v))}
            />
          </div>
          <div className="off-field">
            <span>Book up to</span>
            <SelectMenu
              label="Book up to"
              value={String(advance)}
              options={options([7, 14, 30, 60, 90, 180], (n) => `${n} days ahead`)}
              width={180}
              onChange={(v) => setAdvance(Number(v))}
            />
          </div>
        </div>
      )}
      {!general && (
        <div className="off-field">
          <span>Questions at booking</span>
          <SelectMenu
            label="Questions at booking"
            value={intakeForm}
            width={280}
            options={[
              { id: "", label: "No questions" },
              ...(found.intakeForms ?? []).map((f) => ({ id: f.intakeFormId, label: f.name, hint: `${f.fields.length} questions` })),
            ]}
            onChange={setIntakeForm}
          />
        </div>
      )}
      <span className="settings-label">Offered at</span>
      <p className="availability-note">None ticked offers it at every unit on its line.</p>
      <span className="settings-unit-checks">
        {found.clinics.map((c) => (
          <Checkbox
            key={c.clinicId}
            checked={units.includes(c.clinicId)}
            onChange={(on) => setUnits(on ? [...units, c.clinicId] : units.filter((u) => u !== c.clinicId))}
          >
            {c.name}
          </Checkbox>
        ))}
      </span>
      {type && (
        <Checkbox checked={active} onChange={setActive}>
          Offered for booking
        </Checkbox>
      )}
      {failure && <Notice tone="error">{failure}</Notice>}
    </Dialog>
  );
}

function FeesTab({ found, onSaved }: { found: Overview; onSaved: (message: string) => void }) {
  const [editing, setEditing] = useState<FeeBand | null>(null);
  const uses = (id: string) => found.appointmentTypes.filter((t) => t.feeBandId === id && t.active !== false).length;
  return (
    <section className="glass accounts-card" aria-label="Fee bands">
      <p className="accounts-banner settings-banner">
        <Shield size={18} />
        Amounts are recorded in the fee ledger at every visit's close. No money moves through Atria yet, and a rating never changes a fee.
      </p>
      <div className="accounts-head settings-fees-head" aria-hidden="true">
        <span>FEE BAND</span>
        <span>AMOUNT</span>
        <span>IN FORCE SINCE</span>
      </div>
      <ul className="accounts-rows">
        {found.feeBands.map((b, index) => (
          <li key={b.feeBandId} className="account-row settings-fee-row" style={{ "--i": index } as CSSProperties}>
            <span className="account-text">
              <span className="account-name">{b.practice}</span>
              <span className="account-sub">
                {uses(b.feeBandId)} visit {uses(b.feeBandId) === 1 ? "type" : "types"}
              </span>
            </span>
            <span className="account-role">
              <span className="settings-amount">{xaf(b.baseAmountMinor)}</span>
            </span>
            <span className="account-role">
              <span>
                {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(
                  new Date(`${b.effectiveFrom}T12:00:00Z`),
                )}
              </span>
              <span>{b.scheduleReference || "No reference"}</span>
            </span>
            <span className="account-actions">
              <button
                type="button"
                className="square-button"
                aria-label={`Change ${b.practice}`}
                title="Change amount"
                onClick={() => setEditing(b)}
              >
                <Pencil size={15} />
              </button>
            </span>
          </li>
        ))}
      </ul>
      {editing && (
        <BandDialog
          band={editing}
          onClose={() => setEditing(null)}
          onDone={(message) => {
            setEditing(null);
            onSaved(message);
          }}
        />
      )}
    </section>
  );
}

function BandDialog({ band, onClose, onDone }: { band: FeeBand; onClose: () => void; onDone: (message: string) => void }) {
  const [amount, setAmount] = useState(String(band.baseAmountMinor));
  const [reference, setReference] = useState(band.scheduleReference ?? "");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const typed = amount.replace(/\s|,/g, "");
  const value = Number(typed);
  // The API's bounds (core/settings.fee_band_fields): whole francs, at most ten million.
  const valid = typed !== "" && Number.isInteger(value) && value >= 0 && value <= MAX_FEE;
  // Allowed, but worth a second look before every later visit is charged it.
  const unusual =
    valid &&
    value !== band.baseAmountMinor &&
    (value === 0 || (band.baseAmountMinor > 0 && (value >= band.baseAmountMinor * 3 || value * 3 <= band.baseAmountMinor)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      await api(`/admin/fee-bands/${encodeURIComponent(band.feeBandId)}`, {
        method: "PUT",
        json: { practice: band.practice, baseAmountMinor: value, scheduleReference: reference.trim() },
      });
      onDone(`${band.practice} is ${xaf(value)} from today. The old amount stays on earlier visits.`);
    } catch (caught) {
      setFailure(`${sentence(caught instanceof Error ? caught.message : "The amount could not be saved")} Nothing was changed.`);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={band.practice}
      lede={`Now ${xaf(band.baseAmountMinor)}. A new amount applies from today; visits before keep the old one.`}
      icon={<Sliders size={22} />}
      busy={busy}
      onClose={onClose}
      formId="band-form"
      submit={submit}
      submitLabel="Save amount"
      canSubmit={valid && value !== band.baseAmountMinor}
    >
      <Field
        label="Amount in XAF"
        inputMode="numeric"
        value={amount}
        hint={valid ? xaf(value) : undefined}
        error={valid ? undefined : `A whole number of francs, up to ${xaf(MAX_FEE)}`}
        onChange={(e) => setAmount(e.target.value)}
      />
      {unusual && (
        <Notice>
          {value === 0
            ? `${band.practice} becomes free from today.`
            : `That is ${value > band.baseAmountMinor ? "more than three times" : "under a third of"} the ${xaf(band.baseAmountMinor)} it is now. Check the amount before saving.`}
        </Notice>
      )}
      <Field
        label="Taken from"
        hint="The schedule or decision the amount comes from."
        value={reference}
        maxLength={160}
        onChange={(e) => setReference(e.target.value)}
      />
      {failure && <Notice tone="error">{failure}</Notice>}
    </Dialog>
  );
}

const ROLES = ["PATIENT", "RECEPTIONIST", "CLINICIAN", "CLINIC_MANAGER", "TENANT_ADMIN"] as const;
const ROLE_NAME: Record<(typeof ROLES)[number], string> = {
  PATIENT: "Patient",
  RECEPTIONIST: "Receptionist",
  CLINICIAN: "Clinician",
  CLINIC_MANAGER: "Unit manager",
  TENANT_ADMIN: "Administrator",
};
const SCOPE: Record<string, { label: string; tone: string }> = {
  own: { label: "Own", tone: "chip-booked" },
  clinic: { label: "Unit", tone: "chip-confirmed" },
  tenant: { label: "Hospital", tone: "chip-admin" },
  none: { label: "", tone: "" },
};

/** What each permission is, in words. An unlisted one shows its own name. */
const PERMISSION_LABEL: Record<string, string> = {
  "appointment.read": "See visits",
  "appointment.create": "Book visits",
  "appointment.reschedule": "Move visits",
  "appointment.cancel": "Cancel visits",
  "appointment.check_in": "Record arrival",
  "appointment.mark_no_show": "Mark no-shows",
  "procedure.size_and_place": "Size and place procedures",
  "procedure.request": "Request procedures",
  "care_context.read": "Read care context",
  "care_context.write": "Write care context",
  "availability.read": "See availability",
  "availability.write": "Set hours and leave",
  "session.publish": "Publish sessions",
  "session.disrupt": "Mark a clinician unavailable",
  "queue.assign_next": "Call the next patient",
  "queue.add_walk_in": "Add walk-ins to the queue",
  "patient.read": "See patient records",
  "patient.create": "Register patients",
  "patient.update": "Update patient records",
  "staff.create": "Create staff accounts",
  "staff.update_roles": "Change roles",
  "staff.suspend": "Suspend accounts",
  "priority_allowance.grant": "Grant priority allowances",
  "clinic.manage": "Manage units",
  "appointment_type.manage": "Manage visit types",
  "fee_band.manage": "Manage fees",
  "region_pack.choose": "Choose the region pack",
  "feature_flag.set": "Switch policies",
  "feedback.submit": "Give feedback",
  "feedback.read": "Read feedback",
  "fee_ledger.read": "Read the fee ledger",
  "audit.read": "Read the audit log",
  "report.read": "Read reports",
  "message.send": "Send messages",
};

function RolesTab() {
  return (
    <section className="glass accounts-card settings-roles" aria-label="Roles and permissions">
      <p className="accounts-banner settings-banner">
        <Shield size={18} />
        Read-only. What each role may do, and over what: its own records, its unit, or the whole hospital. The API refuses anything not
        shown here.
      </p>
      <div className="settings-matrix-wrap">
        <table className="settings-matrix">
          <thead>
            <tr>
              <th scope="col">Permission</th>
              {ROLES.map((r) => (
                <th key={r} scope="col">
                  {ROLE_NAME[r]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((permission) => (
              <tr key={permission}>
                <th scope="row">{PERMISSION_LABEL[permission] ?? permission}</th>
                {ROLES.map((role) => {
                  const scope = (MATRIX[permission] as Record<string, string>)[role] ?? "none";
                  return (
                    <td key={role}>
                      {scope === "none" ? (
                        <span className="settings-none" aria-label="No">
                          ·
                        </span>
                      ) : (
                        <span className={`chip ${SCOPE[scope]?.tone ?? ""}`}>{SCOPE[scope]?.label ?? scope}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
