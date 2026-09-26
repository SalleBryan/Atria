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

const OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const GRID = 10;

/**
 * The Regional Hospital of Buea's outpatient units, which the API calls
 * clinics: the general outpatient department, where Phase 2's walk-in queue
 * will run, and the units where specialists see patients by appointment.
 */
const HOSPITAL = "Regional Hospital Buea, Buea";
const WEEKDAYS = Object.fromEntries([0, 1, 2, 3, 4].map((day) => [String(day), { start: "07:30", end: "15:30" }]));
const clinics = [
  {
    clinicId: "u-rhb-opd",
    name: "General Outpatient Department",
    address: HOSPITAL,
    phone: "+1 202 555 0147",
    openingHours: Object.fromEntries(
      [0, 1, 2, 3, 4].map((day) => [String(day), { start: "07:30", end: "17:00" }]).concat([["5", { start: "08:00", end: "12:00" }]]),
    ),
  },
  { clinicId: "u-rhb-medicine", name: "Medical Outpatient Unit", address: HOSPITAL, phone: "+1 202 555 0151", openingHours: WEEKDAYS },
  { clinicId: "u-rhb-paediatrics", name: "Paediatrics Unit", address: HOSPITAL, phone: "+1 202 555 0152", openingHours: WEEKDAYS },
  { clinicId: "u-rhb-maternity", name: "Maternity and Gynaecology Unit", address: HOSPITAL, phone: "+1 202 555 0153", openingHours: WEEKDAYS },
  { clinicId: "u-rhb-eye", name: "Eye Unit", address: HOSPITAL, phone: "+1 202 555 0154", openingHours: WEEKDAYS },
];
const clinicians = [
  ["s-mbarga", "Esther", "Mbarga", "Paediatrics", 2008, "u-rhb-paediatrics", "EXPERIENCED", ["en", "fr"]],
  ["s-nkoulou", "Jean-Paul", "Nkoulou", "Cardiology", 1999, "u-rhb-medicine", "SENIOR", ["en", "fr"]],
  ["s-bello", "Aicha", "Bello", "Dermatology", 2015, "u-rhb-medicine", "EXPERIENCED", ["en", "fr"]],
  ["s-tabi", "Ernest", "Tabi", "Internal medicine", 2010, "u-rhb-medicine", "EXPERIENCED", ["en"]],
  ["s-tchoupo", "Samuel", "Tchoupo", "Gynaecology", 2011, "u-rhb-maternity", "EXPERIENCED", ["en", "fr"]],
  ["s-fonkou", "Grace", "Fonkou", "Ophthalmology", 2019, "u-rhb-eye", "ESTABLISHED", ["en"]],
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
};

const desk = { bookedByRole: "RECEPTIONIST", channel: "WALK_IN" };

const appointments: Record<string, unknown>[] = [
  // The patient preview's own visits.
  appointment("s-mbarga", "at-spec-first", local(2, 10), "BOOKED", 1),
  appointment("s-bello", "at-spec-follow", local(8, 14, 20), "BOOKED", 3),
  appointment("s-nkoulou", "at-spec-first", local(-20, 9), "COMPLETED", 27),
  appointment("s-fonkou", "at-spec-first", local(-5, 11, 30), "PATIENT_CANCELLED", 12),
  // A day at the Medical Outpatient Unit, for the staff console.
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
  return Object.fromEntries(found.map((a) => [a.patientProfileId, patients[String(a.patientProfileId)] ?? { givenName: null, familyName: null }]));
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
    const mine = appointments.filter((a) => a.patientProfileId === "pp-preview");
    return json(200, { when: "all", count: mine.length, appointments: mine });
  }
  const day = path.match(/^\/clinics\/([^/]+)\/day$/);
  if (method === "GET" && day && url.searchParams.get("from")) {
    const from = url.searchParams.get("from") as string;
    const to = url.searchParams.get("to") ?? from;
    const found = appointments
      .filter((a) => a.clinicId === day[1] && clinicDate(a.startAt) >= from && clinicDate(a.startAt) <= to)
      .sort(byStart);
    return json(200, { clinicId: day[1], from, to, timezone: "Africa/Douala", count: found.length, appointments: found, patients: named(found) }, 380);
  }
  if (method === "GET" && day) {
    const date = url.searchParams.get("date") ?? clinicDate(new Date());
    const found = appointments.filter((a) => a.clinicId === day[1] && clinicDate(a.startAt) === date).sort(byStart);
    return json(200, { clinicId: day[1], date, timezone: "Africa/Douala", count: found.length, appointments: found, patients: named(found) }, 380);
  }
  const calendar = path.match(/^\/clinicians\/([^/]+)\/calendar$/);
  if (method === "GET" && calendar) {
    const from = url.searchParams.get("from") ?? clinicDate(new Date());
    const to = url.searchParams.get("to") ?? from;
    const found = appointments
      .filter((a) => a.clinicianProfileId === calendar[1] && clinicDate(a.startAt) >= from && clinicDate(a.startAt) <= to)
      .sort(byStart);
    const clinicId = clinicians.find((c) => c.clinicianProfileId === calendar[1])?.clinicId;
    return json(200, { clinicianProfileId: calendar[1], clinicId, from, to, timezone: "Africa/Douala", count: found.length, appointments: found, patients: named(found) }, 380);
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
    return json(200, { clinicianProfileId: slots[1], date, appointmentTypeId: typeId, gridUnitMinutes: GRID, slots: freeStarts(slots[1] as string, date, typeId) }, 260);
  }
  const one = path.match(/^\/appointments\/([^/]+)$/);
  if (one) {
    const found = appointments.find((a) => a.appointmentId === one[1]);
    if (!found) return json(404, { code: "not_found", message: "no such appointment" });
    if (method === "GET") return json(200, found);
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
  if (method === "GET" && path === "/admin/staff") {
    // Searched, filtered and paged as the API does it (atria.services.identity.staff.list_accounts).
    const sorted = [...staffAccounts].sort((a, b) => String(a.familyName).localeCompare(String(b.familyName)));
    const statusOf = (a: Record<string, unknown>) =>
      a.status === "SUSPENDED" ? "suspended" : a.mustSetPassword ? "awaiting" : "active";
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
          ].some((f) =>
            f.toLowerCase().includes(q),
          )) &&
        (!role || (a.roles as string[]).includes(role)) &&
        (!clinic || a.clinicId === clinic) &&
        (!status || statusOf(a) === status),
    );
    const limit = Math.min(50, Number(url.searchParams.get("limit") ?? 25));
    const start = Number(atob(url.searchParams.get("cursor") ?? "") || 0);
    const after = start + limit;
    return json(200, {
      count: found.length,
      total: sorted.length,
      accounts: found.slice(start, after),
      nextCursor: after < found.length ? btoa(String(after)) : null,
      facets: {
        roles: count((a) => a.roles as string[]),
        clinics: count((a) => (a.clinicId ? [String(a.clinicId)] : [])),
        status: count((a) => [statusOf(a)]),
      },
    });
  }
  const roles = path.match(/^\/admin\/staff\/([^/]+)\/roles$/);
  if (method === "PATCH" && roles) {
    const found = staffAccounts.find((a) => a.staffId === roles[1]);
    if (!found) return json(404, { code: "not_found", message: "no such staff account" });
    found.roles = (body as { roles: string[] }).roles;
    return json(200, { ...found, note: "The new roles apply at the account's next sign-in." });
  }
  const suspend = path.match(/^\/admin\/staff\/([^/]+)\/suspend$/);
  if (method === "POST" && suspend) {
    const found = staffAccounts.find((a) => a.staffId === suspend[1]);
    if (!found) return json(404, { code: "not_found", message: "no such staff account" });
    found.status = "SUSPENDED";
    return json(200, { ...found, note: "Sessions revoked." });
  }
  if (method === "POST" && path === "/admin/staff") {
    const request = body as { givenName: string; familyName: string; phoneE164: string; email?: string; clinicId?: string; roles: string[] };
    if (usedPhones.has(request.phoneE164)) return json(409, { code: "conflict", message: "that phone number or email is already in use" }, 600);
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
      800,
    );
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
    ["Brice", "Tagne"], ["Chantal", "Ekambi"], ["Didier", "Foka"], ["Estelle", "Nana"], ["Fabrice", "Mvondo"],
    ["Gisele", "Atangana"], ["Herve", "Kamga"], ["Ines", "Beyala"], ["Joel", "Essomba"], ["Laure", "Mbida"],
    ["Marc", "Onana"], ["Nadege", "Ze"], ["Olivier", "Abena"], ["Patricia", "Ndzie"], ["Quentin", "Etoundi"],
    ["Rose", "Messi"], ["Serge", "Bikoe"], ["Therese", "Mballa"],
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

export function installMockApi(): void {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    if (!url.pathname.startsWith("/api/")) return real(input, init);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    return answer((init?.method ?? "GET").toUpperCase(), url, body);
  };
}
