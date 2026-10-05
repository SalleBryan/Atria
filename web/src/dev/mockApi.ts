/**
 * A stand-in for the Atria API, for the development preview only.
 *
 * It answers the routes the patient screens call with invented data, in the
 * same shapes as docs/openapi/atria.yaml, and keeps bookings and
 * cancellations in memory, so a screen can be looked at, clicked through and
 * checked without anyone signing in. Every name is invented. Nothing here is
 * imported outside src/dev, and src/dev is only loaded by the dev server.
 *
 * Hospital time is UTC+1 all year (Africa/Douala has no daylight saving), so
 * local times are built with a fixed offset.
 */

import { APPOINTMENT_TYPES, CLINICIANS, FEE_BANDS, HOSPITAL, INTAKE_FORMS, TENANT_SETTINGS, UNITS } from "../generated/hospital";

const OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const GRID = 10;

/**
 * The Regional Hospital Buea as the development tenant is seeded with it
 * (atria_spec.hospital, generated): its outpatient units, appointment types
 * and invented staff. Unit phone numbers are fictional.
 */
const clinics = UNITS.map((unit, i) => ({
  clinicId: unit.clinicId,
  name: unit.name,
  address: HOSPITAL.address,
  phone: `+1 202 555 01${String(47 + i).padStart(2, "0")}`,
  description: unit.description,
  services: [...unit.services],
  openingHours: unit.openingHours as Record<string, { start: string; end: string }>,
  // An invented site plan: blocks A to D around the main gate, three units a
  // block, so the hospital map has something to draw in development.
  location: {
    building: `Block ${"ABCD"[Math.floor(i / 3) % 4]}`,
    floor: i % 3 === 0 ? "Ground floor" : i % 3 === 1 ? "First floor" : "Ground floor, east wing",
    directions: `From the main gate, follow the ${["blue", "green", "yellow", "red"][Math.floor(i / 3) % 4]} line to Block ${"ABCD"[Math.floor(i / 3) % 4]}.`,
    lat: (4.1532 + (Math.floor(i / 3) % 2) * 0.0011 - (i % 3) * 0.00022).toFixed(6),
    lng: (9.2406 + Math.floor(i / 6) * 0.0014 + (i % 3) * 0.00035).toFixed(6),
  },
}));

function band(year: number): string {
  const years = new Date().getUTCFullYear() - year;
  return years >= 20 ? "SENIOR" : years >= 10 ? "EXPERIENCED" : years >= 3 ? "ESTABLISHED" : "RECENT";
}

const clinicians = CLINICIANS.map((c) => ({
  clinicianProfileId: `s-${c.familyName.toLowerCase()}`,
  clinicId: c.clinicId,
  givenName: c.givenName,
  familyName: c.familyName,
  specialty: c.specialty,
  qualifications: [],
  registrationYear: c.registrationYear,
  seniorityBand: band(c.registrationYear),
  languages: [...c.languages],
}));

interface MockType {
  appointmentTypeId: string;
  code: string | null;
  name: string;
  serviceLine: string;
  durationUnits: number | null;
  bufferUnits: number;
  bookableBy: string;
  patientRequestable: boolean;
  clinicIds: string[] | null;
  feeBandId: string;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  cancellationWindowMinutes: number;
  active: boolean;
  intakeFormId?: string | null;
}

// Intake forms (atria.data.intake), each at version 1, and the care context
// patients have given (services/booking/care.py), kept in memory.
const intakeForms: { intakeFormId: string; name: string; version: number; fields: unknown[] }[] = INTAKE_FORMS.map((f) => ({
  intakeFormId: f.intakeFormId,
  name: f.name,
  version: 1,
  fields: JSON.parse(JSON.stringify(f.fields)) as unknown[],
}));
const careContexts: Record<string, { answers: Record<string, unknown>; submittedAt: string; formVersion: number }> = {};
const formOf = (typeId: unknown) => {
  const id = types.find((t) => t.appointmentTypeId === typeId)?.intakeFormId;
  return intakeForms.find((f) => f.intakeFormId === id) ?? null;
};

const types: MockType[] = APPOINTMENT_TYPES.map((t) => ({
  appointmentTypeId: t.appointmentTypeId,
  code: t.code,
  name: t.name,
  serviceLine: t.serviceLine,
  durationUnits: t.durationUnits,
  bufferUnits: t.bufferUnits,
  bookableBy: t.bookableBy,
  patientRequestable: "patientRequestable" in t ? t.patientRequestable : false,
  clinicIds: "clinicIds" in t ? [...t.clinicIds] : null,
  feeBandId: t.feeBandId,
  minNoticeMinutes: 30,
  maxAdvanceDays: 60,
  cancellationWindowMinutes: 1440,
  active: true,
  intakeFormId: "intakeFormId" in t ? t.intakeFormId : null,
}));

// The tenant's settings and fee bands (atria.services.admin.settings).
const tenant: Record<string, unknown> = {
  tenantId: "t-cm-001",
  name: HOSPITAL.name,
  regionPackCode: "CM",
  ...TENANT_SETTINGS,
  languages: [...TENANT_SETTINGS.languages],
  firstAppointmentAt: "2026-09-19T08:12:40Z",
};
const feeBands = FEE_BANDS.map((b) => ({
  ...b,
  scheduleReference: "Atria fair rates, 2026-09-26",
  effectiveFrom: "2026-09-26",
}));
const regionPack = {
  code: "CM",
  currency: "XAF",
  dialCode: "+237",
  languages: ["fr", "en"],
  timezone: "Africa/Douala",
  allowsRatingFeeLink: false,
};

function settingsOverview() {
  const locked = Boolean(tenant.firstAppointmentAt);
  return {
    tenant: {
      ...tenant,
      regionPackLocked: locked,
      lockReason: locked
        ? `Locked since the first appointment on 19 September 2026. Bookings were made against this pack's currency, phone rules and clock.`
        : null,
    },
    regionPack,
    clinics,
    appointmentTypes: types,
    feeBands,
    intakeForms,
  };
}

/** A clinic-local wall time, days from today, as a UTC instant. */
function local(daysFromToday: number, hour: number, minute = 0): Date {
  const now = new Date(Date.now() + OFFSET_MS);
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysFromToday, hour, minute);
  return new Date(day - OFFSET_MS);
}

const iso = (instant: Date) => instant.toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * Dr Tabi's leave, next Monday to Friday: the one source the roster, free
 * times and the administrator's coming week all read, where each once had
 * its own (audit 2026-10-05).
 */
function leaveWeek(): { from: string; to: string } {
  const monday = new Date(Date.now() + OFFSET_MS);
  monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7 || 7));
  const day = (n: number) => new Date(monday.getTime() + n * 86400000).toISOString().slice(0, 10);
  return { from: day(0), to: day(4) };
}
const onLeave = (clinicianId: string, date: string) => {
  const { from, to } = leaveWeek();
  return clinicianId === "s-tabi" && date >= from && date <= to;
};

let sequence = 4821;
function appointment(
  clinician: string,
  type: string,
  start: Date,
  state: string,
  createdDaysAgo: number,
  who: { patient?: string; bookedByRole?: string; channel?: string } = {},
): Record<string, unknown> {
  const clinic = clinicians.find((c) => c.clinicianProfileId === clinician)?.clinicId;
  const duration = (types.find((t) => t.appointmentTypeId === type)?.durationUnits ?? 3) * GRID;
  sequence += 137;
  return {
    appointmentId: `a-${sequence}`,
    reference: `APT-${sequence}`,
    tenantId: "t-cm-001",
    clinicId: clinic,
    patientProfileId: who.patient ?? "pp-preview",
    appointmentTypeId: type,
    clinicianProfileId: clinician,
    sessionId: null,
    startAt: iso(start),
    endAt: iso(new Date(start.getTime() + duration * 60000)),
    state,
    channel: who.channel ?? "WEB",
    bookedByPersonId: "p-preview",
    bookedByRole: who.bookedByRole ?? "PATIENT",
    referralId: null,
    careContextId: null,
    version: 1,
    createdAt: iso(new Date(Date.now() - createdDaysAgo * DAY_MS)),
  };
}

/** The people on the staff side's lists. Invented, like everything here. */
const patients: Record<string, { givenName: string; familyName: string }> = {
  "pp-preview": { givenName: "Amina", familyName: "Ngo" },
  "pp-tagne": { givenName: "Brice", familyName: "Tagne" },
  "pp-ekambi": { givenName: "Chantal", familyName: "Ekambi" },
  "pp-foka": { givenName: "Didier", familyName: "Foka" },
  "pp-nana": { givenName: "Estelle", familyName: "Nana" },
  "pp-mvondo": { givenName: "Fabrice", familyName: "Mvondo" },
  "pp-atangana": { givenName: "Gisele", familyName: "Atangana" },
  "pp-kamga": { givenName: "Herve", familyName: "Kamga" },
  "pp-beyala": { givenName: "Ines", familyName: "Beyala" },
  "pp-essomba": { givenName: "Joel", familyName: "Essomba" },
  "pp-makane": { givenName: "Makane", familyName: "Thanksgiving" },
  "pp-salle": { givenName: "Salle Yimnai", familyName: "Nzume" },
};

const desk = { bookedByRole: "RECEPTIONIST", channel: "WALK_IN" };

/**
 * The register (atria.services.patients.register): the patients above with
 * invented patient numbers and fictional 555-01xx numbers, so nothing here
 * reaches a real phone.
 */
const register = Object.entries(patients).map(([id, name], i) => ({
  patientProfileId: id,
  ...name,
  phoneE164: `+1202555${String(1100 + i * 7)}`,
  patientNumber: `RHB-${String(120 + i * 13).padStart(6, "0")}`,
  dateOfBirth: `${1958 + ((i * 7) % 60)}-${String(1 + (i % 12)).padStart(2, "0")}-${String(3 + i).padStart(2, "0")}`,
  email: i === 0 ? "amina.ngo@example.com" : null,
  preferredLanguage: i % 3 === 0 ? "fr" : "en",
  hasAccount: i % 2 === 0,
  phoneVerified: i % 2 === 0,
  emailVerified: i === 0,
  source: i % 2 === 0 ? "SELF" : "DESK",
  createdAt: "2026-09-19T08:12:40Z",
}));
let registerNext = 300;

function fold(text: string) {
  return text
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .toLowerCase()
    .trim();
}

// Sessions and the outpatient queue (atria.services.booking.queue), for the
// general outpatient department: this morning and afternoon, and the week ahead.
interface MockSession {
  sessionId: string;
  clinicId: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  rosteredClinicianCount: number;
  expectedThroughputPerHour: string;
  actualThroughputPerHour: string | null;
  capacity: number;
  issuedTickets: number;
  status: string;
}
const opdSessions: MockSession[] = [];
for (let d = 0; d < 7; d += 1) {
  const date = new Date(Date.now() + OFFSET_MS + d * DAY_MS).toISOString().slice(0, 10);
  const weekday = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  // Sundays are closed, except today, so the preview always has a queue to show.
  if (weekday === 6 && d > 0) continue;
  for (const [start, end, rostered] of weekday === 5 ? [["08:00", "12:00", 2]] : [["07:30", "12:00", 3], ["13:00", "16:30", 2]]) {
    const hours = (Number(String(end).slice(0, 2)) * 60 + Number(String(end).slice(3)) - Number(String(start).slice(0, 2)) * 60 - Number(String(start).slice(3))) / 60;
    opdSessions.push({
      sessionId: `se-${date}-${String(start).replace(":", "")}`,
      clinicId: "u-rhb-opd",
      sessionDate: date,
      startTime: String(start),
      endTime: String(end),
      rosteredClinicianCount: Number(rostered),
      expectedThroughputPerHour: "4.5",
      actualThroughputPerHour: null,
      capacity: Math.floor(hours * Number(rostered) * 4.5),
      issuedTickets: d === 0 ? 14 : Math.max(0, 9 - d * 2),
      status: d === 0 && start === "07:30" ? "RUNNING" : "OPEN",
    });
  }
}
const sessionView = (s: MockSession) => ({
  ...s,
  remaining: Math.max(0, s.capacity - s.issuedTickets),
  partOfDay: Number(s.startTime.slice(0, 2)) < 12 ? "MORNING" : "AFTERNOON",
});
const queueNames = Object.keys(patients);
// Today's first session's tickets, as appointments.
const todayQueue: Record<string, unknown>[] = [];
{
  const first = opdSessions[0];
  if (first) {
    for (let n = 1; n <= first.issuedTickets; n += 1) {
      const window = new Date(Date.parse(`${first.sessionDate}T${first.startTime}:00Z`) - OFFSET_MS + (n - 1) * 13 * 60000 - 10 * 60000);
      todayQueue.push({
        appointmentId: `a-q${n}`,
        reference: `APT-Q${1000 + n}`,
        tenantId: "t-cm-001",
        clinicId: "u-rhb-opd",
        patientProfileId: queueNames[n % queueNames.length],
        appointmentTypeId: "at-gen-consult",
        clinicianProfileId: n <= 3 ? ["s-mbua", "s-nkwelle", "s-fomum"][n - 1] : null,
        sessionId: first.sessionId,
        position: n,
        startAt: iso(window),
        endAt: iso(new Date(window.getTime() + 30 * 60000)),
        arrivalWindowStart: iso(window),
        arrivalWindowEnd: iso(new Date(window.getTime() + 30 * 60000)),
        state: n <= 2 ? "COMPLETED" : n === 3 ? "IN_CONSULTATION" : n <= 5 ? "ARRIVED" : "BOOKED",
        channel: n % 3 === 0 ? "WALK_IN" : "ONLINE",
        bookedByRole: n % 3 === 0 ? "RECEPTIONIST" : null,
        version: 1,
        createdAt: iso(new Date(Date.now() - n * 3600000)),
      });
    }
  }
}
// Procedure requests waiting in the surgical unit's inbox.
const requests: Record<string, unknown>[] = [
  ["pp-kamga", "at-minor-proc", "A cyst on my left wrist, getting bigger"],
  ["pp-beyala", "at-minor-proc", "Ingrown toenail, referred by Muea health centre"],
  ["pp-essomba", "at-major-proc", "Hernia review the GP asked for"],
].map(([patient, type, note], i) => ({
  appointmentId: `a-r${i}`,
  reference: `APT-R${2000 + i}`,
  tenantId: "t-cm-001",
  clinicId: "u-rhb-surgery",
  patientProfileId: patient,
  appointmentTypeId: type,
  clinicianProfileId: null,
  sessionId: null,
  startAt: iso(new Date(Date.now() - (i + 1) * DAY_MS)),
  endAt: iso(new Date(Date.now() - (i + 1) * DAY_MS)),
  state: "REQUESTED",
  channel: "ONLINE",
  requestNote: note,
  version: 1,
  createdAt: iso(new Date(Date.now() - (i + 1) * DAY_MS)),
}));

// Priority allowances by staff id (atria.services.identity.staff.set_priority).
const allowances: Record<string, { quotaPerMonth: number; usedThisMonth: number }> = { "s-desk": { quotaPerMonth: 2, usedThisMonth: 1 } };

const appointments: Record<string, unknown>[] = [
  // The patient preview's own visits.
  appointment("s-mbarga", "at-spec-first", local(2, 10), "BOOKED", 1),
  appointment("s-bello", "at-spec-follow", local(8, 14, 20), "BOOKED", 3),
  // Leave took this one away (wave 3), so the patient is asked to choose again.
  appointment("s-tchoupo", "at-spec-first", local(4, 9), "DISRUPTED", 6),
  appointment("s-nkoulou", "at-spec-first", local(-20, 9), "COMPLETED", 27),
  appointment("s-fonkou", "at-spec-first", local(-5, 11, 30), "PATIENT_CANCELLED", 12),
  // A day at the Medical Unit, for the staff console.
  appointment("s-tabi", "at-spec-follow", local(0, 8, 30), "BOOKED", 3, { patient: "pp-tagne" }),
  appointment("s-nkoulou", "at-spec-first", local(0, 9), "BOOKED", 10, { patient: "pp-ekambi" }),
  appointment("s-bello", "at-spec-follow", local(0, 9, 40), "PATIENT_CANCELLED", 5, { patient: "pp-foka" }),
  appointment("s-tabi", "at-spec-first", local(0, 10, 30), "BOOKED", 2, { patient: "pp-nana", ...desk }),
  appointment("s-nkoulou", "at-spec-follow", local(0, 11, 20), "BOOKED", 0.5, { patient: "pp-mvondo", ...desk, channel: "PHONE" }),
  appointment("s-bello", "at-spec-first", local(0, 13, 30), "BOOKED", 6, { patient: "pp-atangana" }),
  appointment("s-tabi", "at-spec-follow", local(0, 14, 20), "CLINIC_CANCELLED", 4, { patient: "pp-kamga" }),
  appointment("s-nkoulou", "at-spec-first", local(0, 15), "BOOKED", 1, { patient: "pp-beyala" }),
  appointment("s-bello", "at-spec-follow", local(0, 16, 10), "BOOKED", 2, { patient: "pp-essomba", ...desk }),
  appointment("s-tabi", "at-spec-follow", local(1, 9, 20), "BOOKED", 4, { patient: "pp-ekambi" }),
  appointment("s-nkoulou", "at-spec-first", local(1, 11), "BOOKED", 2, { patient: "pp-foka" }),
  appointment("s-bello", "at-spec-first", local(1, 14), "BOOKED", 3, { patient: "pp-nana", ...desk }),
  appointment("s-tabi", "at-spec-first", local(-1, 10), "BOOKED", 6, { patient: "pp-beyala" }),
  appointment("s-nkoulou", "at-spec-follow", local(-1, 15, 30), "BOOKED", 3, { patient: "pp-tagne" }),
  appointment("s-tabi", "at-spec-follow", local(3, 8, 40), "BOOKED", 2, { patient: "pp-atangana" }),
  appointment("s-bello", "at-spec-first", local(4, 10, 20), "BOOKED", 1, { patient: "pp-kamga", ...desk }),
];

/** yyyy-mm-dd of an instant on the clinic's calendar. */
const clinicDate = (instant: unknown) => new Date(new Date(String(instant)).getTime() + OFFSET_MS).toISOString().slice(0, 10);

function named(found: Record<string, unknown>[]) {
  return Object.fromEntries(
    found.map((a) => [a.patientProfileId, patients[String(a.patientProfileId)] ?? { givenName: null, familyName: null }]),
  );
}

const byStart = (a: Record<string, unknown>, b: Record<string, unknown>) => String(a.startAt).localeCompare(String(b.startAt));

/** A few starts each day look taken, the same ones every time. */
function looksTaken(clinician: string, start: Date): boolean {
  let hash = 0;
  for (const char of `${clinician}${start.getTime()}`) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 5 === 0;
}

function freeStarts(clinicianId: string, date: string, typeId: string) {
  const clinician = clinicians.find((c) => c.clinicianProfileId === clinicianId);
  const clinic = clinics.find((c) => c.clinicId === clinician?.clinicId);
  const type = types.find((t) => t.appointmentTypeId === typeId);
  if (!clinician || !clinic || !type || onLeave(clinicianId, date)) return [];
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const weekday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  // The clinician's own hours once saved on Availability, else the unit's.
  const own = availability[clinicianId]?.hours;
  const hours = (own && Object.keys(own).length ? own : (clinic.openingHours as Record<string, { start: string; end: string }>))[
    String(weekday)
  ];
  if (!hours) return [];
  const at = (clock: string) => {
    const [h, m] = clock.split(":").map(Number) as [number, number];
    return Date.UTC(year, month - 1, day, h, m) - OFFSET_MS;
  };
  const units = type.durationUnits ?? 0;
  if (!units) return [];
  const held = (units + type.bufferUnits) * GRID * 60000;
  const slots = [];
  for (let start = at(hours.start); start + held <= at(hours.end); start += GRID * 60000 * 3) {
    const when = new Date(start);
    if (when.getTime() < Date.now() + (type.minNoticeMinutes ?? 0) * 60000) continue;
    if (looksTaken(clinicianId, when)) continue;
    const clash = appointments.some(
      (a) => a.clinicianProfileId === clinicianId && a.state === "BOOKED" && Math.abs(new Date(String(a.startAt)).getTime() - start) < held,
    );
    if (clash) continue;
    slots.push({ startAt: iso(when), endAt: iso(new Date(start + units * GRID * 60000)) });
  }
  return slots;
}

function json(status: number, body: unknown, delay = 420): Promise<Response> {
  return new Promise((resolve) =>
    window.setTimeout(
      () => resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })),
      delay,
    ),
  );
}

function answer(method: string, url: URL, body: unknown): Promise<Response> {
  const path = url.pathname.replace(/^\/api/, "");
  if (method === "GET" && path === "/clinicians") return json(200, { clinicians, count: clinicians.length });
  if (method === "GET" && path === "/clinics") return json(200, { clinics, count: clinics.length });
  if (method === "GET" && path === "/appointment-types") {
    const withForms = types.map((t) => ({ ...t, intakeForm: intakeForms.find((f) => f.intakeFormId === t.intakeFormId) ?? null }));
    return json(200, { gridUnitMinutes: GRID, appointmentTypes: withForms, count: types.length });
  }
  if (method === "GET" && path === "/patients/me/appointments") {
    const mine = appointments.filter((a) => a.patientProfileId === "pp-preview");
    return json(200, { when: "all", count: mine.length, appointments: mine });
  }
  const day = path.match(/^\/clinics\/([^/]+)\/day$/);
  if (method === "GET" && day && url.searchParams.get("from")) {
    const from = url.searchParams.get("from") as string;
    const to = url.searchParams.get("to") ?? from;
    const isAll = day[1] === "all";
    const found = appointments
      .filter((a) => (isAll || a.clinicId === day[1]) && clinicDate(a.startAt) >= from && clinicDate(a.startAt) <= to)
      .sort(byStart);
    return json(
      200,
      { clinicId: day[1], from, to, timezone: "Africa/Douala", count: found.length, appointments: found, patients: named(found) },
      380,
    );
  }
  if (method === "GET" && day) {
    const date = url.searchParams.get("date") ?? clinicDate(new Date());
    const isAll = day[1] === "all";
    const found = appointments.filter((a) => (isAll || a.clinicId === day[1]) && clinicDate(a.startAt) === date).sort(byStart);
    return json(
      200,
      { clinicId: day[1], date, timezone: "Africa/Douala", count: found.length, appointments: found, patients: named(found) },
      380,
    );
  }
  const calendar = path.match(/^\/clinicians\/([^/]+)\/calendar$/);
  if (method === "GET" && calendar) {
    const from = url.searchParams.get("from") ?? clinicDate(new Date());
    const to = url.searchParams.get("to") ?? from;
    const found = appointments
      .filter((a) => a.clinicianProfileId === calendar[1] && clinicDate(a.startAt) >= from && clinicDate(a.startAt) <= to)
      .sort(byStart);
    const clinicId = clinicians.find((c) => c.clinicianProfileId === calendar[1])?.clinicId;
    return json(
      200,
      {
        clinicianProfileId: calendar[1],
        clinicId,
        from,
        to,
        timezone: "Africa/Douala",
        count: found.length,
        appointments: found,
        patients: named(found),
      },
      380,
    );
  }
  const slots = path.match(/^\/clinicians\/([^/]+)\/slots$/);
  if (method === "GET" && slots && url.searchParams.get("from")) {
    const from = url.searchParams.get("from") as string;
    const to = url.searchParams.get("to") ?? from;
    const typeId = url.searchParams.get("typeId") ?? "";
    const days: Record<string, unknown> = {};
    for (let date = from; date <= to; date = clinicDate(new Date(Date.parse(`${date}T12:00:00Z`) + DAY_MS))) {
      days[date] = freeStarts(slots[1] as string, date, typeId);
    }
    return json(200, { clinicianProfileId: slots[1], from, to, appointmentTypeId: typeId, gridUnitMinutes: GRID, days }, 260);
  }
  if (method === "GET" && slots) {
    const date = url.searchParams.get("date") ?? "";
    const typeId = url.searchParams.get("typeId") ?? "";
    return json(
      200,
      {
        clinicianProfileId: slots[1],
        date,
        appointmentTypeId: typeId,
        gridUnitMinutes: GRID,
        slots: freeStarts(slots[1] as string, date, typeId),
      },
      260,
    );
  }
  // Care context (services/booking/care.py): the patient and the assigned
  // clinician read it; the desk, managers and administrators are refused.
  const careOf = path.match(/^\/appointments\/([^/]+)\/care-context$/);
  if (careOf) {
    const found = appointments.find((a) => a.appointmentId === careOf[1]);
    if (!found) return json(404, { code: "not_found", message: "no such appointment" });
    const as = new URLSearchParams(window.location.search).get("as") ?? "patient";
    const staffSide = !as.startsWith("patient");
    if (["receptionist", "manager", "admin", "admin-new", "opd"].includes(as)) {
      return json(403, { code: "forbidden", message: "that action is not permitted for this account" });
    }
    const form = formOf(found.appointmentTypeId);
    const open = ["BOOKED", "CONFIRMED", "RESCHEDULED", "DISRUPTED"].includes(String(found.state)) && Date.parse(String(found.startAt)) > Date.now();
    if (method === "PUT") {
      const given = body as { answers?: Record<string, unknown>; consent?: boolean };
      if (!form) return json(400, { code: "invalid_request", message: "this visit asks no questions" });
      if (given.consent !== true) return json(400, { code: "invalid_request", message: "sharing answers needs your consent" });
      const missing = (form.fields as { id: string; label: string; required?: boolean }[]).find(
        (f) => f.required && (given.answers?.[f.id] === undefined || given.answers?.[f.id] === ""),
      );
      if (missing) return json(400, { code: "invalid_request", message: `please answer: ${missing.label}` });
      careContexts[careOf[1] as string] = { answers: given.answers ?? {}, submittedAt: new Date().toISOString(), formVersion: form.version };
    }
    const held = careContexts[careOf[1] as string];
    return json(200, {
      appointmentId: careOf[1],
      patientProfileId: found.patientProfileId,
      form,
      answers: held?.answers ?? null,
      submittedAt: held?.submittedAt ?? null,
      editable: !staffSide && open && Boolean(form),
    }, 350);
  }
  const one = path.match(/^\/appointments\/([^/]+)$/);
  if (one) {
    const found = appointments.find((a) => a.appointmentId === one[1]) ?? todayQueue.find((a) => a.appointmentId === one[1]);
    if (!found) return json(404, { code: "not_found", message: "no such appointment" });
    if (method === "GET") {
      // The ledger entry once closed, and what cancelling now would record (FR-MSR-05, FR-MSR-06).
      const type = types.find((t) => t.appointmentTypeId === found.appointmentTypeId);
      const band = feeBands.find((b) => b.feeBandId === type?.feeBandId);
      const closedStates = ["COMPLETED", "NO_SHOW", "PATIENT_CANCELLED", "CLINIC_CANCELLED"];
      const hoursAway = (Date.parse(String(found.startAt)) - Date.now()) / 3600000;
      const late = hoursAway < 24;
      return json(200, {
        ...found,
        ledger: closedStates.includes(String(found.state))
          ? {
              feeBandId: band?.feeBandId ?? null,
              practice: band?.practice ?? null,
              amountMinor: band?.baseAmountMinor ?? null,
              currency: "XAF",
              outcome: found.state === "COMPLETED" ? "ATTENDED" : found.state === "NO_SHOW" ? "NO_SHOW" : found.state === "CLINIC_CANCELLED" ? "CLINIC_CANCELLED" : "CANCELLED_IN_WINDOW",
              entitlement: found.state === "COMPLETED" || found.state === "NO_SHOW" ? "NONE" : "FULL",
              settledAt: null,
            }
          : null,
        cancellationPreview: ["BOOKED", "CONFIRMED", "RESCHEDULED", "DISRUPTED"].includes(String(found.state))
          ? {
              outcome: late ? "CANCELLED_LATE" : "CANCELLED_IN_WINDOW",
              entitlement: late ? "PARTIAL" : "FULL",
              amountMinor: band?.baseAmountMinor ?? null,
              currency: "XAF",
              freeUntil: new Date(Date.parse(String(found.startAt)) - 24 * 3600000).toISOString(),
            }
          : null,
      });
    }
    if (method === "DELETE") {
      const late = new Date(String(found.startAt)).getTime() - Date.now() < DAY_MS;
      const byClinic = String((body as { cancelledBy?: string } | undefined)?.cancelledBy ?? "").toUpperCase() === "CLINIC";
      found.state = byClinic ? "CLINIC_CANCELLED" : "PATIENT_CANCELLED";
      found.version = Number(found.version) + 1;
      return json(200, {
        ...found,
        outcome: byClinic ? "CLINIC_CANCELLED" : late ? "CANCELLED_LATE" : "CANCELLED_IN_WINDOW",
        entitlement: byClinic || !late ? "FULL" : "PARTIAL",
        note: "The time is free again. Nothing is settled; the entitlement is a record.",
      });
    }
  }
  // A clinician's hours and time off (services/directory/availability.py), kept in memory.
  const avail = path.match(/^\/clinicians\/([^/]+)\/(availability|hours|time-off)(?:\/([^/]+))?$/);
  if (avail) {
    const id = avail[1] as string;
    const held = (availability[id] ??= { hours: {}, timeOff: [] });
    if (method === "GET" && avail[2] === "availability") {
      // The unit's own opening hours, the ones free times are cut from: a
      // fixed 08:00 to 16:00 here disagreed with the 07:30 booking offered.
      const unit = clinics.find((c) => c.clinicId === clinicians.find((c) => c.clinicianProfileId === id)?.clinicId);
      const unitHours = { ...((unit?.openingHours ?? {}) as Record<string, { start: string; end: string }>) };
      return json(200, {
        clinicianProfileId: id,
        usesUnitHours: !Object.keys(held.hours).length,
        hours: held.hours,
        unitHours,
        timeOff: held.timeOff,
      });
    }
    if (method === "PUT" && avail[2] === "hours") {
      const days = ((body as { days?: Record<string, { start: string; end: string } | null> }).days ?? {}) as Record<
        string,
        { start: string; end: string } | null
      >;
      held.hours = Object.fromEntries(Object.entries(days).filter(([, v]) => v)) as Record<string, { start: string; end: string }>;
      return json(200, { clinicianProfileId: id, usesUnitHours: false, hours: held.hours }, 500);
    }
    if (method === "POST" && avail[2] === "time-off") {
      const request = body as {
        kind: string;
        date?: string;
        from?: string;
        to?: string;
        startTime?: string;
        endTime?: string;
        reason: string;
      };
      const item = {
        groupId: `x-${Date.now()}`,
        kind: request.kind,
        from: request.from ?? request.date,
        to: request.to ?? request.date,
        startTime: request.startTime ?? null,
        endTime: request.endTime ?? null,
        reason: request.reason,
      };
      held.timeOff.push(item);
      return json(201, { ...item, disrupted: [] }, 500);
    }
    if (method === "DELETE" && avail[2] === "time-off") {
      held.timeOff = held.timeOff.filter((t) => t.groupId !== avail[3]);
      return json(200, { groupId: avail[3] });
    }
  }
  // What happens after booking (services/booking/visits.py), without the rules' fine print.
  const acted = path.match(/^\/appointments\/([^/]+)\/(reschedule|confirm|arrive|start|complete|no-show)$/);
  if (method === "POST" && acted) {
    const found = appointments.find((a) => a.appointmentId === acted[1]) ?? todayQueue.find((a) => a.appointmentId === acted[1]);
    if (!found) return json(404, { code: "not_found", message: "no such appointment" });
    const next: Record<string, string> = {
      reschedule: "RESCHEDULED",
      confirm: "CONFIRMED",
      arrive: "ARRIVED",
      start: "IN_CONSULTATION",
      complete: "COMPLETED",
      "no-show": "NO_SHOW",
    };
    if (acted[2] === "reschedule") {
      const startAt = String((body as { startAt?: string } | undefined)?.startAt ?? "");
      const length = new Date(String(found.endAt)).getTime() - new Date(String(found.startAt)).getTime();
      found.startAt = startAt;
      found.endAt = new Date(new Date(startAt).getTime() + length).toISOString().replace(".000Z", "Z");
    }
    found.state = next[acted[2] as string] as string;
    found.version = Number(found.version) + 1;
    return json(200, found, 500);
  }
  const unitSessions = path.match(/^\/clinics\/([^/]+)\/sessions$/);
  if (unitSessions && method === "GET") {
    // As the API does, a patient is not offered a session whose hours are over.
    const hospitalNow = new Date(Date.now() + OFFSET_MS).toISOString();
    const patient = !window.location.pathname.startsWith("/console");
    const open = (s: MockSession) => !patient || `${s.sessionDate}T${s.endTime}` > hospitalNow.slice(0, 16);
    return json(200, { clinicId: unitSessions[1], sessions: opdSessions.filter((s) => s.clinicId === unitSessions[1] && open(s)).map(sessionView) }, 300);
  }
  if (unitSessions && method === "POST") {
    const made = body as { date: string; startTime: string; endTime: string; rosteredClinicianCount: number };
    const hours = (Number(made.endTime.slice(0, 2)) * 60 + Number(made.endTime.slice(3)) - Number(made.startTime.slice(0, 2)) * 60 - Number(made.startTime.slice(3))) / 60;
    const created: MockSession = {
      sessionId: `se-${made.date}-${made.startTime.replace(":", "")}-${Math.random().toString(16).slice(2, 6)}`,
      clinicId: unitSessions[1] as string,
      sessionDate: made.date,
      startTime: made.startTime,
      endTime: made.endTime,
      rosteredClinicianCount: made.rosteredClinicianCount,
      expectedThroughputPerHour: "4.5",
      actualThroughputPerHour: null,
      capacity: Math.floor(hours * made.rosteredClinicianCount * 4.5),
      issuedTickets: 0,
      status: "OPEN",
    };
    opdSessions.push(created);
    opdSessions.sort((a, b) => `${a.sessionDate}${a.startTime}`.localeCompare(`${b.sessionDate}${b.startTime}`));
    return json(201, sessionView(created), 500);
  }
  const oneSession = path.match(/^\/sessions\/([^/]+)(?:\/(tickets|queue|next|close))?$/);
  if (oneSession) {
    const session = opdSessions.find((s) => s.sessionId === oneSession[1]);
    if (!session) return json(404, { code: "not_found", message: "no such session" });
    const tickets = [...todayQueue, ...appointments].filter((a) => a.sessionId === session.sessionId);
    if (method === "GET" && !oneSession[2]) return json(200, sessionView(session), 200);
    if (method === "GET" && oneSession[2] === "queue") {
      const count = (states: string[]) => tickets.filter((t) => states.includes(String(t.state))).length;
      // Seen per hour since the session opened, as the API works it out
      // (services/booking/queue.py); a fixed 11.2 never moved.
      const opens = Date.parse(`${session.sessionDate}T${session.startTime}:00Z`) - OFFSET_MS;
      const closes = Date.parse(`${session.sessionDate}T${session.endTime}:00Z`) - OFFSET_MS;
      const elapsed = Math.max(0, (Math.min(Date.now(), closes) - opens) / 3600000);
      const seen = count(["COMPLETED", "AWAITING_FEEDBACK"]);
      return json(
        200,
        {
          ...sessionView(session),
          appointments: tickets,
          patients,
          waiting: count(["BOOKED", "CONFIRMED", "RESCHEDULED"]),
          arrived: count(["ARRIVED"]),
          inConsultation: count(["IN_CONSULTATION"]),
          seen,
          plannedPerHour: 4.5 * session.rosteredClinicianCount,
          actualPerHour: elapsed >= 0.25 ? Math.round((seen / elapsed) * 100) / 100 : null,
        },
        300,
      );
    }
    if (method === "POST" && oneSession[2] === "tickets") {
      const request = (body ?? {}) as { patientProfileId?: string; channel?: string };
      session.issuedTickets += 1;
      const n = session.issuedTickets;
      const window = new Date(Date.parse(`${session.sessionDate}T${session.startTime}:00Z`) - OFFSET_MS + (n - 1) * 13 * 60000 - 10 * 60000);
      const made = {
        appointmentId: `a-t${Math.random().toString(16).slice(2, 8)}`,
        reference: `APT-T${3000 + n}`,
        tenantId: "t-cm-001",
        clinicId: session.clinicId,
        patientProfileId: request.patientProfileId ?? "pp-preview",
        appointmentTypeId: "at-gen-consult",
        clinicianProfileId: null,
        sessionId: session.sessionId,
        position: n,
        startAt: iso(window),
        endAt: iso(new Date(window.getTime() + 30 * 60000)),
        arrivalWindowStart: iso(window),
        arrivalWindowEnd: iso(new Date(window.getTime() + 30 * 60000)),
        state: "BOOKED",
        channel: request.patientProfileId ? (request.channel ?? "WALK_IN") : "ONLINE",
        bookedByRole: request.patientProfileId ? "RECEPTIONIST" : null,
        version: 1,
        createdAt: new Date().toISOString(),
      };
      appointments.push(made);
      return json(201, { ...made, of: session.issuedTickets }, 500);
    }
    if (method === "POST" && oneSession[2] === "next") {
      const next = tickets.find((t) => t.state === "ARRIVED");
      if (!next) return json(409, { code: "conflict", message: "nobody who has arrived is waiting" });
      next.state = "IN_CONSULTATION";
      next.clinicianProfileId = (body as { clinicianProfileId?: string } | undefined)?.clinicianProfileId ?? "s-mbua";
      return json(200, next, 400);
    }
    if (method === "POST" && oneSession[2] === "close") {
      session.status = "CLOSED";
      session.actualThroughputPerHour = "3.8";
      return json(200, sessionView(session), 400);
    }
  }
  const inbox = path.match(/^\/clinics\/([^/]+)\/requests$/);
  if (method === "GET" && inbox) {
    const waiting = requests.filter((r) => r.clinicId === inbox[1] && r.state === "REQUESTED");
    return json(200, { clinicId: inbox[1], count: waiting.length, appointments: waiting, patients }, 300);
  }
  if (method === "POST" && path === "/procedure-requests") {
    const asked = body as { appointmentTypeId: string; clinicId: string; note?: string };
    const made = {
      appointmentId: `a-r${Math.random().toString(16).slice(2, 8)}`,
      reference: `APT-R${Math.floor(Math.random() * 9000) + 1000}`,
      tenantId: "t-cm-001",
      clinicId: asked.clinicId,
      patientProfileId: "pp-preview",
      appointmentTypeId: asked.appointmentTypeId,
      clinicianProfileId: null,
      sessionId: null,
      startAt: new Date().toISOString(),
      endAt: new Date().toISOString(),
      state: "REQUESTED",
      channel: "ONLINE",
      requestNote: asked.note || null,
      version: 1,
      createdAt: new Date().toISOString(),
    };
    appointments.push(made);
    requests.push(made);
    return json(201, made, 500);
  }
  const decided = path.match(/^\/appointments\/([^/]+)\/(place|decline)$/);
  if (method === "POST" && decided) {
    const found = requests.find((r) => r.appointmentId === decided[1]);
    if (!found) return json(404, { code: "not_found", message: "no such request" });
    if (decided[2] === "decline") {
      const reason = (body as { reason?: string }).reason;
      if (!reason) return json(400, { code: "invalid_request", message: "a reason is required to decline" });
      Object.assign(found, { state: "DECLINED", declineReason: reason });
    } else {
      const placed = body as { clinicianProfileId: string; startAt: string };
      Object.assign(found, { state: "BOOKED", clinicianProfileId: placed.clinicianProfileId, startAt: placed.startAt, endAt: placed.startAt });
    }
    return json(200, found, 500);
  }
  // The unit's message log, failures first (FR-MSG-05). Fictional numbers only.
  const unitMessages = path.match(/^\/clinics\/([^/]+)\/messages$/);
  const everyUnit = method === "GET" && path === "/messages";
  if ((method === "GET" && unitMessages) || everyUnit) {
    const only = unitMessages?.[1];
    const day = url.searchParams.get("day") ?? clinicDate(new Date());
    const kinds = ["APPOINTMENT_REMINDER", "BOOKING_CONFIRMATION", "APPOINTMENT_REMINDER", "BOOKING_RESCHEDULED", "BOOKING_CANCELLATION"];
    const seed = Number(day.slice(-2));
    const rows = appointments
      .filter((a) => !only || a.clinicId === only)
      .slice(0, only ? 14 : 30)
      .map((a, i) => {
        const channel = i % 3 === 1 ? "EMAIL" : "SMS";
        const failed = (i + seed) % 5 === 0;
        const bounced = channel === "EMAIL" && (i + seed) % 7 === 3;
        const state = failed || bounced ? "FAILED" : i % 4 === 2 ? "SENT" : "DELIVERED";
        const name = patients[String(a.patientProfileId)] ?? { givenName: null, familyName: null };
        return {
          messageLogId: `ml-${day}-${i}`,
          appointmentId: a.appointmentId,
          clinicId: a.clinicId,
          clinicName: clinics.find((c) => c.clinicId === a.clinicId)?.name ?? null,
          kind: kinds[i % kinds.length],
          channel,
          recipient: channel === "SMS" ? `+2376000001${String(i).padStart(2, "0")}` : "patient@atria.invalid",
          deliveryState: state,
          feedback: bounced ? "BOUNCE" : null,
          failureReason: failed ? (channel === "SMS" ? "Phone is unreachable" : "Mailbox full") : null,
          settledAt: `${day}T${String(7 + (i % 10)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}:00Z`,
          reportedAt: null,
          person: {
            name: [name.givenName, name.familyName].filter(Boolean).join(" ") || null,
            phoneE164: `+2376000001${String(i).padStart(2, "0")}`,
          },
          visit: { startAt: a.startAt, state: a.state, patientProfileId: a.patientProfileId },
        };
      })
      .sort((x, y) => Number(y.deliveryState === "FAILED") - Number(x.deliveryState === "FAILED") || y.settledAt.localeCompare(x.settledAt));
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.deliveryState] = (counts[r.deliveryState] ?? 0) + 1;
    const unit = clinics.find((c) => c.clinicId === only);
    return json(200, { clinicId: only ?? null, clinicName: unit?.name ?? null, day, counts, messages: rows }, 380);
  }
  // The administrator's delivery figures (FR-MSG-06).
  if (method === "GET" && path === "/capacity") {
    // The administrator's coming week (services/directory/capacity.py), invented.
    const monday = new Date(Date.now() + OFFSET_MS);
    monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7 || 7));
    const iso = (days: number) => new Date(monday.getTime() + days * DAY_MS).toISOString().slice(0, 10);
    return json(
      200,
      {
        from: iso(0),
        to: iso(6),
        cliniciansOnShift: 12,
        leave: [{ clinicianProfileId: "s-tabi", clinicianName: "Ernest Tabi", clinicId: "u-rhb-medicine", clinicName: "Medical Unit", ...leaveWeek(), booked: 14 }],
        uncovered: [{ clinicId: "u-rhb-eye", clinicName: "Eye Unit", days: ["Fri"], dates: [iso(4)] }],
        covered: [
          { clinicId: "u-rhb-paeds", clinicName: "Paediatrics Unit", clinicians: 2, freeHours: 62 },
          { clinicId: "u-rhb-opd", clinicName: "General Outpatient Department", clinicians: 3, freeHours: 48 },
        ],
      },
      400,
    );
  }
  if (method === "GET" && path === "/messages/delivery") {
    const count = Number(url.searchParams.get("days") ?? "14");
    const today = clinicDate(new Date());
    const figures = (n: number) => {
      const attempted = n % 7 === 6 ? 0 : 18 + ((n * 11) % 25);
      const delivered = Math.max(0, attempted - (n % 3));
      const bounced = attempted ? n % 3 : 0;
      const texts = n % 7 === 6 ? 0 : 30 + ((n * 13) % 40);
      const textsDelivered = Math.max(0, texts - (n % 4));
      return {
        email: {
          attempted,
          delivered,
          failed: attempted - delivered,
          bounced,
          complained: n % 11 === 4 ? 1 : 0,
          deliveryRate: attempted ? Math.round((delivered / attempted) * 10000) / 10000 : null,
          bounceRate: attempted ? Math.round((bounced / attempted) * 10000) / 10000 : null,
          complaintRate: attempted ? (n % 11 === 4 ? Math.round((1 / attempted) * 10000) / 10000 : 0) : null,
        },
        sms: {
          attempted: texts,
          delivered: textsDelivered,
          failed: texts - textsDelivered,
          deliveryRate: texts ? Math.round((textsDelivered / texts) * 10000) / 10000 : null,
          spendUsd: (texts * 0.0322).toFixed(4),
        },
      };
    };
    const days = Array.from({ length: count }, (_, i) => {
      const day = new Date(Date.parse(`${today}T12:00:00Z`) - (count - 1 - i) * 86400000).toISOString().slice(0, 10);
      return { day, ...figures(i) };
    });
    const sum = (pick: (d: (typeof days)[number]) => number) => days.reduce((n, d) => n + pick(d), 0);
    const attempted = sum((d) => d.email.attempted);
    const texts = sum((d) => d.sms.attempted);
    return json(
      200,
      {
        from: days[0]?.day,
        to: today,
        senders: [{ identity: "notices@atria.invalid", type: "EMAIL_ADDRESS", verified: true, sendingEnabled: true, sandbox: true }],
        sms: { sandbox: true },
        totals: {
          email: {
            attempted,
            delivered: sum((d) => d.email.delivered),
            failed: sum((d) => d.email.failed),
            bounced: sum((d) => d.email.bounced),
            complained: sum((d) => d.email.complained),
            deliveryRate: attempted ? Math.round((sum((d) => d.email.delivered) / attempted) * 10000) / 10000 : null,
            bounceRate: attempted ? Math.round((sum((d) => d.email.bounced) / attempted) * 10000) / 10000 : null,
            complaintRate: attempted ? Math.round((sum((d) => d.email.complained) / attempted) * 10000) / 10000 : null,
          },
          sms: {
            attempted: texts,
            delivered: sum((d) => d.sms.delivered),
            failed: sum((d) => d.sms.failed),
            deliveryRate: texts ? Math.round((sum((d) => d.sms.delivered) / texts) * 10000) / 10000 : null,
            spendUsd: (texts * 0.0322).toFixed(4),
          },
        },
        days,
      },
      420,
    );
  }
  const unitReport = path.match(/^\/clinics\/([^/]+)\/report$/);
  if (method === "GET" && (unitReport || path === "/reports")) {
    const rawDate = url.searchParams.get("date") ?? url.searchParams.get("week") ?? new Date().toISOString().slice(0, 10);
    const granularity = (url.searchParams.get("granularity") ?? "week").toLowerCase();
    const mult = granularity === "day" ? 0.2 : granularity === "month" ? 4.2 : granularity === "year" ? 52 : 1;
    const figures = (seed: number) => {
      const base = 40 + ((seed * 17) % 60);
      const booked = Math.max(5, Math.round(base * mult));
      const attended = Math.round(booked * 0.71);
      const noShow = Math.round(booked * 0.09);
      const cancelled = Math.round(booked * 0.08);
      const late = Math.round(booked * 0.04);
      return {
        booked,
        attended,
        noShow,
        cancelled,
        lateCancelled: late,
        open: booked - attended - noShow - cancelled - late,
        attendance: Math.round((attended / (attended + noShow)) * 1000) / 1000,
        byChannel: [
          { channel: "ONLINE", booked: Math.round(booked * 0.55), attended: Math.round(attended * 0.56), noShow: Math.round(noShow * 0.6), attendance: 0.87 },
          { channel: "WALK_IN", booked: Math.round(booked * 0.25), attended: Math.round(attended * 0.27), noShow: 0, attendance: 1 },
          { channel: "PHONE", booked: Math.round(booked * 0.15), attended: Math.round(attended * 0.13), noShow: Math.round(noShow * 0.3), attendance: 0.8 },
          { channel: "REFERRAL", booked: Math.round(booked * 0.05), attended: Math.round(attended * 0.04), noShow: Math.round(noShow * 0.1), attendance: 0.75 },
        ],
        byReminder: [
          { reminder: "SENT", booked: Math.round(booked * 0.7), attended: Math.round(attended * 0.76), noShow: Math.round(noShow * 0.4), attendance: 0.94 },
          { reminder: "FAILED", booked: Math.round(booked * 0.05), attended: Math.round(attended * 0.04), noShow: Math.round(noShow * 0.2), attendance: 0.6 },
          { reminder: "NOT_SENT", booked: Math.round(booked * 0.25), attended: Math.round(attended * 0.2), noShow: Math.round(noShow * 0.4), attendance: 0.78 },
        ],
        ledger: {
          entries: attended + noShow + cancelled + late,
          currency: "XAF",
          byEntitlement: [
            { entitlement: "FULL", entries: cancelled, amountMinor: cancelled * 5000 },
            { entitlement: "NONE", entries: attended + noShow, amountMinor: (attended + noShow) * 3500 },
            { entitlement: "PARTIAL", entries: late, amountMinor: late * 5000 },
          ],
          byBand: [
            { practice: "Specialist, first visit", entries: Math.round(attended * 0.5), amountMinor: Math.round(attended * 0.5) * 5000 },
            { practice: "Specialist, follow-up", entries: Math.round(attended * 0.35), amountMinor: Math.round(attended * 0.35) * 3000 },
            { practice: "General consultation", entries: Math.round(attended * 0.15), amountMinor: Math.round(attended * 0.15) * 1500 },
          ],
        },
      };
    };
    if (unitReport) {
      const unit = clinics.find((c) => c.clinicId === unitReport[1]);
      return json(200, { clinicId: unitReport[1], clinicName: unit?.name ?? null, week: rawDate, from: rawDate, to: rawDate, granularity, firstDay: "2026-09-19", ...figures(clinics.indexOf(unit!)) }, 300);
    }
    const units = clinics.map((c, i) => ({ clinicId: c.clinicId, clinicName: c.name, week: rawDate, from: rawDate, to: rawDate, granularity, firstDay: "2026-09-19", ...figures(i) }));
    const sum = (key: "booked" | "attended" | "noShow" | "cancelled" | "lateCancelled") => units.reduce((n, u) => n + u[key], 0);
    return json(
      200,
      { week: rawDate, from: rawDate, to: rawDate, granularity, firstDay: "2026-09-19", units, booked: sum("booked"), attended: sum("attended"), noShow: sum("noShow"), cancelled: sum("cancelled"), lateCancelled: sum("lateCancelled") },
      300,
    );
  }
  if (method === "GET" && path === "/patients") {
    const q = (url.searchParams.get("q") ?? "").trim();
    const sort = url.searchParams.get("sort") ?? "date_desc";
    let list: typeof register;
    if (!q) {
      list = [...register];
    } else {
      const digits = q.replace(/[\s().-]/g, "");
      list = register.filter((p) =>
        /^\+?\d{4,}$/.test(digits)
          ? String(p.phoneE164).includes(digits.replace(/^\+/, ""))
          : /^[a-z]{1,4}-?\d{2,}$/i.test(q)
            ? String(p.patientNumber).replace("-", "").toLowerCase().startsWith(q.replace("-", "").toLowerCase())
            : fold(`${p.familyName} ${p.givenName}`).startsWith(fold(q)) || fold(`${p.givenName} ${p.familyName}`).startsWith(fold(q)),
      );
    }
    if (sort === "name_asc") {
      list.sort((a, b) => `${a.givenName} ${a.familyName}`.localeCompare(`${b.givenName} ${b.familyName}`));
    } else if (sort === "name_desc") {
      list.sort((a, b) => `${b.givenName} ${b.familyName}`.localeCompare(`${a.givenName} ${a.familyName}`));
    } else if (sort === "date_asc") {
      list.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
    } else {
      list.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    }
    return json(200, { q, sort, count: list.length, nextCursor: null, results: q ? list.slice(0, 50) : list }, 260);
  }
  if (method === "PATCH" && path === "/me") {
    const patch = body as {
      givenName?: string;
      familyName?: string;
      preferredLanguage?: string;
      dateOfBirth?: string;
      phoneE164?: string;
    };
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("atria:me-updated", { detail: patch }));
    }
    for (const s of staffAccounts) {
      if (patch.givenName && (s.staffId === "s-admin" || s.staffId === "s-doc-gp")) {
        s.givenName = patch.givenName;
        if (patch.familyName) s.familyName = patch.familyName;
      }
    }
    for (const c of clinicians) {
      if (patch.givenName && (c.clinicianProfileId === "s-doc-gp" || c.givenName?.includes("Tracy"))) {
        c.givenName = patch.givenName as any;
        if (patch.familyName) c.familyName = patch.familyName as any;
      }
    }
    return json(200, patch, 300);
  }
  // Notifications on this browser: the preview has no push service behind it.
  if (path === "/me/push") return json(200, method === "GET" ? { publicKey: null } : { subscribed: method === "POST" }, 200);
  if (method === "POST" && path === "/me/email") return json(200, {}, 300);
  if (method === "POST" && path === "/patients") {
    const made = body as { givenName: string; familyName: string; phoneE164: string; dateOfBirth?: string; sameNumberConfirmed?: boolean };
    const shared = register.filter((p) => p.phoneE164 === made.phoneE164);
    if (shared.length && !made.sameNumberConfirmed) {
      return json(409, { code: "conflict", message: "a patient already has that number", detail: { patients: shared } });
    }
    registerNext += 1;
    const entry = {
      patientProfileId: `pp-desk-${registerNext}`,
      givenName: made.givenName,
      familyName: made.familyName,
      phoneE164: made.phoneE164,
      patientNumber: `RHB-${String(registerNext).padStart(6, "0")}`,
      dateOfBirth: made.dateOfBirth ?? null,
      email: null,
      preferredLanguage: "en",
      hasAccount: false,
      phoneVerified: false,
      emailVerified: false,
      source: "DESK",
      createdAt: new Date().toISOString(),
    };
    register.push(entry as (typeof register)[number]);
    patients[entry.patientProfileId] = { givenName: made.givenName, familyName: made.familyName };
    return json(201, entry, 500);
  }
  const record = path.match(/^\/patients\/([^/]+)$/);
  if (method === "GET" && record && record[1] !== "me") {
    const found = register.find((p) => p.patientProfileId === record[1]);
    if (!found) return json(404, { code: "not_found", message: "no such patient" });
    // The visits in the caller's scope, as the API cuts them
    // (atria.services.patients.register.record).
    const visitScope = callerRole === "TENANT_ADMIN" ? "tenant" : callerRole === "CLINICIAN" ? "own" : "clinic";
    const visits = appointments
      .filter((a) => a.patientProfileId === found.patientProfileId)
      .filter((a) =>
        visitScope === "tenant" ? true : visitScope === "own" ? a.clinicianProfileId === caller.staffId : a.clinicId === caller.clinicId,
      )
      .sort((a, b) => String(b.startAt).localeCompare(String(a.startAt)));
    return json(200, { ...found, visitScope, appointments: visits }, 300);
  }
  const roster = path.match(/^\/clinics\/([^/]+)\/roster$/);
  if (method === "GET" && roster) {
    const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
    const unit = clinics.find((c) => c.clinicId === roster[1]);
    const weekday = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
    const hours = unit?.openingHours[String(weekday)];
    const now = new Date(Date.now() + OFFSET_MS).toISOString().slice(11, 16);
    const today = date === new Date().toISOString().slice(0, 10);
    const rows = clinicians
      .filter((c) => c.clinicId === roster[1])
      .map((c, i) => {
        const visits = appointments.filter(
          (a) => a.clinicianProfileId === c.clinicianProfileId && String(a.startAt).slice(0, 10) === date && a.state !== "PATIENT_CANCELLED",
        ).length + (i * 3) % 7;
        const leave = Boolean(hours) && onLeave(c.clinicianProfileId, date);
        const status = !hours
          ? "OFF"
          : leave
            ? "LEAVE"
            : !today
              ? "SCHEDULED"
              : now < hours.start
                ? "LATER"
                : now < hours.end
                  ? "ON_SHIFT"
                  : "FINISHED";
        const working = hours ? (Number(hours.end.slice(0, 2)) - Number(hours.start.slice(0, 2))) * 60 : 0;
        return {
          clinicianProfileId: c.clinicianProfileId,
          givenName: c.givenName,
          familyName: c.familyName,
          specialty: c.specialty,
          status,
          startsAt: hours?.start ?? null,
          endsAt: hours?.end ?? null,
          timeOff: !hours ? [] : leave ? [{ kind: "LEAVE", startTime: null, endTime: null }] : i === 1 ? [{ kind: "BLOCK", startTime: "12:00", endTime: "13:00" }] : [],
          visits: leave || !hours ? 0 : visits,
          bookedMinutes: leave || !hours ? 0 : visits * 30,
          workingMinutes: leave ? 0 : working,
          load: leave || !working ? null : Math.min(1, (visits * 30) / working),
        };
      });
    return json(200, { clinicId: roster[1], date, clinicians: rows, onShift: rows.filter((r) => r.status === "ON_SHIFT").length }, 300);
  }
  if (method === "GET" && path === "/audit/changes") {
    const week = url.searchParams.get("week") ?? new Date().toISOString().slice(0, 10);
    const inWeek = auditEntries.filter(
      (e) => (e.action === "appointment.cancel" || e.action === "appointment.reschedule") && e.occurredAt.slice(0, 10) >= week,
    );
    const groups = new Map<string, Record<string, unknown> & { changes: unknown[] }>();
    for (const e of inWeek) {
      const g = groups.get(e.actorPersonId) ?? {
        actorPersonId: e.actorPersonId,
        actorName: e.actorName,
        actorRole: e.actorRole,
        cancellations: 0,
        reschedules: 0,
        flagged: 0,
        changes: [],
      };
      if (e.action === "appointment.cancel") g.cancellations = Number(g.cancellations) + 1;
      else g.reschedules = Number(g.reschedules) + 1;
      if (e.flags.length) g.flagged = Number(g.flagged) + 1;
      g.changes.push({ auditEntryId: e.auditEntryId, occurredAt: e.occurredAt, action: e.action, appointmentId: "a-4958", reason: e.reason, flags: e.flags });
      groups.set(e.actorPersonId, g);
    }
    const actors = [...groups.values()].sort((a, b) => Number(b.flagged) - Number(a.flagged));
    return json(200, { week, to: week, actors, total: inWeek.length, flagged: inWeek.filter((e) => e.flags.length).length }, 300);
  }
  if (path === "/admin/settings") {
    if (method === "GET") return json(200, settingsOverview());
    if (method === "PATCH") {
      Object.assign(tenant, body as Record<string, unknown>);
      return json(200, settingsOverview().tenant, 500);
    }
  }
  if (method === "POST" && path === "/admin/clinics") {
    const raw = body as Record<string, unknown>;
    const clinicId = (raw.clinicId as string) || `c-${Math.random().toString(16).slice(2, 8)}`;
    const created = {
      clinicId,
      name: String(raw.name || "").trim(),
      phone: String(raw.phone || "").trim(),
      description: String(raw.description || "").trim(),
      services: Array.isArray(raw.services) ? raw.services : [],
      openingHours: (raw.openingHours as Record<string, unknown>) || {
        "0": { start: "07:30", end: "15:30" },
        "1": { start: "07:30", end: "15:30" },
        "2": { start: "07:30", end: "15:30" },
        "3": { start: "07:30", end: "15:30" },
        "4": { start: "07:30", end: "15:30" },
      },
      location: (raw.location as Record<string, unknown>) || null,
    };
    clinics.push(created as unknown as (typeof clinics)[number]);
    return json(201, created, 500);
  }
  const unit = path.match(/^\/admin\/clinics\/([^/]+)$/);
  if (method === "PATCH" && unit) {
    const found = clinics.find((c) => c.clinicId === unit[1]);
    if (!found) return json(404, { code: "not_found", message: "no such unit" });
    Object.assign(found, body as Record<string, unknown>);
    for (const [day, span] of Object.entries(found.openingHours)) if (!span) delete found.openingHours[day];
    return json(200, found, 500);
  }
  if (method === "DELETE" && unit) {
    const index = clinics.findIndex((c) => c.clinicId === unit[1]);
    if (index === -1) return json(404, { code: "not_found", message: "no such unit" });
    clinics.splice(index, 1);
    return json(200, { deleted: true, clinicId: unit[1] }, 500);
  }
  if (method === "POST" && path === "/admin/appointment-types") {
    const created: MockType = {
      ...(body as MockType),
      appointmentTypeId: `at-${Math.random().toString(16).slice(2, 8)}`,
      code: null,
      active: true,
    };
    types.push(created);
    return json(201, created, 500);
  }
  // Intake forms (services/admin/settings.py): each save publishes a new version.
  if (method === "POST" && path === "/admin/intake-forms") {
    const made = { ...(body as { name: string; fields: unknown[] }), intakeFormId: `if-${Math.random().toString(16).slice(2, 8)}`, version: 1 };
    intakeForms.push(made);
    return json(201, made, 500);
  }
  const intakeForm = path.match(/^\/admin\/intake-forms\/([^/]+)$/);
  if (method === "PUT" && intakeForm) {
    const found = intakeForms.find((f) => f.intakeFormId === intakeForm[1]);
    if (!found) return json(404, { code: "not_found", message: "no such intake form" });
    Object.assign(found, body as Record<string, unknown>, { version: found.version + 1 });
    return json(200, found, 500);
  }
  const visitType = path.match(/^\/admin\/appointment-types\/([^/]+)$/);
  if (method === "PATCH" && visitType) {
    const found = types.find((t) => t.appointmentTypeId === visitType[1]);
    if (!found) return json(404, { code: "not_found", message: "no such appointment type" });
    Object.assign(found, body as Record<string, unknown>);
    return json(200, found, 500);
  }
  const band = path.match(/^\/admin\/fee-bands\/([^/]+)$/);
  if (method === "PUT" && band) {
    const found = feeBands.find((b) => b.feeBandId === band[1]);
    if (!found) return json(404, { code: "not_found", message: "no such fee band" });
    Object.assign(found, body as Record<string, unknown>, { effectiveFrom: new Date().toISOString().slice(0, 10) });
    return json(200, found, 500);
  }
  if (method === "GET" && path === "/audit") {
    const { reachable, chosen } = auditSelection(url);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const offset = Number(url.searchParams.get("cursor") ?? 0);
    const actors = new Map(reachable.map((e) => [e.actorPersonId, { personId: e.actorPersonId, name: e.actorName, role: e.actorRole }]));
    return json(200, {
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      count: chosen.length,
      nextCursor: offset + limit < chosen.length ? String(offset + limit) : null,
      entries: chosen.slice(offset, offset + limit),
      actors: [...actors.values()].sort((a, b) => a.name.localeCompare(b.name)),
      actions: [...new Set(reachable.map((e) => e.action))].sort(),
    });
  }
  if (method === "GET" && path === "/audit/export") {
    const { chosen } = auditSelection(url);
    const rows = [
      "occurredAt,actor,actorRole,action,kind,subjectType,subjectId,clinicId,patientProfileIds,reason,flags,ip",
      ...chosen.map((e) =>
        [
          e.occurredAt,
          e.actorName,
          e.actorRole,
          e.action,
          e.kind,
          e.subjectType,
          e.subjectId,
          e.clinicId,
          "",
          e.reason ?? "",
          e.flags.join(" "),
          e.source.ip,
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    return new Promise((resolve) =>
      window.setTimeout(
        () =>
          resolve(
            new Response(rows.join("\r\n"), {
              status: 200,
              headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="atria-audit-preview.csv"' },
            }),
          ),
        500,
      ),
    );
  }
  if (method === "GET" && path === "/admin/staff") {
    // Searched, filtered and paged as the API does it (atria.services.identity.staff.list_accounts).
    const sorted = [...staffAccounts].sort((a, b) => `${a.givenName} ${a.familyName}`.localeCompare(`${b.givenName} ${b.familyName}`));
    const statusOf = (a: Record<string, unknown>) =>
      a.status === "DELETION_PENDING" ? "deleted" : a.status === "SUSPENDED" ? "suspended" : a.mustSetPassword ? "awaiting" : "active";
    const count = (keyOf: (a: Record<string, unknown>) => string[]) =>
      sorted.reduce<Record<string, number>>((all, a) => {
        for (const key of keyOf(a)) all[key] = (all[key] ?? 0) + 1;
        return all;
      }, {});
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const role = url.searchParams.get("role");
    const clinic = url.searchParams.get("clinic");
    const status = url.searchParams.get("status");
    const found = sorted.filter(
      (a) =>
        (!q ||
          [
            `${a.givenName} ${a.familyName}`,
            `${a.familyName} ${a.givenName}`,
            String(a.signInName),
            ...(a.roles as string[]).map((r) => ROLE_WORDS[r] ?? r.toLowerCase()),
          ].some((f) => f.toLowerCase().includes(q))) &&
        (!role || (a.roles as string[]).includes(role)) &&
        (!clinic || a.clinicId === clinic) &&
        (!status || statusOf(a) === status),
    );
    const sort = url.searchParams.get("sort") ?? "name_asc";
    if (sort === "name_desc") {
      found.sort((a, b) => `${b.givenName} ${b.familyName}`.localeCompare(`${a.givenName} ${a.familyName}`));
    } else if (sort === "date_desc") {
      found.sort((a, b) => String(b.createdAt ?? b.staffId).localeCompare(String(a.createdAt ?? a.staffId)));
    } else if (sort === "date_asc") {
      found.sort((a, b) => String(a.createdAt ?? a.staffId).localeCompare(String(b.createdAt ?? b.staffId)));
    } else {
      found.sort((a, b) => `${a.givenName} ${a.familyName}`.localeCompare(`${b.givenName} ${b.familyName}`));
    }
    const limit = Math.min(50, Number(url.searchParams.get("limit") ?? 25));
    const start = Number(atob(url.searchParams.get("cursor") ?? "") || 0);
    const after = start + limit;
    return json(200, {
      count: found.length,
      total: sorted.length,
      accounts: found.slice(start, after).map((a) => ({ ...a, priorityAllowance: allowances[String(a.staffId)] ?? null })),
      nextCursor: after < found.length ? btoa(String(after)) : null,
      facets: {
        roles: count((a) => a.roles as string[]),
        clinics: count((a) => (a.clinicId ? [String(a.clinicId)] : [])),
        status: count((a) => [statusOf(a)]),
      },
    });
  }
  const allowance = path.match(/^\/admin\/staff\/([^/]+)\/priority-allowance$/);
  if (method === "PUT" && allowance) {
    const quota = Number((body as { quotaPerMonth: number }).quotaPerMonth);
    const id = allowance[1] as string;
    if (quota) allowances[id] = { quotaPerMonth: quota, usedThisMonth: allowances[id]?.usedThisMonth ?? 0 };
    else delete allowances[id];
    return json(200, { staffId: id, priorityAllowance: allowances[id] ?? null }, 400);
  }
  const roles = path.match(/^\/admin\/staff\/([^/]+)\/roles$/);
  if (method === "PATCH" && roles) {
    const found = staffAccounts.find((a) => a.staffId === roles[1]);
    if (!found) return json(404, { code: "not_found", message: "no such staff account" });
    found.roles = (body as { roles: string[] }).roles;
    return json(200, { ...found, note: "The new roles apply at the account's next sign-in." });
  }
  // Deleting and restoring accounts, with 30 days' grace (services/identity/deletion.py).
  const purgeIn30 = () => new Date(Date.now() + 30 * DAY_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
  const staffGone = path.match(/^\/admin\/staff\/([^/]+)(\/restore)?$/);
  if (staffGone && (method === "DELETE" || (method === "POST" && staffGone[2]))) {
    const found = staffAccounts.find((a) => a.staffId === staffGone[1]) as Record<string, unknown> | undefined;
    if (!found) return json(404, { code: "not_found", message: "no such staff account" });
    if (method === "DELETE") {
      found.statusBefore = found.status;
      found.status = "DELETION_PENDING";
      found.purgeAt = purgeIn30();
      return json(200, { purgeAt: found.purgeAt, by: "ADMIN", graceDays: 30 }, 500);
    }
    found.status = found.statusBefore ?? "ACTIVE";
    found.purgeAt = null;
    return json(200, { restored: true }, 500);
  }
  const patientGone = path.match(/^\/admin\/patients\/([^/]+)(\/restore)?$/);
  if (patientGone && (method === "DELETE" || (method === "POST" && patientGone[2]))) {
    const entry = register.find((p) => p.patientProfileId === patientGone[1]) as Record<string, unknown> | undefined;
    if (!entry) return json(404, { code: "not_found", message: "no such patient" });
    entry.deletionPurgeAt = method === "DELETE" ? purgeIn30() : null;
    return json(200, method === "DELETE" ? { purgeAt: entry.deletionPurgeAt, by: "ADMIN", graceDays: 30, cancelledVisits: 1 } : { restored: true }, 500);
  }
  if (method === "DELETE" && path === "/me") return json(200, { purgeAt: purgeIn30(), by: "SELF", graceDays: 30, cancelledVisits: 2 }, 500);
  if (method === "POST" && path === "/me/restore") return json(200, { restored: true }, 500);
  const suspend = path.match(/^\/admin\/staff\/([^/]+)\/suspend$/);
  if (method === "POST" && suspend) {
    const found = staffAccounts.find((a) => a.staffId === suspend[1]);
    if (!found) return json(404, { code: "not_found", message: "no such staff account" });
    found.status = "SUSPENDED";
    return json(200, { ...found, note: "Sessions revoked." });
  }
  if (method === "POST" && path === "/admin/staff") {
    const request = body as {
      givenName: string;
      familyName: string;
      phoneE164: string;
      email?: string;
      clinicId?: string;
      roles: string[];
    };
    if (usedPhones.has(request.phoneE164))
      return json(409, { code: "conflict", message: "that phone number or email is already in use" }, 600);
    usedPhones.add(request.phoneE164);
    staffAccounts.push({
      staffId: `s-${Math.random().toString(16).slice(2, 10)}`,
      givenName: request.givenName,
      familyName: request.familyName,
      signInName: request.email ?? request.phoneE164,
      clinicId: request.clinicId ?? null,
      roles: request.roles,
      status: "INVITED",
      mustSetPassword: true,
    });
    return json(
      201,
      {
        staffId: `s-${Math.random().toString(16).slice(2, 10)}`,
        personId: `p-${Math.random().toString(16).slice(2, 10)}`,
        tenantId: "t-cm-001",
        clinicId: request.clinicId ?? null,
        roles: request.roles,
        status: "INVITED",
        givenName: request.givenName,
        familyName: request.familyName,
        phoneE164: request.phoneE164,
        email: request.email ?? null,
        signInName: request.email ?? request.phoneE164,
        temporaryPassword: `Tmp-${Math.random().toString(36).slice(2, 6)}-${Math.random().toString(36).slice(2, 6)}`,
        note: "The account signs in with the temporary password and must change it.",
      },
      60,
    );
  }
  if (method === "POST" && path === "/appointments") {
    const request = body as {
      clinicianProfileId: string;
      appointmentTypeId: string;
      startAt: string;
      patientProfileId?: string;
      channel?: string;
    };
    const date = request.startAt ? new Date(new Date(request.startAt).getTime() + OFFSET_MS).toISOString().slice(0, 10) : "";
    const free = freeStarts(request.clinicianProfileId, date, request.appointmentTypeId).some((s) => s.startAt === request.startAt);
    // Ten o'clock slots are "just taken" once, so the conflict screen can be seen.
    if (!free || (request.startAt.endsWith("09:00:00Z") && !conflictShown)) {
      conflictShown = true;
      return json(409, { code: "conflict", message: "that time has just been taken" }, 600);
    }
    // A staff booking names its patient and channel (FR-BKG-07, FR-STF-14).
    const made = appointment(
      request.clinicianProfileId,
      request.appointmentTypeId,
      new Date(request.startAt),
      "BOOKED",
      0,
      request.patientProfileId ? { patient: request.patientProfileId, bookedByRole: callerRole, channel: request.channel } : {},
    );
    appointments.push(made);
    const intake = (body as { intake?: { answers?: Record<string, unknown>; consent?: boolean } }).intake;
    if (intake?.consent) {
      careContexts[String(made.appointmentId)] = { answers: intake.answers ?? {}, submittedAt: new Date().toISOString(), formVersion: 1 };
      return json(201, { ...made, careContext: "SAVED" }, 700);
    }
    return json(201, made, 700);
  }
  return json(404, { code: "not_found", message: `the preview has no ${method} ${path}` });
}

let conflictShown = false;
// Who is signed in to the preview, so a staff booking is recorded against
// their role as the API records it (role_used), not always the desk's.
let callerRole = "RECEPTIONIST";
let caller: { clinicId: string | null; staffId: string | null } = { clinicId: null, staffId: null };
export function setPreviewCaller(me: { roles: readonly string[]; clinicId?: string | null; staffId?: string | null }): void {
  callerRole = me.roles.find((r) => r !== "PATIENT") ?? "PATIENT";
  caller = { clinicId: me.clinicId ?? null, staffId: me.staffId ?? null };
}
const availability: Record<string, { hours: Record<string, { start: string; end: string }>; timeOff: { groupId: string }[] }> = {};
// A second account with the same number is refused, as the pool refuses it.
const usedPhones = new Set<string>(["+12025550142"]);

/** What a role answers to in a search, as the API has it (atria.services.identity.staff.ROLE_WORDS). */
const ROLE_WORDS: Record<string, string> = {
  RECEPTIONIST: "receptionist front desk",
  CLINICIAN: "clinician doctor",
  CLINIC_MANAGER: "clinic manager",
  TENANT_ADMIN: "tenant administrator admin",
};

/** The console's accounts, for Staff accounts. Invented, like everything here. */
const staffAccounts: Record<string, unknown>[] = [
  ["s-admin", "Sandrine", "Eyenga", "s.eyenga@example.com", null, ["TENANT_ADMIN"], "ACTIVE", false],
  ["s-desk", "Nadine", "Fotso", "n.fotso@example.com", "u-rhb-medicine", ["RECEPTIONIST"], "ACTIVE", false],
  ["s-mbarga", "Esther", "Mbarga", "e.mbarga@example.com", "u-rhb-paediatrics", ["CLINICIAN"], "ACTIVE", false],
  ["s-nkoulou", "Jean-Paul", "Nkoulou", "+12025550161", "u-rhb-medicine", ["CLINICIAN"], "ACTIVE", false],
  ["s-manager", "Rodrigue", "Owona", "r.owona@example.com", "u-rhb-medicine", ["CLINIC_MANAGER"], "ACTIVE", false],
  ["s-new", "Kofi", "Ngassa", "+12025550163", "u-rhb-opd", ["RECEPTIONIST"], "INVITED", true],
  ["s-gone", "Joyce", "Ebolo", "j.ebolo@example.com", "u-rhb-medicine", ["RECEPTIONIST"], "SUSPENDED", false],
  // Enough more to fill a few pages. Invented names, and 555-01xx numbers that reach nobody.
  ...[
    ["Brice", "Tagne"],
    ["Chantal", "Ekambi"],
    ["Didier", "Foka"],
    ["Estelle", "Nana"],
    ["Fabrice", "Mvondo"],
    ["Gisele", "Atangana"],
    ["Herve", "Kamga"],
    ["Ines", "Beyala"],
    ["Joel", "Essomba"],
    ["Laure", "Mbida"],
    ["Marc", "Onana"],
    ["Nadege", "Ze"],
    ["Olivier", "Abena"],
    ["Patricia", "Ndzie"],
    ["Quentin", "Etoundi"],
    ["Rose", "Messi"],
    ["Serge", "Bikoe"],
    ["Therese", "Mballa"],
  ].map(([given, family], i) => [
    `s-extra-${i}`,
    given,
    family,
    `+120255501${String(70 + i).padStart(2, "0")}`,
    ["u-rhb-opd", "u-rhb-medicine", "u-rhb-paediatrics", "u-rhb-maternity", "u-rhb-eye"][i % 5],
    [i % 4 === 0 ? "CLINIC_MANAGER" : "RECEPTIONIST"],
    i % 7 === 3 ? "INVITED" : "ACTIVE",
    i % 7 === 3,
  ]),
].map(([staffId, givenName, familyName, signInName, clinicId, roles, status, mustSetPassword]) => ({
  staffId,
  givenName,
  familyName,
  signInName,
  clinicId,
  roles,
  status,
  mustSetPassword,
}));

// The audit log (atria.services.audit.log): a spread of the last ten days, by
// the preview's own staff. Invented, like everything here.
const AUDIT_ACTORS = [
  { personId: "p-desk", name: "Nadine Fotso", role: "RECEPTIONIST", clinicId: "u-rhb-medicine" },
  { personId: "p-nkoulou", name: "Jean-Paul Nkoulou", role: "CLINICIAN", clinicId: "u-rhb-medicine" },
  { personId: "p-manager", name: "Rodrigue Owona", role: "CLINIC_MANAGER", clinicId: "u-rhb-medicine" },
  { personId: "p-admin", name: "Sandrine Eyenga", role: "TENANT_ADMIN", clinicId: null },
];
const AUDIT_KINDS: [string, "READ" | "WRITE", string, number, string | null][] = [
  ["schedule.day", "READ", "CLINIC", 9, null],
  ["appointment.read", "READ", "APPOINTMENT", 1, null],
  ["appointment.arrive", "WRITE", "APPOINTMENT", 1, null],
  ["appointment.reschedule", "WRITE", "APPOINTMENT", 1, "Patient asked for the afternoon"],
  ["appointment.cancel", "WRITE", "APPOINTMENT", 1, "Clinician called away"],
  ["schedule.calendar", "READ", "CLINICIAN", 6, null],
  ["availability.time_off", "WRITE", "CLINICIAN", 0, "Conference in Douala"],
  ["staff.update_roles", "WRITE", "STAFF", 0, null],
];
const auditEntries = Array.from({ length: 64 }, (_, i) => {
  const actor = AUDIT_ACTORS[i % 3 === 2 && i % 9 === 8 ? 3 : i % 3]!;
  const [action, kind, subjectType, patientCount, reason] = AUDIT_KINDS[(i * 5) % AUDIT_KINDS.length]!;
  const occurredAt = new Date(Date.now() - i * 3.6 * 3600000 - 7 * 60000).toISOString();
  return {
    auditEntryId: `au-${i}`,
    occurredAt,
    actorPersonId: actor.personId,
    actorName: actor.name,
    actorRole: actor.role,
    action,
    kind,
    subjectType,
    subjectId: `${subjectType.toLowerCase()}-${i}`,
    clinicId: actor.clinicId ?? "u-rhb-opd",
    patientCount,
    reason,
    flags: i === 4 ? ["POTENTIAL_SELF_BENEFIT"] : [],
    source: { ip: `196.202.${10 + (i % 4)}.${20 + (i % 7)}` },
  };
});

function auditSelection(url: URL) {
  const from = url.searchParams.get("from") ?? "0000";
  const to = `${url.searchParams.get("to") ?? "9999"}T23:59:59Z`;
  const actor = url.searchParams.get("actor");
  const action = url.searchParams.get("action");
  const kind = url.searchParams.get("kind");
  const reachable = auditEntries.filter((e) => e.occurredAt >= from && e.occurredAt <= to);
  const chosen = reachable.filter(
    (e) => (!actor || e.actorPersonId === actor) && (!action || e.action === action) && (!kind || e.kind === kind),
  );
  return { from, reachable, chosen };
}

export function installMockApi(): void {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    if (!url.pathname.startsWith("/api/")) return real(input, init);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    return answer((init?.method ?? "GET").toUpperCase(), url, body);
  };
}
