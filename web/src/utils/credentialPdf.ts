/**
 * Generates downloadable PDF credential slips for staff accounts (2026-10-01).
 *
 * Formatted with the Atria Design Language (ATR-SRS / ATR-DS specification theme):
 * - Deep Atria Navy (#0D1B34) and Atria Primary Blue (#1B4FB8 / #2461DB)
 * - Ground tint (#F0F4FA), crisp white cards with hairline borders (#DCE5F5)
 * - Monospaced credential values (#0B2B6B) in tinted input boxes (#F3F7FF)
 * - Professional document headers, onboarding instructions, and running footers
 */

import { jsPDF } from "jspdf";

export interface StaffCredential {
  name: string;
  role: string;
  unit: string;
  signInName: string;
  temporaryPassword: string;
  email?: string | null;
  phone?: string | null;
}

const COLORS = {
  ground: [240, 244, 250] as const,
  surface: [255, 255, 255] as const,
  ink: [13, 27, 52] as const,
  inkMuted: [90, 108, 142] as const,
  inkLight: [140, 155, 180] as const,
  hair: [220, 229, 245] as const,
  hairLight: [235, 241, 250] as const,
  tint: [243, 247, 255] as const,
  tintBorder: [191, 213, 254] as const,
  brandDark: [18, 58, 140] as const,
  brandPrimary: [27, 79, 184] as const,
  brandAccent: [36, 97, 219] as const,
  brandDeep: [11, 43, 107] as const,
  noticeBg: [238, 244, 255] as const,
};

/**
 * Downloads a single staff credential slip as an A5 PDF.
 */
export function downloadSingleStaffPdf(credential: StaffCredential, hospitalName = "ATRIA HEALTHCARE") {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a5",
  });

  const pageWidth = 148;
  const pageHeight = 210;

  // Background ground
  doc.setFillColor(...COLORS.ground);
  doc.rect(0, 0, pageWidth, pageHeight, "F");

  // Top header brand banner
  doc.setFillColor(...COLORS.brandDark);
  doc.rect(0, 0, pageWidth, 26, "F");

  // Accent line below banner
  doc.setFillColor(...COLORS.brandAccent);
  doc.rect(0, 26, pageWidth, 1.5, "F");

  // Header Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text(hospitalName.toUpperCase(), 14, 13);

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(200, 220, 255);
  doc.text("REGIONAL HOSPITAL BUEA · TENANT CONSOLE", 14, 19);

  // Kicker pill on right
  doc.setFillColor(...COLORS.brandPrimary);
  doc.roundedRect(pageWidth - 44, 8, 30, 8, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  doc.text("CONFIDENTIAL", pageWidth - 29, 13.5, { align: "center" });

  // Main Card
  const cardX = 12;
  const cardY = 35;
  const cardW = 124;
  const cardH = 150;

  doc.setFillColor(...COLORS.surface);
  doc.roundedRect(cardX, cardY, cardW, cardH, 4, 4, "F");
  doc.setDrawColor(...COLORS.hair);
  doc.roundedRect(cardX, cardY, cardW, cardH, 4, 4, "S");

  // Recipient Greeting
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...COLORS.ink);
  doc.text(credential.name, cardX + 8, cardY + 14);

  // Role tag
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.brandPrimary);
  doc.text(`${credential.role.toUpperCase()} · ${credential.unit}`, cardX + 8, cardY + 21);

  // Divider
  doc.setDrawColor(...COLORS.hairLight);
  doc.line(cardX + 8, cardY + 26, cardX + cardW - 8, cardY + 26);

  // Field 1: Sign-in Name
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLORS.inkMuted);
  doc.text("SIGN-IN IDENTIFIER", cardX + 8, cardY + 36);

  doc.setFillColor(...COLORS.tint);
  doc.roundedRect(cardX + 8, cardY + 39, cardW - 16, 13, 2, 2, "F");
  doc.setDrawColor(...COLORS.tintBorder);
  doc.roundedRect(cardX + 8, cardY + 39, cardW - 16, 13, 2, 2, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...COLORS.ink);
  doc.text(credential.signInName, cardX + 13, cardY + 47.5);

  // Field 2: Temporary Password
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLORS.inkMuted);
  doc.text("TEMPORARY ONE-TIME PASSWORD", cardX + 8, cardY + 60);

  doc.setFillColor(...COLORS.tint);
  doc.roundedRect(cardX + 8, cardY + 63, cardW - 16, 14, 2, 2, "F");
  doc.setDrawColor(...COLORS.tintBorder);
  doc.roundedRect(cardX + 8, cardY + 63, cardW - 16, 14, 2, 2, "S");
  doc.setFont("courier", "bold");
  doc.setFontSize(12.5);
  doc.setTextColor(...COLORS.brandDeep);
  doc.text(credential.temporaryPassword, cardX + 13, cardY + 72);

  // Instructions Notice Box
  const noticeY = cardY + 85;
  const noticeH = 46;
  doc.setFillColor(...COLORS.noticeBg);
  doc.roundedRect(cardX + 8, noticeY, cardW - 16, noticeH, 3, 3, "F");
  doc.setDrawColor(...COLORS.tintBorder);
  doc.roundedRect(cardX + 8, noticeY, cardW - 16, noticeH, 3, 3, "S");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.brandPrimary);
  doc.text("FIRST SIGN-IN INSTRUCTIONS", cardX + 13, noticeY + 9);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.8);
  doc.setTextColor(...COLORS.ink);
  doc.text("1. This temporary password expires in 3 days.", cardX + 13, noticeY + 17);
  doc.text("2. Go to the Atria staff console sign-in screen.", cardX + 13, noticeY + 23);
  doc.text("3. Enter your identifier above and this temporary password.", cardX + 13, noticeY + 29);
  doc.text("4. You will be prompted to create your private permanent password.", cardX + 13, noticeY + 35);
  doc.text("5. Never share your credentials with anyone.", cardX + 13, noticeY + 41);

  // Bottom card confidentiality note
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.inkLight);
  doc.text("Issued by Tenant Administrator · Regional Hospital Buea", cardX + 8, cardY + cardH - 6);

  // Page Footer
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.inkMuted);
  doc.text(
    "CONFIDENTIAL · HAND DIRECTLY TO AUTHORIZED RECIPIENT · ATRIA HEALTHCARE SYSTEMS",
    pageWidth / 2,
    pageHeight - 8,
    { align: "center" },
  );

  const cleanName = credential.name.toLowerCase().replace(/[^a-z0-9]/g, "-");
  doc.save(`atria-credentials-${cleanName}.pdf`);
}

/**
 * Downloads a batch of staff credentials as a multipage A4 PDF with the Atria theme.
 */
export function downloadBatchStaffPdf(credentials: StaffCredential[], hospitalName = "ATRIA HEALTHCARE") {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 14;
  let y = margin;

  function renderHeader(pageNumber: number) {
    // Top Brand Banner
    doc.setFillColor(...COLORS.brandDark);
    doc.rect(0, 0, pageWidth, 24, "F");

    doc.setFillColor(...COLORS.brandAccent);
    doc.rect(0, 24, pageWidth, 1.2, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(255, 255, 255);
    doc.text(hospitalName.toUpperCase(), margin, 13);

    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(200, 220, 255);
    doc.text("REGIONAL HOSPITAL BUEA · TENANT STAFF MANAGEMENT", margin, 18.5);

    // Right side label
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text("STAFF CREDENTIALS NOTICE", pageWidth - margin, 13, { align: "right" });

    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(200, 220, 255);
    doc.text(`PAGE ${pageNumber}`, pageWidth - margin, 18.5, { align: "right" });

    y = 33;

    if (pageNumber === 1) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(...COLORS.ink);
      doc.text(`Staff Accounts Onboarding Summary (${credentials.length} Accounts)`, margin, y);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...COLORS.inkMuted);
      doc.text(
        `Generated on ${new Date().toLocaleDateString("en-GB")}. Each staff member must receive their sign-in name and one-time password.`,
        margin,
        y + 5.5,
      );
      y += 14;
    }
  }

  renderHeader(1);

  // Render cards for each staff member, 4 per page
  const cardHeight = 50;
  const cardsPerPage = 4;
  let onCurrentPage = 0;
  let pageNumber = 1;

  for (let i = 0; i < credentials.length; i++) {
    const cred = credentials[i]!;

    if (onCurrentPage >= cardsPerPage) {
      doc.addPage();
      pageNumber++;
      renderHeader(pageNumber);
      onCurrentPage = 0;
    }

    // Card background
    doc.setFillColor(...COLORS.surface);
    doc.roundedRect(margin, y, pageWidth - margin * 2, cardHeight, 3.5, 3.5, "F");
    doc.setDrawColor(...COLORS.hair);
    doc.roundedRect(margin, y, pageWidth - margin * 2, cardHeight, 3.5, 3.5, "S");

    // Staff Name and Role
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...COLORS.ink);
    doc.text(cred.name, margin + 8, y + 9.5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.brandPrimary);
    doc.text(`${cred.role.toUpperCase()} · ${cred.unit}`, margin + 8, y + 15);

    // Hairline separator
    doc.setDrawColor(...COLORS.hairLight);
    doc.line(margin + 8, y + 19, pageWidth - margin - 8, y + 19);

    // Left Column: Sign-in Name Box
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.inkMuted);
    doc.text("SIGN-IN IDENTIFIER", margin + 8, y + 25);

    doc.setFillColor(...COLORS.tint);
    doc.roundedRect(margin + 8, y + 27.5, 82, 11, 2, 2, "F");
    doc.setDrawColor(...COLORS.tintBorder);
    doc.roundedRect(margin + 8, y + 27.5, 82, 11, 2, 2, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...COLORS.ink);
    doc.text(cred.signInName, margin + 12, y + 35);

    // Right Column: Temporary Password Box
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.inkMuted);
    doc.text("ONE-TIME TEMPORARY PASSWORD", margin + 96, y + 25);

    doc.setFillColor(...COLORS.tint);
    doc.roundedRect(margin + 96, y + 27.5, 78, 11, 2, 2, "F");
    doc.setDrawColor(...COLORS.tintBorder);
    doc.roundedRect(margin + 96, y + 27.5, 78, 11, 2, 2, "S");
    doc.setFont("courier", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...COLORS.brandDeep);
    doc.text(cred.temporaryPassword, margin + 100, y + 35);

    // Footnote of card
    doc.setFont("helvetica", "italic");
    doc.setFontSize(6.8);
    doc.setTextColor(...COLORS.inkLight);
    doc.text(
      "Temporary password expires in 3 days. Staff member selects permanent password upon first sign-in.",
      margin + 8,
      y + 44.5,
    );

    y += cardHeight + 6;
    onCurrentPage++;
  }

  // Running footer on the final page
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.inkMuted);
  doc.text(
    `CONFIDENTIAL · REGIONAL HOSPITAL BUEA · TOTAL ${credentials.length} ACCOUNTS · ATRIA HEALTHCARE SYSTEMS`,
    pageWidth / 2,
    pageHeight - 7,
    { align: "center" },
  );

  const dateStr = new Date().toISOString().slice(0, 10);
  doc.save(`atria-staff-credentials-${dateStr}.pdf`);
}
