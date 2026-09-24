/**
 * What the staff screens read.
 *
 * The directory, the clinics and the appointment types are small and change
 * rarely, so they are loaded once for the console and joined here, as the
 * patient app does. A day or a week is loaded by the screen that shows it,
 * because that is what changes as the desk moves through the calendar.
 *
 * Who sees what is the API's decision (FR-STF-01, FR-ACC-09): a clinician
 * reads their own calendar, a receptionist or clinic manager their clinic's
 * day, and an administrator any clinic in the tenant. The console only asks
 * for the list the caller's role can have.
 */

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { api, type Me } from "../api/client";
import {
  ACTIVE_STATES,
  type Appointment,
  type AppointmentType,
  type Clinic,
  type Clinician,
  clock,
  ZONE,
} from "../patient/data";

export interface PatientName {
  givenName: string | null;
  familyName: string | null;
}

/** GET /clinics/{id}/day and GET /clinicians/{id}/calendar, as the console uses them. */
export interface Schedule {
  appointments: Appointment[];
  patients: Record<string, PatientName>;
}

interface Directory {
  clinicians: Clinician[];
  clinics: Clinic[];
  types: AppointmentType[];
}

type State = { status: "loading" } | { status: "ready"; data: Directory } | { status: "failed"; message: string };

const Context = createContext<{ state: State } | null>(null);

export function StaffDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let live = true;
    Promise.all([
      api<{ clinicians: Clinician[] }>("/clinicians"),
      api<{ clinics: Clinic[] }>("/clinics"),
      api<{ appointmentTypes: AppointmentType[] }>("/appointment-types"),
    ])
      .then(([directory, clinics, types]) => {
        if (live) {
          setState({
            status: "ready",
            data: { clinicians: directory.clinicians, clinics: clinics.clinics, types: types.appointmentTypes },
          });
        }
      })
      .catch((error: unknown) => {
        if (live) {
          setState({
            status: "failed",
            message: error instanceof Error ? error.message : "Atria could not be reached.",
          });
        }
      });
    return () => {
      live = false;
    };
  }, []);

  const value = useMemo(() => ({ state }), [state]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useStaffData() {
  const value = useContext(Context);
  if (!value) throw new Error("useStaffData outside StaffDataProvider");
  return value;
}

/* --------------------------------------------------------------- roles */

export type StaffRole = "RECEPTIONIST" | "CLINICIAN" | "CLINIC_MANAGER" | "TENANT_ADMIN";

/** How the sidebar names each role, as the Rev A frames do ("Front desk · Staff"). */
export const ROLE_LABEL: Record<StaffRole, string> = {
  RECEPTIONIST: "Front desk",
  CLINICIAN: "Clinician",
  CLINIC_MANAGER: "Clinic manager",
  TENANT_ADMIN: "Administrator",
};

/**
 * The role the console is laid out for. An account holds the roles it was
 * created with (FR-ACC-18); where it holds more than one, the widest view
 * wins, so a clinician who also runs the clinic sees the clinic's day.
 */
export function roleOf(me: Me): StaffRole {
  for (const role of ["TENANT_ADMIN", "CLINIC_MANAGER", "RECEPTIONIST", "CLINICIAN"] as const) {
    if (me.roles.includes(role)) return role;
  }
  return "RECEPTIONIST";
}

/** Whether the role reads one clinician's calendar rather than a clinic's day. */
export const readsOwnCalendar = (role: StaffRole) => role === "CLINICIAN";

/* -------------------------------------------------------------- the day */

/** Today's date on the clinic's calendar, yyyy-mm-dd. */
export const today = () => clock.isoDate(new Date());

/** A clinic date moved by whole days. Dates are calendar dates, so UTC arithmetic is exact. */
export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Noon on a clinic date, as an instant, for formatting the date itself. */
export const noonOf = (date: string) => new Date(`${date}T12:00:00+01:00`);

export const isDate = (value: string | null): value is string =>
  Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)));

export const CANCELLED_STATES: readonly string[] = ["PATIENT_CANCELLED", "CLINIC_CANCELLED", "DECLINED"];

/** Minutes between the start and the end. */
export const minutesOf = (appointment: Appointment) =>
  Math.round((Date.parse(appointment.endAt) - Date.parse(appointment.startAt)) / 60000);

/**
 * The reminder's lead time (FR-REM-01, default 24 hours). A booking made
 * inside it gets no reminder; its confirmation goes by SMS at once instead
 * (FR-REM-06).
 */
export const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

export function reminderAt(appointment: Appointment): Date | undefined {
  const fires = Date.parse(appointment.startAt) - REMINDER_LEAD_MS;
  return Date.parse(appointment.createdAt) <= fires ? new Date(fires) : undefined;
}

/** The figures on the four tiles above the day. */
export function tally(appointments: readonly Appointment[], now = Date.now()) {
  const live = appointments.filter((a) => !CANCELLED_STATES.includes(a.state));
  const active = appointments.filter((a) => ACTIVE_STATES.includes(a.state));
  return {
    booked: live.length,
    ahead: active.filter((a) => Date.parse(a.startAt) > now).length,
    cancelled: appointments.length - live.length,
    reminders: active.filter((a) => (reminderAt(a)?.getTime() ?? 0) > now).length,
  };
}

/** The clinician, clinic and type an appointment names by id. */
export function joinDirectory(directory: Directory | undefined, appointment: Appointment) {
  return {
    clinician: directory?.clinicians.find((c) => c.clinicianProfileId === appointment.clinicianProfileId),
    clinic: directory?.clinics.find((c) => c.clinicId === appointment.clinicId),
    type: directory?.types.find((t) => t.appointmentTypeId === appointment.appointmentTypeId),
  };
}

/** "Dr Esther Mbarga", as the staff frames name a clinician. */
export const doctor = (clinician: Pick<Clinician, "givenName" | "familyName"> | undefined, fallback = "Not named") =>
  clinician ? `Dr ${[clinician.givenName, clinician.familyName].filter(Boolean).join(" ")}` : fallback;

export function patientName(names: Record<string, PatientName>, appointment: Appointment): PatientName {
  return names[appointment.patientProfileId] ?? { givenName: null, familyName: null };
}

export const fullName = (name: PatientName | undefined, fallback = "Patient") =>
  [name?.givenName, name?.familyName].filter(Boolean).join(" ") || fallback;

export type Loading<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "failed"; message: string };

/**
 * A schedule from the API, fetched again whenever the address changes or
 * reload() is called (after a cancellation, say). An answer that arrives
 * after the desk has moved to another date is dropped.
 */
export function useSchedule(url: string | undefined) {
  const [state, setState] = useState<Loading<Schedule>>({ status: "loading" });
  const [fresh, setFresh] = useState(0);
  const shown = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!url) return;
    let live = true;
    // A new date starts from loading; a refresh of the same one keeps its rows
    // on screen until the new answer replaces them.
    if (shown.current !== url) setState({ status: "loading" });
    shown.current = url;
    api<Schedule>(url)
      .then((data) => live && setState({ status: "ready", data }))
      .catch(
        (error: unknown) =>
          live &&
          setState({
            status: "failed",
            message: error instanceof Error ? error.message : "The schedule could not be loaded.",
          }),
      );
    return () => {
      live = false;
    };
  }, [url, fresh]);

  const reload = useCallback(() => setFresh((n) => n + 1), []);
  return { state, reload };
}

/**
 * Several schedules read together and merged, such as a clinic's week as
 * seven of its days. Keyed by the joined addresses, so a new week starts from
 * loading and a refresh of the same one keeps its blocks on screen.
 */
export function useSchedules(urls: string[] | undefined) {
  const key = urls?.join("|");
  const [state, setState] = useState<Loading<Schedule>>({ status: "loading" });
  const [fresh, setFresh] = useState(0);
  const shown = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!key) return;
    let live = true;
    if (shown.current !== key) setState({ status: "loading" });
    shown.current = key;
    Promise.all(key.split("|").map((url) => api<Schedule>(url)))
      .then((parts) => {
        if (!live) return;
        const seen = new Set<string>();
        const appointments = parts
          .flatMap((part) => part.appointments)
          .filter((a) => !seen.has(a.appointmentId) && seen.add(a.appointmentId))
          .sort((a, b) => a.startAt.localeCompare(b.startAt));
        setState({ status: "ready", data: { appointments, patients: Object.assign({}, ...parts.map((p) => p.patients)) } });
      })
      .catch(
        (error: unknown) =>
          live &&
          setState({
            status: "failed",
            message: error instanceof Error ? error.message : "The week could not be loaded.",
          }),
      );
    return () => {
      live = false;
    };
  }, [key, fresh]);

  const reload = useCallback(() => setFresh((n) => n + 1), []);
  return { state, reload };
}

/** The Monday of a clinic date's week. */
export function mondayOf(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const weekday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  return shiftDate(date, -weekday);
}

/** Where the list for a date comes from, for the caller's role. */
export function scheduleUrl(role: StaffRole, me: Me, clinicId: string | undefined, from: string, to = from) {
  if (readsOwnCalendar(role)) return `/clinicians/${me.staffId}/calendar?from=${from}&to=${to}`;
  if (from === to) return `/clinics/${clinicId}/day?date=${from}`;
  return undefined;
}

export { ZONE };
