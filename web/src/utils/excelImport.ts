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

/**
 * Generates and triggers download of the Staff accounts Excel template.
 */
export function downloadStaffTemplate(clinics: ClinicRef[]) {
  const wb = XLSX.utils.book_new();

  const primaryClinicName = clinics[0]?.name ?? "Central Outpatient Clinic";

  // Sheet 1: Staff accounts template
  const headers = [
    "Role",
    "Given Name",
    "Family Name",
    "Mobile",
    "Work Email",
    "Unit",
    "Specialty",
    "Registration Year",
    "Ordre Number",
    "Consults In",
    "Employee Number",
  ];

  const sampleRows = [
    [
      "RECEPTIONIST",
      "Marie",
      "Fotso",
      "+237 6 70 11 22 33",
      "",
      primaryClinicName,
      "",
      "",
      "",
      "",
      "REC-001",
    ],
    [
      "CLINICIAN",
      "Samuel",
      "Eto'o",
      "+237 6 77 44 55 66",
      "samuel.etoo@atria.care",
      primaryClinicName,
      "General Medicine",
      "2014",
      "MED-7821",
      "English, French",
      "DOC-004",
    ],
    [
      "CLINIC_MANAGER",
      "Jeanne",
      "Ngo",
      "+237 6 99 88 77 66",
      "jeanne.ngo@atria.care",
      primaryClinicName,
      "",
      "",
      "",
      "",
      "MGR-002",
    ],
    [
      "TENANT_ADMIN",
      "Alain",
      "Mboma",
      "+237 6 55 44 33 22",
      "alain.mboma@atria.care",
      "",
      "",
      "",
      "",
      "",
      "ADM-001",
    ],
  ];

  const wsData = [headers, ...sampleRows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Set column widths
  ws["!cols"] = [
    { wch: 18 }, // Role
    { wch: 16 }, // Given Name
    { wch: 16 }, // Family Name
    { wch: 20 }, // Mobile
    { wch: 26 }, // Work Email
    { wch: 26 }, // Unit
    { wch: 20 }, // Specialty
    { wch: 18 }, // Registration Year
    { wch: 16 }, // Ordre Number
    { wch: 20 }, // Consults In
    { wch: 16 }, // Employee Number
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Staff Accounts");

  // Sheet 2: Reference Information & Allowed Units
  const referenceHeaders = ["Field", "Required For", "Allowed Values / Examples"];
  const referenceData = [
    referenceHeaders,
    ["Role", "All", "RECEPTIONIST, CLINICIAN, CLINIC_MANAGER, TENANT_ADMIN"],
    ["Given Name", "All", "e.g. Marie, Samuel"],
    ["Family Name", "All", "e.g. Fotso, Eto'o"],
    ["Mobile", "All", "International E.164 format, e.g. +237 6 70 00 00 00"],
    ["Work Email", "TENANT_ADMIN (optional for others)", "Valid email, e.g. doctor@atria.care"],
    ["Unit", "RECEPTIONIST, CLINICIAN, CLINIC_MANAGER", "Must match a hospital unit name listed below"],
    ["Specialty", "CLINICIAN only", "e.g. General Medicine, Pediatrics, Cardiology"],
    ["Registration Year", "CLINICIAN only", "Year on Order's roll (e.g. 2012)"],
    ["Ordre Number", "CLINICIAN only", "e.g. MED-8942"],
    ["Consults In", "CLINICIAN only", "English, French (or en, fr)"],
    ["Employee Number", "Optional for all", "Internal staff badge number"],
    [],
    ["AVAILABLE HOSPITAL UNITS", "Unit ID", "Exact Unit Name to use in Unit column"],
    ...clinics.map((c) => ["Unit", c.clinicId, c.name]),
  ];

  const refWs = XLSX.utils.aoa_to_sheet(referenceData);
  refWs["!cols"] = [{ wch: 24 }, { wch: 38 }, { wch: 48 }];
  XLSX.utils.book_append_sheet(wb, refWs, "Instructions & Units");

  XLSX.writeFile(wb, "atria-staff-import-template.xlsx");
}

/**
 * Generates and triggers download of the Patient records Excel template.
 */
export function downloadPatientTemplate() {
  const wb = XLSX.utils.book_new();

  // No language column: Atria is English only until Phase 3.
  const headers = ["Given Name", "Family Name", "Mobile", "Date of Birth"];

  const sampleRows = [
    ["Paul", "Biya", "+237 6 70 00 11 22", "13/02/1985"],
    ["Grace", "Ngo", "+237 6 99 12 34 56", "24/11/1992"],
    ["Jean", "Kamga", "+237 6 77 88 99 00", "05/08/1978"],
  ];

  const wsData = [headers, ...sampleRows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  ws["!cols"] = [
    { wch: 18 }, // Given Name
    { wch: 18 }, // Family Name
    { wch: 22 }, // Mobile
    { wch: 18 }, // Date of Birth
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Patients");

  // Sheet 2: Guidelines
  const refHeaders = ["Column", "Required", "Format & Instructions"];
  const refData = [
    refHeaders,
    ["Given Name", "Yes", "Patient first name"],
    ["Family Name", "Yes", "Patient last name"],
    ["Mobile", "Yes", "Mobile number with country code, e.g. +237 6 70 00 00 00. Reminders go here by SMS."],
    ["Date of Birth", "Optional", "DD/MM/YYYY or YYYY-MM-DD, e.g. 15/04/1990"],
  ];
  const refWs = XLSX.utils.aoa_to_sheet(refData);
  refWs["!cols"] = [{ wch: 18 }, { wch: 12 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, refWs, "Instructions");

  XLSX.writeFile(wb, "atria-patient-import-template.xlsx");
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

  const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  if (rawData.length === 0) {
    throw new Error("The uploaded sheet has no rows of data.");
  }

  const currentYear = new Date().getFullYear();
  const parsedRows: ParsedStaffRow[] = [];

  const existingPhones = new Set(
    existingAccounts
      .map((a) => a.phoneE164)
      .filter((p): p is string => Boolean(p)),
  );
  const existingEmails = new Set(
    existingAccounts
      .map((a) => (a.email || a.signInName)?.trim().toLowerCase())
      .filter((e): e is string => Boolean(e)),
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
    const regYearRaw = getVal(raw, ["Registration Year", "Roll Year", "Annee", "Année", "Year"]);
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
        errors.push(`Registration year '${regYearRaw}' must be a year between ${EARLIEST_REGISTRATION_YEAR} and ${currentYear}.`);
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

  const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  if (rawData.length === 0) {
    throw new Error("The uploaded sheet has no rows of data.");
  }

  const parsedRows: ParsedPatientRow[] = [];
  const existingPhones = new Set(
    existingPatients
      .map((p) => p.phoneE164)
      .filter((p): p is string => Boolean(p)),
  );
  const seenPhonesInSheet = new Map<string, number>();

  for (let i = 0; i < rawData.length; i++) {
    const raw = rawData[i]!;
    const rowNumber = i + 2;
    const errors: string[] = [];

    const givenName = getVal(raw, ["Given Name", "First Name", "Prenom", "Prénom"]);
    const familyName = getVal(raw, ["Family Name", "Last Name", "Surname", "Nom"]);
    const phoneRaw = getVal(raw, ["Mobile", "Phone", "Telephone", "Téléphone", "PhoneE164"]);
    const dobRaw = raw[Object.keys(raw).find((k) => cleanKey(k).includes("birth") || cleanKey(k).includes("naissance") || cleanKey(k) === "dob") ?? ""];
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
