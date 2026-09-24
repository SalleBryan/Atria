/**
 * "Add to calendar": a visit as an iCalendar entry (RFC 5545), built in the
 * browser and handed to the device's own calendar. Times are written in UTC,
 * so every calendar places the visit at the clinic's time wherever the phone
 * thinks it is.
 */

import type { Appointment, Clinic, Clinician, AppointmentType } from "./data";
import { clinicianName } from "./data";

function stamp(instant: string | Date): string {
  return new Date(instant).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Text values escape backslash, semicolon, comma and newline. */
function text(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function calendarEntry(
  appointment: Appointment,
  joined: { clinician?: Clinician; clinic?: Clinic; type?: AppointmentType },
  now: Date = new Date(),
): string {
  const who = clinicianName(joined.clinician);
  const where = [joined.clinic?.name, joined.clinic?.address].filter(Boolean).join(", ");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Atria//Patient//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${appointment.appointmentId}@atria`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(appointment.startAt)}`,
    `DTEND:${stamp(appointment.endAt)}`,
    `SUMMARY:${text(`${joined.type?.name ?? "Visit"} with ${who}`)}`,
    where ? `LOCATION:${text(where)}` : null,
    `DESCRIPTION:${text(`Atria reference ${appointment.reference}. Arrive a few minutes early.`)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${text(`Visit with ${who}`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((line): line is string => line !== null);
  return `${lines.join("\r\n")}\r\n`;
}

export function downloadCalendarEntry(
  appointment: Appointment,
  joined: { clinician?: Clinician; clinic?: Clinic; type?: AppointmentType },
): void {
  const blob = new Blob([calendarEntry(appointment, joined)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `atria-${appointment.reference}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
