/**
 * Tests for credential PDF generation (2026-10-01).
 */

import { describe, expect, it, vi } from "vitest";

const { mockSave } = vi.hoisted(() => ({
  mockSave: vi.fn(),
}));

vi.mock("jspdf", () => {
  class MockJsPDF {
    setFillColor = vi.fn();
    rect = vi.fn();
    setFont = vi.fn();
    setFontSize = vi.fn();
    setTextColor = vi.fn();
    text = vi.fn();
    roundedRect = vi.fn();
    setDrawColor = vi.fn();
    line = vi.fn();
    addPage = vi.fn();
    save = mockSave;
  }
  return {
    jsPDF: MockJsPDF,
  };
});

import { downloadBatchStaffPdf, downloadSingleStaffPdf, type StaffCredential } from "./credentialPdf";

describe("credentialPdf", () => {
  const sampleCred: StaffCredential = {
    name: "Dr. Samuel Eto'o",
    role: "Clinician",
    unit: "Central Outpatient Clinic",
    signInName: "samuel.etoo@atria.care",
    temporaryPassword: "TempPass123!",
    email: "samuel.etoo@atria.care",
    phone: "+237677445566",
  };

  it("generates a single staff credential PDF without throwing", () => {
    mockSave.mockClear();
    expect(() => downloadSingleStaffPdf(sampleCred)).not.toThrow();
    expect(mockSave).toHaveBeenCalledWith("atria-credentials-dr--samuel-eto-o.pdf");
  });

  it("generates a batch staff credentials PDF without throwing", () => {
    mockSave.mockClear();
    const creds: StaffCredential[] = [
      sampleCred,
      {
        name: "Marie Fotso",
        role: "Receptionist",
        unit: "Central Outpatient Clinic",
        signInName: "+237670112233",
        temporaryPassword: "AnotherPass456!",
      },
    ];
    expect(() => downloadBatchStaffPdf(creds)).not.toThrow();
    expect(mockSave).toHaveBeenCalled();
  });
});
