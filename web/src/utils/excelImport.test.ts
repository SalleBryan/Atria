/**
 * Tests for Excel import parser and template generation (2026-10-01).
 */

import { describe, expect, it, vi } from "vitest";

import * as XLSX from "xlsx";
import {
  downloadPatientTemplate,
  downloadStaffTemplate,
  parseExcelDate,
  parsePatientExcel,
  parseStaffExcel,
} from "./excelImport";

function createMockFile(workbook: XLSX.WorkBook, filename: string): File {
  const binary = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([binary], filename, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("parseExcelDate", () => {
  it("parses Excel serial date numbers", () => {
    // 32965 in Excel corresponds to 1990-04-02
    const parsed = parseExcelDate(32965);
    expect(parsed).toBe("1990-04-02");
  });

  it("parses text dates in DD/MM/YYYY format", () => {
    expect(parseExcelDate("15/08/1995")).toBe("1995-08-15");
    expect(parseExcelDate("01/01/2000")).toBe("2000-01-01");
  });

  it("parses text dates in YYYY-MM-DD format", () => {
    expect(parseExcelDate("1988-12-25")).toBe("1988-12-25");
  });

  it("returns null for invalid dates or future dates", () => {
    expect(parseExcelDate("not-a-date")).toBeNull();
    expect(parseExcelDate("")).toBeNull();
    expect(parseExcelDate(null)).toBeNull();
    expect(parseExcelDate("31/02/1990")).toBeNull();
  });
});

describe("downloadStaffTemplate and downloadPatientTemplate", () => {
  // The first test pays for loading ExcelJS, which is slow on a busy runner.
  // The workbook the browser is handed, caught instead of saved.
  async function saved(make: () => Promise<void>): Promise<{ file: File; name: string }> {
    let blob: Blob | null = null;
    let name = "";
    URL.createObjectURL = vi.fn((b: Blob) => {
      blob = b;
      return "blob:template";
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download;
    });
    await make();
    click.mockRestore();
    return { file: new File([blob!], name), name };
  }

  it("makes a staff template the import reads back, sample rows and all", async () => {
    const clinics = [{ clinicId: "clinic-1", name: "Central Outpatient Clinic" }];
    const { file, name } = await saved(() => downloadStaffTemplate(clinics));
    expect(name).toBe("Atria Staff import template.xlsx");
    const parsed = await parseStaffExcel(file, clinics);
    expect(parsed.rows.map((r) => r.role)).toEqual(["RECEPTIONIST", "CLINICIAN", "CLINIC_MANAGER", "TENANT_ADMIN"]);
    expect(parsed.errorCount).toBe(0);
  }, 60_000);

  it("makes a patient template the import reads back", async () => {
    const { file, name } = await saved(() => downloadPatientTemplate());
    expect(name).toBe("Atria Patient import template.xlsx");
    const parsed = await parsePatientExcel(file);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.errorCount).toBe(0);
  }, 60_000);
});

describe("parseStaffExcel", () => {
  const clinics = [
    { clinicId: "c-central", name: "Central Outpatient Clinic" },
    { clinicId: "c-poly", name: "Polyclinic Bonanjo" },
  ];

  it("parses valid receptionist, clinician, manager, and admin rows", async () => {
    const wb = XLSX.utils.book_new();
    const rows = [
      [
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
      ],
      [
        "Receptionist",
        "Marie",
        "Fotso",
        "+237 6 70 11 22 33",
        "",
        "Central Outpatient Clinic",
        "",
        "",
        "",
        "",
        "REC-001",
      ],
      [
        "Clinician",
        "Samuel",
        "Eto'o",
        "+237 6 77 44 55 66",
        "samuel@atria.care",
        "Polyclinic Bonanjo",
        "Cardiology",
        2015,
        "MED-104",
        "English, French",
        "DOC-002",
      ],
      [
        "Unit Manager",
        "Jeanne",
        "Ngo",
        "+237 6 99 88 77 66",
        "",
        "Central Outpatient Clinic",
        "",
        "",
        "",
        "",
        "MGR-003",
      ],
      [
        "Tenant Administrator",
        "Alain",
        "Mboma",
        "+237 6 55 44 33 22",
        "admin@atria.care",
        "",
        "",
        "",
        "",
        "",
        "ADM-001",
      ],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Staff");
    const file = createMockFile(wb, "staff.xlsx");

    const result = await parseStaffExcel(file, clinics);
    expect(result.rows).toHaveLength(4);
    expect(result.validCount).toBe(4);
    expect(result.errorCount).toBe(0);

    const [rec, doc, mgr, adm] = result.rows;
    expect(rec?.role).toBe("RECEPTIONIST");
    expect(rec?.clinicId).toBe("c-central");
    expect(rec?.valid).toBe(true);

    expect(doc?.role).toBe("CLINICIAN");
    expect(doc?.clinicId).toBe("c-poly");
    expect(doc?.specialty).toBe("Cardiology");
    expect(doc?.registrationYear).toBe(2015);
    expect(doc?.languages).toEqual(["en", "fr"]);
    expect(doc?.valid).toBe(true);

    expect(mgr?.role).toBe("CLINIC_MANAGER");
    expect(mgr?.valid).toBe(true);

    expect(adm?.role).toBe("TENANT_ADMIN");
    expect(adm?.email).toBe("admin@atria.care");
    expect(adm?.valid).toBe(true);
  });

  it("identifies invalid rows with appropriate error messages", async () => {
    const wb = XLSX.utils.book_new();
    const rows = [
      ["Role", "Given Name", "Family Name", "Mobile", "Work Email", "Unit", "Specialty"],
      ["UnknownRole", "John", "Doe", "+237 6 70 00 00 00", "", "Central Outpatient Clinic", ""],
      ["Clinician", "Alice", "Wonder", "+237 6 70 00 00 01", "", "Nonexistent Clinic", ""],
      ["Tenant Admin", "Bob", "Smith", "12345", "", "", ""],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Staff");
    const file = createMockFile(wb, "invalid-staff.xlsx");

    const result = await parseStaffExcel(file, clinics);
    expect(result.rows).toHaveLength(3);
    expect(result.validCount).toBe(0);
    expect(result.errorCount).toBe(3);

    // Row 1: invalid role
    expect(result.rows[0]?.errors.some((e) => e.includes("invalid"))).toBe(true);
    // Row 2: unknown clinic and missing clinician specialty
    expect(result.rows[1]?.errors.some((e) => e.includes("does not match"))).toBe(true);
    expect(result.rows[1]?.errors.some((e) => e.includes("Specialty is required"))).toBe(true);
    // Row 3: invalid mobile and missing email for admin
    expect(result.rows[2]?.errors.some((e) => e.includes("valid mobile"))).toBe(true);
    expect(result.rows[2]?.errors.some((e) => e.includes("must have a work email"))).toBe(true);
  });
});

describe("parsePatientExcel", () => {
  it("parses valid patient rows with birth dates and language", async () => {
    const wb = XLSX.utils.book_new();
    const rows = [
      ["Given Name", "Family Name", "Mobile", "Date of Birth", "Language"],
      ["Paul", "Biya", "+237 6 70 00 11 22", "13/02/1985", "French"],
      ["Grace", "Ngo", "+237 6 99 12 34 56", "", "English"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Patients");
    const file = createMockFile(wb, "patients.xlsx");

    const result = await parsePatientExcel(file);
    expect(result.rows).toHaveLength(2);
    expect(result.validCount).toBe(2);
    expect(result.errorCount).toBe(0);

    expect(result.rows[0]?.givenName).toBe("Paul");
    expect(result.rows[0]?.familyName).toBe("Biya");
    expect(result.rows[0]?.phoneE164).toBe("+237670001122");
    expect(result.rows[0]?.dateOfBirth).toBe("1985-02-13");
    expect(result.rows[0]?.preferredLanguage).toBe("fr");

    expect(result.rows[1]?.preferredLanguage).toBe("en");
    expect(result.rows[1]?.dateOfBirth).toBeNull();
  });

  it("flags rows with missing names or invalid mobile", async () => {
    const wb = XLSX.utils.book_new();
    const rows = [
      ["Given Name", "Family Name", "Mobile"],
      ["", "NoFirstName", "+237 6 70 00 11 22"],
      ["NoFamilyName", "", "+237 6 70 00 11 22"],
      ["Bad", "Phone", "not-a-number"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Patients");
    const file = createMockFile(wb, "bad-patients.xlsx");

    const result = await parsePatientExcel(file);
    expect(result.rows).toHaveLength(3);
    expect(result.validCount).toBe(0);
    expect(result.errorCount).toBe(3);

    expect(result.rows[0]?.errors).toContain("Given name is required.");
    expect(result.rows[1]?.errors).toContain("Family name is required.");
    expect(result.rows[2]?.errors.some((e) => e.includes("valid mobile"))).toBe(true);
  });
});
