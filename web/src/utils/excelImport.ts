/**
 * Excel template generation and spreadsheet import parsing for Atria accounts (2026-10-01).
 *
 * Supports batch account creation for Staff (all roles) and Patients.
 * Validates fields according to Atria specification rules (FR-ACC-03, FR-ACC-04, FR-BKG-07).
 */

import * as XLSX from "xlsx";
import { type CountryCode, HOME_COUNTRY, isMobile, normalisePhone } from "../auth/phone";
import { birthDate } from "../components/BirthDateField";
import type { Role } from "../generated/permissions";
import { TENANT } from "../tenant";
import { AtriaWorkbook } from "./export/sheet";
import { fileName } from "./export/tokens";

export type StaffRole = Exclude<Role, "PATIENT">;

export interface ClinicRef {
  clinicId: string;
  name: string;
}

export interface ParsedStaffRow {
  rowNumber: number;
  role: StaffRole | null;
  roleLabel: string;
  givenName: string;
  familyName: string;
  phoneRaw: string;
  phoneE164: string;
  email: string | null;
  clinicId: string | null;
  clinicName: string | null;
  employeeNumber: string | null;
  specialty: string | null;
  registrationYear: number | null;
  ordreNumber: string | null;
  languages: string[];
  valid: boolean;
  errors: string[];
}

export interface ParsedPatientRow {
  rowNumber: number;
  givenName: string;
  familyName: string;
  phoneRaw: string;
  phoneE164: string;
  dateOfBirth: string | null;
  preferredLanguage: "en" | "fr";
  valid: boolean;
  errors: string[];
}

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const EARLIEST_REGISTRATION_YEAR = 1960;

/** Normalises any row object key to lowercase letters only for fuzzy matching. */
function cleanKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * A sheet's rows keyed by its head, wherever the head sits: on row one of a
 * plain sheet, or under the banner of an Atria template. The head is the
 * first row with a "Given name" column (in any case or spacing).
 */
function headedRows(ws: XLSX.WorkSheet): Record<string, unknown>[] {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", blankrows: true });
  const at = grid.findIndex((row) => row.some((cell) => cleanKey(String(cell)) === "givenname"));
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", range: Math.max(at, 0) });
  // Rows with nothing in them (a template's empty lines) are not people.
  return rows.filter((row) => Object.values(row).some((v) => String(v).trim()));
}

/** Finds a cell value from a raw row by checking against possible alias keys. */
function getVal(row: Record<string, unknown>, aliases: string[]): string {
  const normalizedEntries = Object.entries(row).map(([k, v]) => [cleanKey(k), v] as const);
  for (const alias of aliases) {
    const cleanAlias = cleanKey(alias);
    for (const [k, v] of normalizedEntries) {
      if (k === cleanAlias || k.includes(cleanAlias)) {
        if (v !== undefined && v !== null) {
          return String(v).trim();
        }
      }
    }
  }
  return "";
}

/** Parses languages from raw text such as "French, English" or "en, fr". */
function parseLanguages(raw: string): string[] {
  if (!raw.trim()) return [];
  const tokens = raw
    .toLowerCase()
    .split(/[,;/+]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const result = new Set<string>();
  for (const t of tokens) {
    if (t === "fr" || t === "french" || t === "français" || t === "francais") {
      result.add("fr");
    } else if (t === "en" || t === "english" || t === "anglais") {
      result.add("en");
    } else if (t.length === 2) {
      result.add(t);
    }
  }
  return Array.from(result);
}

/** Parses date of birth from string or Excel serial number. */
export function parseExcelDate(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "number") {
    // Excel serial number (1900 date system)
    if (raw > 0 && raw < 100000) {
      const date = new Date(Math.round((raw - 25569) * 86400 * 1000));
      if (!isNaN(date.getTime())) {
        const yyyy = date.getUTCFullYear();
        const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(date.getUTCDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      }
    }
    return null;
  }
  const text = String(raw).trim();
  if (!text) return null;
  // If in YYYY-MM-DD form
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const d = new Date(text);
    return isNaN(d.getTime()) ? null : text;
  }
  // If in DD/MM/YYYY or DD-MM-YYYY form
  return birthDate(text);
}

/** Normalises role input text into a recognized StaffRole. */
function normalizeRole(text: string): StaffRole | null {
  const clean = text.toUpperCase().replace(/[^A-Z]/g, "_");
  if (clean.includes("RECEPTION") || clean.includes("FRONT_DESK") || clean.includes("ACCUEIL")) {
    return "RECEPTIONIST";
  }
  if (clean.includes("CLINICIAN") || clean.includes("DOCTOR") || clean.includes("MEDECIN")) {
    return "CLINICIAN";
  }
  if (clean.includes("MANAGER") || clean.includes("GESTIONNAIRE")) {
    return "CLINIC_MANAGER";
  }
  if (clean.includes("ADMIN")) {
    return "TENANT_ADMIN";
  }
  return null;
}

/** What the import calls each role, as the console does; normalizeRole reads these. */
const ROLE_WORDS = ["Receptionist", "Clinician", "Unit manager", "Administrator"];

/**
 * The staff import template, in the documents' style (utils/export): the
 * banner and details, the guidance, then the table to fill in, with a list of
 * roles and of the hospital's units on the columns that take one. The
 * importer finds the table's head wherever it sits (headedRows).
 */
export async function downloadStaffTemplate(clinics: ClinicRef[]) {
  const book = await AtriaWorkbook.create({
    kicker: "Import template",
    title: "Staff accounts",
    code: "ATR-IMP · Staff accounts",
    meta: [
      { label: "Hospital", value: TENANT.name },
      { label: "Passwords", value: "Made on import, valid for 7 days" },
    ],
  });
  const unit = clinics[0]?.name ?? "General Outpatient Department";
  const columns = [
    { label: "Role", width: 18 },
    { label: "Given name", width: 18 },
    { label: "Family name", width: 18 },
    { label: "Mobile", width: 22 },
    { label: "Work email", width: 30 },
    { label: "Unit", width: 32 },
    { label: "Specialty", width: 22 },
    { label: "Year on the Order's roll", width: 22 },
    { label: "Ordre number", width: 18 },
    { label: "Consults in", width: 20 },
    { label: "Employee number", width: 18 },
  ];
  const accounts = book.sheet(
    "Staff accounts",
    columns.map((c) => c.width),
  );
  accounts.heading(
    "01",
    "Accounts to create",
    "One row per account. Replace the four samples with your own; the guidance is on the next sheet.",
  );
  const head = accounts.table(
    columns,
    [
      ["Receptionist", "Marie", "Fotso", "+237 6 70 11 22 33", "", unit, "", "", "", "", "REC-001"],
      [
        "Clinician",
        "Samuel",
        "Eto'o",
        "+237 6 77 44 55 66",
        "samuel.etoo@example.cm",
        unit,
        "General Practitioner",
        "2014",
        "MED-7821",
        "English, French",
        "DOC-004",
      ],
      ["Unit manager", "Jeanne", "Ngo", "+237 6 99 88 77 66", "jeanne.ngo@example.cm", unit, "", "", "", "", "MGR-002"],
      ["Administrator", "Alain", "Mboma", "+237 6 55 44 33 22", "alain.mboma@example.cm", "", "", "", "", "", "ADM-001"],
    ],
    { filter: false },
  );
  accounts.choices(head, clinics.length ? { 0: ROLE_WORDS, 5: unitList(clinics.length) } : { 0: ROLE_WORDS });
  accounts.freezeAbove(head);

  const guide = book.sheet("Instructions", [22, 40, 90]);
  guide.heading("01", "Importing staff accounts", "Fill in the first sheet, then choose Import Excel on Staff accounts.");
  guide.table(
    [
      { label: "Column", width: 22 },
      { label: "Required for", width: 40 },
      { label: "What to enter", width: 90 },
    ],
    [
      ["Role", "Every account", "Receptionist, Clinician, Unit manager or Administrator (pick from the list)"],
      ["Given name", "Every account", "As the person writes it, such as Marie"],
      ["Family name", "Every account", "As the person writes it, such as Fotso"],
      ["Mobile", "Every account", "With the country code, such as +237 6 70 00 00 00. It is the sign-in name when there is no email."],
      ["Work email", "Administrators", "Optional for everyone else. When given, it is the sign-in name."],
      ["Unit", "Receptionists, clinicians, unit managers", "Exactly as on the Units sheet (pick from the list)"],
      ["Specialty", "Clinicians", "As patients should read it, such as General Practitioner. It shows in the directory."],
      ["Year on the Order's roll", "Clinicians", "The year they joined the Order's roll, such as 2012"],
      ["Ordre number", "Clinicians", "Such as MED-8942"],
      ["Consults in", "Clinicians", "English, French, or both"],
      ["Employee number", "Optional", "The hospital's own staff number"],
    ],
    { filter: false },
  );

  const units = book.sheet("Units", [40, 24]);
  units.heading("01", "Hospital units", "The names the Unit column accepts.");
  units.table(
    [
      { label: "Unit", width: 40 },
      { label: "Unit ID", width: 24, kind: "mono" },
    ],
    clinics.map((c) => [c.name, c.clinicId]),
    { filter: false },
  );
  await book.save(fileName(["Staff import template"], "xlsx"));
}

/**
 * Where the Units sheet's names sit, for the Unit column's list. The Units
 * sheet is built by the same parts every time: the banner and details take
 * rows 1 to 6, the heading and its line 7 to 9, the table's head row 10.
 */
function unitList(count: number): string {
  const first = UNITS_HEAD_ROW + 1;
  return `'Units'!$B$${first}:$B$${first + count - 1}`;
}
const UNITS_HEAD_ROW = 10;

/** The patient import template, set like the staff one. */
export async function downloadPatientTemplate() {
  const book = await AtriaWorkbook.create({
    kicker: "Import template",
    title: "Patients",
    code: "ATR-IMP · Patients",
    meta: [{ label: "Hospital", value: TENANT.name }],
  });
  // No language column: Atria is English only until Phase 3.
  const columns = [
    { label: "Given name", width: 20 },
    { label: "Family name", width: 20 },
    { label: "Mobile number", width: 24 },
    { label: "Date of birth, if known", width: 22 },
  ];
  const patients = book.sheet(
    "Patients",
    columns.map((c) => c.width),
  );
  patients.heading("01", "Patients to register", "One row per patient. Replace the three samples with your own.");
  const head = patients.table(
    columns,
    [
      ["Paul", "Biya", "+237 6 70 00 11 22", "13/02/1985"],
      ["Grace", "Ngo", "+237 6 99 12 34 56", "24/11/1992"],
      ["Jean", "Kamga", "+237 6 77 88 99 00", "05/08/1978"],
    ],
    { filter: false },
  );
  patients.freezeAbove(head);
  const guide = book.sheet("Instructions", [20, 12, 80]);
  guide.heading("01", "Importing patients", "Fill in the first sheet, then choose Import Excel on Patients.");
  guide.table(
    [
      { label: "Column", width: 20 },
      { label: "Required", width: 12 },
      { label: "What to enter", width: 80 },
    ],
    [
      ["Given name", "Yes", "The patient's first name"],
      ["Family name", "Yes", "The patient's last name"],
      ["Mobile number", "Yes", "With the country code, such as +237 6 70 00 00 00. Reminders go here by SMS."],
      ["Date of birth, if known", "No", "DD/MM/YYYY or YYYY-MM-DD, such as 15/04/1990"],
    ],
    { filter: false },
  );
  await book.save(fileName(["Patient import template"], "xlsx"));
}

export interface ExistingStaffAccount {
  phoneE164?: string | null;
  email?: string | null;
  signInName?: string | null;
}

/**
 * Parses an uploaded Excel file for Staff batch creation.
 */
export async function parseStaffExcel(
  file: File,
  clinics: ClinicRef[],
  defaultCountry: CountryCode = HOME_COUNTRY,
  existingAccounts: ExistingStaffAccount[] = [],
): Promise<{ rows: ParsedStaffRow[]; validCount: number; errorCount: number }> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error("The uploaded Excel workbook contains no sheets.");
  }

  const ws = wb.Sheets[sheetName];
  if (!ws) {
    throw new Error("Could not read sheet data from Excel file.");
  }

  const rawData = headedRows(ws);
  if (rawData.length === 0) {
    throw new Error("The uploaded sheet has no rows of data.");
  }

  const currentYear = new Date().getFullYear();
  const parsedRows: ParsedStaffRow[] = [];

  const existingPhones = new Set(existingAccounts.map((a) => a.phoneE164).filter((p): p is string => Boolean(p)));
  const existingEmails = new Set(
    existingAccounts.map((a) => (a.email || a.signInName)?.trim().toLowerCase()).filter((e): e is string => Boolean(e)),
  );

  const seenPhonesInSheet = new Map<string, number>();
  const seenEmailsInSheet = new Map<string, number>();

  for (let i = 0; i < rawData.length; i++) {
    const raw = rawData[i]!;
    const rowNumber = i + 2; // Row 1 is header
    const errors: string[] = [];

    const roleText = getVal(raw, ["Role", "Access Level", "Poste", "Titre"]);
    const givenName = getVal(raw, ["Given Name", "First Name", "Prenom", "Prénom"]);
    const familyName = getVal(raw, ["Family Name", "Last Name", "Surname", "Nom"]);
    const phoneRaw = getVal(raw, ["Mobile", "Phone", "Telephone", "Téléphone", "PhoneE164"]);
    const emailRaw = getVal(raw, ["Work Email", "Email", "Courriel", "Mail"]);
    const unitRaw = getVal(raw, ["Unit", "Clinic", "ClinicId", "Centre"]);
    const specialtyRaw = getVal(raw, ["Specialty", "Specialite", "Spécialité"]);
    const regYearRaw = getVal(raw, ["Year on the Order's roll", "Registration Year", "Roll Year", "Annee", "Année", "Year"]);
    const ordreNumRaw = getVal(raw, ["Ordre Number", "Order Number", "Numero Ordre", "Numéro Ordre", "License"]);
    const consultsInRaw = getVal(raw, ["Consults In", "Languages", "Langues", "Consults"]);
    const employeeNumRaw = getVal(raw, ["Employee Number", "Matricule", "Staff ID"]);

    // Skip completely empty rows
    if (!roleText && !givenName && !familyName && !phoneRaw) {
      continue;
    }

    const role = normalizeRole(roleText);
    if (!role) {
      errors.push(
        roleText
          ? `Role '${roleText}' is invalid. Must be RECEPTIONIST, CLINICIAN, CLINIC_MANAGER, or TENANT_ADMIN.`
          : "Missing required field: Role. Please specify RECEPTIONIST, CLINICIAN, CLINIC_MANAGER, or TENANT_ADMIN.",
      );
    }

    if (!givenName) {
      errors.push("Missing required field: Given Name. Please fill in the staff member's first name.");
    }
    if (!familyName) {
      errors.push("Missing required field: Family Name. Please fill in the staff member's last name.");
    }

    const phoneE164 = normalisePhone(phoneRaw, defaultCountry);
    if (!phoneRaw) {
      errors.push("Missing required field: Mobile. Please fill in a mobile number in E.164 format (+237 6...).");
    } else if (!phoneE164 || !isMobile(phoneE164)) {
      errors.push(`Mobile '${phoneRaw}' is not a valid mobile number with country code.`);
    } else {
      // Check existing accounts in system
      if (existingPhones.has(phoneE164)) {
        errors.push(`An account with this mobile number (${phoneE164}) already exists in the system.`);
      }
      // Check duplicate within the spreadsheet
      if (seenPhonesInSheet.has(phoneE164)) {
        errors.push(`Duplicate mobile number within spreadsheet (matches row ${seenPhonesInSheet.get(phoneE164)}).`);
      } else {
        seenPhonesInSheet.set(phoneE164, rowNumber);
      }
    }

    const email = emailRaw ? emailRaw.trim() : null;
    if (role === "TENANT_ADMIN" && !email) {
      errors.push("Missing required field: Work Email. Tenant administrators must have a work email address to sign in.");
    } else if (email) {
      if (!EMAIL_REGEX.test(email)) {
        errors.push(`Work email '${email}' is not a valid email address.`);
      } else {
        const lowerEmail = email.toLowerCase();
        if (existingEmails.has(lowerEmail)) {
          errors.push(`An account with this work email (${email}) already exists in the system.`);
        }
        if (seenEmailsInSheet.has(lowerEmail)) {
          errors.push(`Duplicate email within spreadsheet (matches row ${seenEmailsInSheet.get(lowerEmail)}).`);
        } else {
          seenEmailsInSheet.set(lowerEmail, rowNumber);
        }
      }
    }

    // Match clinic
    let clinicId: string | null = null;
    let clinicName: string | null = null;
    const isClinicScoped = role === "RECEPTIONIST" || role === "CLINICIAN" || role === "CLINIC_MANAGER";

    if (unitRaw) {
      const match = clinics.find(
        (c) =>
          c.clinicId.toLowerCase() === unitRaw.toLowerCase() ||
          c.name.toLowerCase() === unitRaw.toLowerCase() ||
          c.name.toLowerCase().includes(unitRaw.toLowerCase()) ||
          unitRaw.toLowerCase().includes(c.name.toLowerCase()),
      );
      if (match) {
        clinicId = match.clinicId;
        clinicName = match.name;
      } else {
        errors.push(`Unit '${unitRaw}' does not match any known hospital unit.`);
      }
    } else if (isClinicScoped) {
      errors.push("Missing required field: Unit. A hospital unit is required for this role (see sheet 2).");
    }

    // Clinician specific fields
    let specialty: string | null = null;
    let registrationYear: number | null = null;
    let ordreNumber: string | null = null;
    let languages: string[] = [];

    if (role === "CLINICIAN") {
      specialty = specialtyRaw || null;
      if (!specialty) {
        errors.push("Specialty is required. Missing required field: Specialty. Clinicians must have a medical specialty filled in.");
      }

      const parsedYear = Number(regYearRaw);
      if (!regYearRaw) {
        errors.push("Missing required field: Registration Year. Clinicians must have their CNOM registration year.");
      } else if (!Number.isInteger(parsedYear) || parsedYear < EARLIEST_REGISTRATION_YEAR || parsedYear > currentYear) {
        errors.push(`Year on the Order's roll '${regYearRaw}' must be a year between ${EARLIEST_REGISTRATION_YEAR} and ${currentYear}.`);
      } else {
        registrationYear = parsedYear;
      }

      ordreNumber = ordreNumRaw || null;
      if (!ordreNumber) {
        errors.push("Missing required field: Ordre Number. Clinicians must have their CNOM license/order number.");
      }

      languages = parseLanguages(consultsInRaw);
      if (languages.length === 0) {
        errors.push("Missing required field: Consults In. Clinicians must have at least one consultation language (e.g. English, French).");
      }
    }

    const valid = errors.length === 0 && role !== null;

    parsedRows.push({
      rowNumber,
      role,
      roleLabel: role ?? roleText,
      givenName,
      familyName,
      phoneRaw,
      phoneE164,
      email,
      clinicId,
      clinicName: clinicName ?? unitRaw ?? null,
      employeeNumber: employeeNumRaw || null,
      specialty,
      registrationYear,
      ordreNumber,
      languages,
      valid,
      errors,
    });
  }

  const validCount = parsedRows.filter((r) => r.valid).length;
  const errorCount = parsedRows.length - validCount;

  return { rows: parsedRows, validCount, errorCount };
}

export interface ExistingPatientRecord {
  phoneE164?: string | null;
}

/**
 * Parses an uploaded Excel file for Patient batch creation.
 */
export async function parsePatientExcel(
  file: File,
  defaultCountry: CountryCode = HOME_COUNTRY,
  existingPatients: ExistingPatientRecord[] = [],
): Promise<{ rows: ParsedPatientRow[]; validCount: number; errorCount: number }> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error("The uploaded Excel workbook contains no sheets.");
  }

  const ws = wb.Sheets[sheetName];
  if (!ws) {
    throw new Error("Could not read sheet data from Excel file.");
  }

  const rawData = headedRows(ws);
  if (rawData.length === 0) {
    throw new Error("The uploaded sheet has no rows of data.");
  }

  const parsedRows: ParsedPatientRow[] = [];
  const existingPhones = new Set(existingPatients.map((p) => p.phoneE164).filter((p): p is string => Boolean(p)));
  const seenPhonesInSheet = new Map<string, number>();

  for (let i = 0; i < rawData.length; i++) {
    const raw = rawData[i]!;
    const rowNumber = i + 2;
    const errors: string[] = [];

    const givenName = getVal(raw, ["Given Name", "First Name", "Prenom", "Prénom"]);
    const familyName = getVal(raw, ["Family Name", "Last Name", "Surname", "Nom"]);
    const phoneRaw = getVal(raw, ["Mobile", "Phone", "Telephone", "Téléphone", "PhoneE164"]);
    const dobRaw =
      raw[Object.keys(raw).find((k) => cleanKey(k).includes("birth") || cleanKey(k).includes("naissance") || cleanKey(k) === "dob") ?? ""];
    const langRaw = getVal(raw, ["Language", "Langue", "Preferred Language"]);

    // Skip empty rows
    if (!givenName && !familyName && !phoneRaw) {
      continue;
    }

    if (!givenName) {
      errors.push("Given name is required.");
    }
    if (!familyName) {
      errors.push("Family name is required.");
    }

    const phoneE164 = normalisePhone(phoneRaw, defaultCountry);
    if (!phoneRaw) {
      errors.push("Missing required field: Mobile. Please fill in a valid mobile phone number in E.164 format (+237 6...).");
    } else if (!phoneE164 || !isMobile(phoneE164)) {
      errors.push(`Mobile '${phoneRaw}' is not a valid mobile phone number.`);
    } else {
      if (existingPhones.has(phoneE164)) {
        errors.push(`A patient with this mobile number (${phoneE164}) already exists in the system.`);
      }
      if (seenPhonesInSheet.has(phoneE164)) {
        errors.push(`Duplicate mobile number within spreadsheet (matches row ${seenPhonesInSheet.get(phoneE164)}).`);
      } else {
        seenPhonesInSheet.set(phoneE164, rowNumber);
      }
    }

    let dateOfBirth: string | null = null;
    if (dobRaw !== undefined && dobRaw !== null && dobRaw !== "") {
      dateOfBirth = parseExcelDate(dobRaw);
      if (!dateOfBirth) {
        errors.push(`Date of birth '${String(dobRaw)}' is not a valid date.`);
      }
    }

    let preferredLanguage: "en" | "fr" = "en";
    if (langRaw) {
      const lower = langRaw.toLowerCase();
      if (lower.startsWith("fr")) {
        preferredLanguage = "fr";
      }
    }

    const valid = errors.length === 0;

    parsedRows.push({
      rowNumber,
      givenName,
      familyName,
      phoneRaw,
      phoneE164,
      dateOfBirth,
      preferredLanguage,
      valid,
      errors,
    });
  }

  const validCount = parsedRows.filter((r) => r.valid).length;
  const errorCount = parsedRows.length - validCount;

  return { rows: parsedRows, validCount, errorCount };
}
