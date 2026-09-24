/**
 * How the console words an appointment, which is not quite how a patient
 * reads it. The staff frames colour a booked visit blue and an arrival green,
 * say "Arrived" and "No-show" where the patient reads "Checked in" and
 * "Missed", and say who cancelled. Typed against the lifecycle, so a new state
 * fails here rather than showing a raw code at the desk.
 */

import type { AppointmentState } from "../generated/lifecycle";

export type Tone = "booked" | "confirmed" | "awaiting" | "cancelled" | "neutral";

export const STAFF_STATE: Record<AppointmentState, { label: string; tone: Tone }> = {
  REQUESTED: { label: "Requested", tone: "awaiting" },
  DECLINED: { label: "Declined", tone: "cancelled" },
  BOOKED: { label: "Confirmed", tone: "booked" },
  CONFIRMED: { label: "Confirmed", tone: "booked" },
  RESCHEDULED: { label: "Rescheduled", tone: "booked" },
  DISRUPTED: { label: "Time changed", tone: "awaiting" },
  ARRIVED: { label: "Arrived", tone: "confirmed" },
  IN_CONSULTATION: { label: "In consultation", tone: "confirmed" },
  COMPLETED: { label: "Attended", tone: "neutral" },
  AWAITING_FEEDBACK: { label: "Attended", tone: "neutral" },
  CLINIC_CANCELLED: { label: "Cancelled by clinic", tone: "cancelled" },
  PATIENT_CANCELLED: { label: "Cancelled by patient", tone: "cancelled" },
  NO_SHOW: { label: "No-show", tone: "awaiting" },
};

export function staffState(state: string) {
  return STAFF_STATE[state as AppointmentState] ?? { label: state, tone: "neutral" as const };
}

/** Who booked, by the role recorded on the appointment. Blank means the patient did. */
export const BOOKED_BY: Record<string, string> = {
  PATIENT: "Booked by the patient",
  RECEPTIONIST: "Booked by the front desk",
  CLINICIAN: "Booked by a clinician",
  CLINIC_MANAGER: "Booked by the clinic manager",
};

/** The API words its errors as fragments ("that appointment is already cancelled"); the desk reads sentences. */
export function sentence(text: string): string {
  const trimmed = text.trim();
  const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

export const CHANNEL: Record<string, string> = {
  ONLINE: "Atria web",
  WEB: "Atria web",
  APP: "Atria app",
  PHONE: "By phone",
  WALK_IN: "At the desk",
};
