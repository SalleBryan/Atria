/**
 * A stand-in for the Atria API, for the development preview only.
 *
 * It answers the routes the patient screens call with invented data, in the
 * same shapes as docs/openapi/atria.yaml, and keeps bookings and
 * cancellations in memory, so a screen can be looked at, clicked through and
 * checked without anyone signing in. Every name is invented. Nothing here is
 * imported outside src/dev, and src/dev is only loaded by the dev server.
 *
 * Clinic time is UTC+1 all year (Africa/Douala has no daylight saving), so
 * local times are built with a fixed offset.
 */

const OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const GRID = 10;

const clinics = [
  {
    clinicId: "c-douala-akwa",
    name: "Clinique d'Akwa",
    address: "Rue Joss, Akwa, Douala",
    phone: "+1 202 555 0147",
    openingHours: Object.fromEntries(
      [0, 1, 2, 3, 4].map((day) => [String(day), { start: "08:00", end: "17:00" }]).concat([["5", { start: "08:00", end: "12:00" }]]),
    ),
  },
  {
    clinicId: "c-yaounde-bastos",
    name: "Centre medical de Bastos",
    address: "Avenue Bastos, Yaounde",
    phone: "+1 202 555 0183",
    openingHours: Object.fromEntries([0, 1, 2, 3, 4].map((day) => [String(day), { start: "08:00", end: "16:30" }])),
  },
];

const clinicians = [
  ["s-mbarga", "Esther", "Mbarga", "Paediatrics", 2008, "c-douala-akwa", "EXPERIENCED", ["fr", "en"]],
  ["s-nkoulou", "Jean-Paul", "Nkoulou", "Cardiology", 1999, "c-douala-akwa", "SENIOR", ["fr"]],
  ["s-bello", "Aicha", "Bello", "Dermatology", 2015, "c-yaounde-bastos", "EXPERIENCED", ["fr", "en"]],
  ["s-tchoupo", "Samuel", "Tchoupo", "Gynaecology", 2011, "c-yaounde-bastos", "EXPERIENCED", ["fr"]],
  ["s-fonkou", "Grace", "Fonkou", "Ophthalmology", 2019, "c-douala-akwa", "ESTABLISHED", ["en", "fr"]],
].map(([id, given, family, specialty, year, clinic, band, languages]) => ({
  clinicianProfileId: id,
  clinicId: clinic,
  givenName: given,
  familyName: family,
  specialty,
  qualifications: [],
  registrationYear: year,
  seniorityBand: band,
  languages,
}));

const types = [
  {
    appointmentTypeId: "at-spec-first",
    code: "SPEC_FIRST",
    name: "First specialist consultation",
    serviceLine: "SPECIALIST",
    durationUnits: 3,
    bufferUnits: 1,
    bookableBy: "BOTH",
    minNoticeMinutes: 30,
    maxAdvanceDays: 60,
    cancellationWindowMinutes: 1440,
  },
  {
    appointmentTypeId: "at-spec-follow",
    code: "SPEC_FOLLOW",
    name: "Follow-up consultation",
    serviceLine: "SPECIALIST",
    durationUnits: 2,
    bufferUnits: 1,
    bookableBy: "BOTH",
    minNoticeMinutes: 30,
    maxAdvanceDays: 60,
    cancellationWindowMinutes: 1440,
  },
];

/** A clinic-local wall time, days from today, as a UTC instant. */
function local(daysFromToday: number, hour: number, minute = 0): Date {
  const now = new Date(Date.now() + OFFSET_MS);
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysFromToday, hour, minute);
  return new Date(day - OFFSET_MS);
}

const iso = (instant: Date) => instant.toISOString().replace(/\.\d{3}Z$/, "Z");

let sequence = 4821;
function appointment(
  clinician: string,
  type: string,
  start: Date,
  state: string,
  createdDaysAgo: number,
): Record<string, unknown> {
  const clinic = clinicians.find((c) => c.clinicianProfileId === clinician)?.clinicId;
  const duration = (types.find((t) => t.appointmentTypeId === type)?.durationUnits ?? 3) * GRID;
  sequence += 137;
  return {
    appointmentId: `a-${sequence}`,
    reference: `APT-${sequence}`,
    tenantId: "t-cm-001",
    clinicId: clinic,
    patientProfileId: "pp-preview",
    appointmentTypeId: type,
    clinicianProfileId: clinician,
    sessionId: null,
    startAt: iso(start),
    endAt: iso(new Date(start.getTime() + duration * 60000)),
    state,
    channel: "WEB",
    bookedByPersonId: "p-preview",
    bookedByRole: "PATIENT",
    referralId: null,
    careContextId: null,
    version: 1,
    createdAt: iso(new Date(Date.now() - createdDaysAgo * DAY_MS)),
  };
}

const appointments: Record<string, unknown>[] = [
  appointment("s-mbarga", "at-spec-first", local(2, 10), "BOOKED", 1),
  appointment("s-bello", "at-spec-follow", local(8, 14, 20), "BOOKED", 3),
  appointment("s-nkoulou", "at-spec-first", local(-20, 9), "COMPLETED", 27),
  appointment("s-fonkou", "at-spec-first", local(-5, 11, 30), "PATIENT_CANCELLED", 12),
];

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
  if (!clinician || !clinic || !type) return [];
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const weekday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  const hours = (clinic.openingHours as Record<string, { start: string; end: string }>)[String(weekday)];
  if (!hours) return [];
  const at = (clock: string) => {
    const [h, m] = clock.split(":").map(Number) as [number, number];
    return Date.UTC(year, month - 1, day, h, m) - OFFSET_MS;
  };
  const held = (type.durationUnits + type.bufferUnits) * GRID * 60000;
  const slots = [];
  for (let start = at(hours.start); start + held <= at(hours.end); start += GRID * 60000 * 3) {
    const when = new Date(start);
    if (when.getTime() < Date.now() + (type.minNoticeMinutes ?? 0) * 60000) continue;
    if (looksTaken(clinicianId, when)) continue;
    const clash = appointments.some(
      (a) =>
        a.clinicianProfileId === clinicianId &&
        a.state === "BOOKED" &&
        Math.abs(new Date(String(a.startAt)).getTime() - start) < held,
    );
    if (clash) continue;
    slots.push({ startAt: iso(when), endAt: iso(new Date(start + type.durationUnits * GRID * 60000)) });
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
    return json(200, { gridUnitMinutes: GRID, appointmentTypes: types, count: types.length });
  }
  if (method === "GET" && path === "/patients/me/appointments") {
    return json(200, { when: "all", count: appointments.length, appointments: [...appointments] });
  }
  const slots = path.match(/^\/clinicians\/([^/]+)\/slots$/);
  if (method === "GET" && slots) {
    const date = url.searchParams.get("date") ?? "";
    const typeId = url.searchParams.get("typeId") ?? "";
    return json(200, { clinicianProfileId: slots[1], date, appointmentTypeId: typeId, gridUnitMinutes: GRID, slots: freeStarts(slots[1] as string, date, typeId) }, 260);
  }
  const one = path.match(/^\/appointments\/([^/]+)$/);
  if (one) {
    const found = appointments.find((a) => a.appointmentId === one[1]);
    if (!found) return json(404, { code: "not_found", message: "no such appointment" });
    if (method === "GET") return json(200, found);
    if (method === "DELETE") {
      const late = new Date(String(found.startAt)).getTime() - Date.now() < DAY_MS;
      found.state = "PATIENT_CANCELLED";
      found.version = Number(found.version) + 1;
      return json(200, {
        ...found,
        outcome: late ? "CANCELLED_LATE" : "CANCELLED_IN_WINDOW",
        entitlement: late ? "PARTIAL" : "FULL",
        note: "The time is free again. Nothing is settled; the entitlement is a record.",
      });
    }
  }
  if (method === "POST" && path === "/appointments") {
    const request = body as { clinicianProfileId: string; appointmentTypeId: string; startAt: string };
    const date = request.startAt ? new Date(new Date(request.startAt).getTime() + OFFSET_MS).toISOString().slice(0, 10) : "";
    const free = freeStarts(request.clinicianProfileId, date, request.appointmentTypeId).some((s) => s.startAt === request.startAt);
    // Ten o'clock slots are "just taken" once, so the conflict screen can be seen.
    if (!free || (request.startAt.endsWith("09:00:00Z") && !conflictShown)) {
      conflictShown = true;
      return json(409, { code: "conflict", message: "that time has just been taken" }, 600);
    }
    const made = appointment(request.clinicianProfileId, request.appointmentTypeId, new Date(request.startAt), "BOOKED", 0);
    appointments.push(made);
    return json(201, made, 700);
  }
  return json(404, { code: "not_found", message: `the preview has no ${method} ${path}` });
}

let conflictShown = false;

export function installMockApi(): void {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    if (!url.pathname.startsWith("/api/")) return real(input, init);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    return answer((init?.method ?? "GET").toUpperCase(), url, body);
  };
}
