/**
 * What the patient screens read, loaded once and joined.
 *
 * An appointment names its clinician, clinic and type by id. The directory,
 * the clinics and the types are small and change rarely, so they are loaded
 * with the patient's visits and joined here, and every screen shows names.
 * After a booking or a cancellation, reload() fetches the visits again.
 *
 * Times are the clinic's: the region pack's timezone (Africa/Douala), not the
 * browser's, so a patient abroad still sees the time the clinic expects them.
 */

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { PACK } from "../auth/phone";
import type { AppointmentState } from "../generated/lifecycle";

export interface Appointment {
  appointmentId: string;
  reference: string;
  clinicId: string;
  patientProfileId: string;
  appointmentTypeId: string;
  clinicianProfileId: string | null;
  startAt: string;
  endAt: string;
  state: string;
  channel: string | null;
  bookedByRole: string | null;
  createdAt: string;
  version: number;
}

export interface Clinician {
  clinicianProfileId: string;
  clinicId: string | null;
  givenName: string | null;
  familyName: string | null;
  specialty: string | null;
  qualifications: string[];
  registrationYear: number | null;
  seniorityBand: "SENIOR" | "EXPERIENCED" | "ESTABLISHED" | "RECENT";
  languages: string[];
}

export interface Clinic {
  clinicId: string;
  name: string;
  address: string | null;
  phone: string | null;
  openingHours: Record<string, { start: string; end: string }> | null;
}

export interface AppointmentType {
  appointmentTypeId: string;
  code: string | null;
  name: string;
  serviceLine: "GENERAL" | "SPECIALIST" | "PROCEDURE";
  durationUnits: number | null;
  bufferUnits: number | null;
  bookableBy: "PATIENT" | "STAFF" | "BOTH";
  minNoticeMinutes: number | null;
  maxAdvanceDays: number | null;
  cancellationWindowMinutes: number | null;
}

export const ZONE = PACK.timezone ?? "Africa/Douala";

interface Loaded {
  appointments: Appointment[];
  clinicians: Clinician[];
  clinics: Clinic[];
  types: AppointmentType[];
  gridUnitMinutes: number;
}

type State = { status: "loading" } | { status: "ready"; data: Loaded } | { status: "failed"; message: string };

interface PatientData {
  state: State;
  reload: () => Promise<void>;
}

const Context = createContext<PatientData | null>(null);

async function load(): Promise<Loaded> {
  const [visits, directory, clinics, types] = await Promise.all([
    api<{ appointments: Appointment[] }>("/patients/me/appointments?when=all"),
    api<{ clinicians: Clinician[] }>("/clinicians"),
    api<{ clinics: Clinic[] }>("/clinics"),
    api<{ appointmentTypes: AppointmentType[]; gridUnitMinutes: number }>("/appointment-types"),
  ]);
  return {
    appointments: visits.appointments,
    clinicians: directory.clinicians,
    clinics: clinics.clinics,
    types: types.appointmentTypes,
    gridUnitMinutes: types.gridUnitMinutes,
  };
}

export function PatientDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const reload = useCallback(async () => {
    try {
      setState({ status: "ready", data: await load() });
    } catch (error) {
      setState({ status: "failed", message: error instanceof Error ? error.message : "Atria could not be reached." });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo(() => ({ state, reload }), [state, reload]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePatientData(): PatientData {
  const value = useContext(Context);
  if (!value) throw new Error("usePatientData outside PatientDataProvider");
  return value;
}

/* ----------------------------------------------------------------- joins */

export function clinicianName(clinician: Pick<Clinician, "givenName" | "familyName"> | undefined): string {
  if (!clinician) return "Your clinician";
  return `Dr ${[clinician.givenName, clinician.familyName].filter(Boolean).join(" ")}`;
}

export function initials(...names: (string | null | undefined)[]): string {
  return names
    .filter((name): name is string => Boolean(name))
    .map((name) => name.trim()[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);
}

export function join(data: Loaded, appointment: Appointment) {
  return {
    clinician: data.clinicians.find((c) => c.clinicianProfileId === appointment.clinicianProfileId),
    clinic: data.clinics.find((c) => c.clinicId === appointment.clinicId),
    type: data.types.find((t) => t.appointmentTypeId === appointment.appointmentTypeId),
  };
}

/** Booked and still ahead, soonest first. */
export function upcoming(appointments: readonly Appointment[], now = new Date()): Appointment[] {
  return appointments
    .filter((a) => ACTIVE_STATES.includes(a.state) && new Date(a.startAt) > now)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** Everything already behind, most recent first. */
export function past(appointments: readonly Appointment[], now = new Date()): Appointment[] {
  return appointments.filter((a) => new Date(a.startAt) <= now).sort((a, b) => b.startAt.localeCompare(a.startAt));
}

/* --------------------------------------------------------------- the clock */

const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, ...options });

const TIME = format({ hour: "2-digit", minute: "2-digit", hour12: false });
// Three-letter months, as the Rev A frames write them ("Wed 10 Sep"). British
// English now abbreviates September to "Sept", so the month comes from US
// English and the order from British: weekday, day, month.
const MONTH_SHORT = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, month: "short" });
const WEEKDAY_DAY = format({ weekday: "short", day: "numeric" });
const DATE = format({ day: "2-digit" });
const LONG = format({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
const HOUR = format({ hour: "numeric", hour12: false });
const WEEKDAY = format({ weekday: "short" });

export const clock = {
  time: (instant: string | Date) => TIME.format(new Date(instant)),
  day: (instant: string | Date) => `${WEEKDAY_DAY.format(new Date(instant))} ${MONTH_SHORT.format(new Date(instant))}`,
  month: (instant: string | Date) => MONTH_SHORT.format(new Date(instant)).toUpperCase(),
  date: (instant: string | Date) => DATE.format(new Date(instant)),
  long: (instant: string | Date) => LONG.format(new Date(instant)),
  weekday: (instant: string | Date) => WEEKDAY.format(new Date(instant)),
  hour: (instant: string | Date = new Date()) => Number(HOUR.format(new Date(instant))),
  /** yyyy-mm-dd of an instant, on the clinic's calendar. */
  isoDate: (instant: string | Date) => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(instant),
    );
    return parts;
  },
};

/** "in 2 days", "tomorrow", "in 3 hours", "today". */
export function until(instant: string, now = new Date()): string {
  const minutes = Math.round((new Date(instant).getTime() - now.getTime()) / 60000);
  const days = Math.round(
    (Date.parse(`${clock.isoDate(instant)}T00:00:00Z`) - Date.parse(`${clock.isoDate(now)}T00:00:00Z`)) / 86400000,
  );
  if (days >= 2) return `${days} days`;
  if (days === 1) return "Tomorrow";
  if (minutes >= 60) return `${Math.round(minutes / 60)} h`;
  return minutes > 0 ? `${minutes} min` : "Now";
}

export function greeting(now = new Date()): string {
  const hour = clock.hour(now);
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Local opening hours for the weekday of an instant; keys are 0 for Monday. */
export function hoursOn(clinic: Clinic | undefined, instant: string | Date = new Date()) {
  if (!clinic?.openingHours) return undefined;
  const index = (["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const).indexOf(
    clock.weekday(instant) as "Mon",
  );
  return clinic.openingHours[String(index)];
}

/** Years on the Order's roll, as the directory frame shows it: "10y+". */
export function experience(clinician: Clinician | undefined, now = new Date()): string | undefined {
  if (!clinician?.registrationYear) return undefined;
  const years = now.getFullYear() - clinician.registrationYear;
  return years >= 1 ? `${Math.floor(years / 5) * 5 || years}y+` : "New";
}

export const SENIORITY: Record<Clinician["seniorityBand"], string> = {
  SENIOR: "Senior",
  EXPERIENCED: "Experienced",
  ESTABLISHED: "Established",
  RECENT: "Recently qualified",
};

/**
 * What a patient reads for each appointment state, for every state in the
 * specification's lifecycle (typed against it, so a new state fails here).
 * Confirmed is the Rev A wording for a booked visit.
 */
export const STATE_LABEL: Record<
  AppointmentState,
  { label: string; tone: "confirmed" | "awaiting" | "cancelled" | "neutral" }
> = {
  REQUESTED: { label: "Requested", tone: "awaiting" },
  DECLINED: { label: "Declined", tone: "cancelled" },
  BOOKED: { label: "Confirmed", tone: "confirmed" },
  CONFIRMED: { label: "Confirmed", tone: "confirmed" },
  RESCHEDULED: { label: "Rescheduled", tone: "awaiting" },
  DISRUPTED: { label: "Time changed", tone: "awaiting" },
  ARRIVED: { label: "Checked in", tone: "confirmed" },
  IN_CONSULTATION: { label: "In consultation", tone: "confirmed" },
  COMPLETED: { label: "Attended", tone: "neutral" },
  AWAITING_FEEDBACK: { label: "Attended", tone: "neutral" },
  CLINIC_CANCELLED: { label: "Cancelled by clinic", tone: "cancelled" },
  PATIENT_CANCELLED: { label: "Cancelled", tone: "cancelled" },
  NO_SHOW: { label: "Missed", tone: "awaiting" },
};

export function stateLabel(state: string) {
  return STATE_LABEL[state as AppointmentState] ?? { label: state, tone: "neutral" as const };
}

/** A visit the patient can still act on: booked or confirmed, and ahead. */
export const ACTIVE_STATES: readonly string[] = ["BOOKED", "CONFIRMED"];
