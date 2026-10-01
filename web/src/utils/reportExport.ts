/**
 * Exports Hospital & Unit reports in Atria Design Language (2026-10-01).
 *
 * Formats:
 * - PDF: Official institutional report with Atria Navy/Blue palette, cards, and figures.
 * - Excel (.xlsx): Multi-sheet workbook with structured data and column formatting.
 * - CSV (.csv): Comma-separated values for tabular consumption.
 */

import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";

export interface ReportFigures {
  booked: number;
  attended: number;
  noShow: number;
  cancelled: number;
  lateCancelled: number;
  attendance?: number | null;
  clinicId?: string;
  clinicName?: string | null;
  byChannel?: { channel: string; booked: number; attended: number; noShow: number; attendance: number | null }[];
  byReminder?: { reminder: string; booked: number; attended: number; noShow: number; attendance: number | null }[];
  ledger?: {
    entries: number;
    currency: string;
    byEntitlement: { entitlement: string; entries: number; amountMinor: number }[];
    byBand: { practice: string; entries: number; amountMinor: number }[];
  };
  units?: {
    clinicId: string;
    clinicName: string | null;
    booked: number;
    attended: number;
    noShow: number;
    cancelled: number;
    attendance?: number | null;
  }[];
}

const COLORS = {
  ground: [240, 244, 250] as const,
  surface: [255, 255, 255] as const,
  ink: [13, 27, 52] as const,
  inkMuted: [90, 108, 142] as const,
  inkLight: [140, 155, 180] as const,
  hair: [220, 229, 245] as const,
  brandDark: [18, 58, 140] as const,
  brandPrimary: [27, 79, 184] as const,
  brandAccent: [36, 97, 219] as const,
  success: [16, 149, 93] as const,
  danger: [214, 72, 90] as const,
  warning: [217, 131, 36] as const,
};

const CHANNEL_NAMES: Record<string, string> = {
  ONLINE: "Online booking",
  WALK_IN: "Front desk walk-in",
  PHONE: "Telephone booking",
  REFERRAL: "Clinical referral",
};

/**
 * Downloads a structured PDF summary of the report.
 */
export function exportReportPdf(
  figures: ReportFigures,
  periodLabel: string,
  unitLabel: string,
  hospitalName = "ATRIA HEALTHCARE",
) {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;

  // Background
  doc.setFillColor(...COLORS.ground);
  doc.rect(0, 0, pageWidth, pageHeight, "F");

  // Top header banner
  doc.setFillColor(...COLORS.brandDark);
  doc.rect(0, 0, pageWidth, 28, "F");

  // Logo / institution
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...COLORS.surface);
  doc.text(hospitalName.toUpperCase(), margin, 14);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(200, 218, 255);
  doc.text("CLINICAL OPERATIONS REPORT", margin, 20);

  // Period / timestamp right-aligned in header
  const runAt = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  doc.text(`Generated: ${runAt}`, pageWidth - margin, 14, { align: "right" });
  doc.text(`Scope: ${unitLabel}`, pageWidth - margin, 20, { align: "right" });

  let y = 38;

  // Title section card
  doc.setFillColor(...COLORS.surface);
  doc.setDrawColor(...COLORS.hair);
  doc.roundedRect(margin, y, contentWidth, 22, 3, 3, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...COLORS.ink);
  doc.text(`Activity Report: ${periodLabel}`, margin + 6, y + 9);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.inkMuted);
  doc.text(`Institution attendance, visit disposition, and fee ledger entitlement summary.`, margin + 6, y + 16);

  y += 28;

  // KPI Tiles
  const kpiWidth = (contentWidth - 12) / 4;
  const kpis: { label: string; value: string; color: readonly [number, number, number] }[] = [
    { label: "Booked visits", value: String(figures.booked), color: COLORS.brandPrimary },
    { label: "Attended", value: String(figures.attended), color: COLORS.success },
    { label: "No-shows", value: String(figures.noShow), color: COLORS.danger },
    {
      label: "Attendance rate",
      value: figures.attendance != null ? `${Math.round(figures.attendance * 100)}%` : figures.attended + figures.noShow ? `${Math.round((figures.attended / (figures.attended + figures.noShow)) * 100)}%` : "N/A",
      color: COLORS.brandDark,
    },
  ];

  for (let i = 0; i < kpis.length; i++) {
    const kpi = kpis[i]!;
    const kpiX = margin + i * (kpiWidth + 4);

    doc.setFillColor(...COLORS.surface);
    doc.setDrawColor(...COLORS.hair);
    doc.roundedRect(kpiX, y, kpiWidth, 24, 3, 3, "FD");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...COLORS.inkMuted);
    doc.text(kpi.label, kpiX + 5, y + 8);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.text(kpi.value, kpiX + 5, y + 18);
  }

  y += 30;

  // If hospital-wide with units breakdown
  if (figures.units && figures.units.length > 0) {
    doc.setFillColor(...COLORS.surface);
    doc.setDrawColor(...COLORS.hair);
    doc.roundedRect(margin, y, contentWidth, 12 + figures.units.length * 9, 3, 3, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...COLORS.ink);
    doc.text("Unit Breakdown", margin + 6, y + 8);

    // Table Header
    let rowY = y + 15;
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...COLORS.inkMuted);
    doc.text("UNIT", margin + 6, rowY);
    doc.text("BOOKED", margin + 80, rowY, { align: "right" });
    doc.text("ATTENDED", margin + 110, rowY, { align: "right" });
    doc.text("NO-SHOW", margin + 140, rowY, { align: "right" });
    doc.text("ATTENDANCE", margin + contentWidth - 6, rowY, { align: "right" });

    // Table Rows
    doc.setFont("helvetica", "normal");
    for (const u of figures.units) {
      rowY += 9;
      doc.setDrawColor(...COLORS.hair);
      doc.line(margin + 6, rowY - 6, margin + contentWidth - 6, rowY - 6);

      doc.setTextColor(...COLORS.ink);
      doc.text(u.clinicName || u.clinicId, margin + 6, rowY);
      doc.text(String(u.booked), margin + 80, rowY, { align: "right" });
      doc.text(String(u.attended), margin + 110, rowY, { align: "right" });
      doc.text(String(u.noShow), margin + 140, rowY, { align: "right" });
      const rate = u.attendance != null ? `${Math.round(u.attendance * 100)}%` : u.attended + u.noShow ? `${Math.round((u.attended / (u.attended + u.noShow)) * 100)}%` : "N/A";
      doc.setTextColor(...COLORS.success);
      doc.text(rate, margin + contentWidth - 6, rowY, { align: "right" });
    }

    y += 18 + figures.units.length * 9;
  }

  // Booking channels breakdown
  if (figures.byChannel && figures.byChannel.length > 0 && y < 220) {
    doc.setFillColor(...COLORS.surface);
    doc.setDrawColor(...COLORS.hair);
    doc.roundedRect(margin, y, contentWidth, 12 + figures.byChannel.length * 8, 3, 3, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...COLORS.ink);
    doc.text("Booking Channels", margin + 6, y + 8);

    let rowY = y + 15;
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    for (const c of figures.byChannel) {
      doc.setTextColor(...COLORS.ink);
      doc.text(CHANNEL_NAMES[c.channel] || c.channel, margin + 6, rowY);
      doc.setTextColor(...COLORS.inkMuted);
      doc.text(`${c.booked} booked  |  ${c.attended} attended  |  ${c.noShow} no-shows`, margin + 80, rowY);
      const rate = c.attendance != null ? `${Math.round(c.attendance * 100)}%` : "N/A";
      doc.setTextColor(...COLORS.brandPrimary);
      doc.text(`Attendance: ${rate}`, margin + contentWidth - 6, rowY, { align: "right" });
      rowY += 8;
    }

    y += 18 + figures.byChannel.length * 8;
  }

  // Footer
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.inkLight);
  doc.text("Atria Health Platform - Confidential Medical Records - Scoped to Tenant", margin, pageHeight - 8);
  doc.text("Page 1 of 1", pageWidth - margin, pageHeight - 8, { align: "right" });

  doc.save(`Atria_Report_${periodLabel.replace(/[\s/\\:]+/g, "_")}.pdf`);
}

/**
 * Downloads an Excel workbook with sheets for summary and details.
 */
export function exportReportExcel(figures: ReportFigures, periodLabel: string, unitLabel: string) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Summary
  const summaryData = [
    ["ATRIA HEALTHCARE - OPERATIONS REPORT"],
    ["Period", periodLabel],
    ["Unit Scope", unitLabel],
    ["Generated At", new Date().toISOString()],
    [],
    ["METRIC", "VALUE"],
    ["Booked visits", figures.booked],
    ["Attended", figures.attended],
    ["No-shows", figures.noShow],
    ["Cancelled", figures.cancelled],
    ["Late cancelled", figures.lateCancelled],
    [
      "Attendance rate",
      figures.attendance != null
        ? `${Math.round(figures.attendance * 100)}%`
        : figures.attended + figures.noShow
          ? `${Math.round((figures.attended / (figures.attended + figures.noShow)) * 100)}%`
          : "N/A",
    ],
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary["!cols"] = [{ wch: 25 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

  // Sheet 2: Unit breakdown
  if (figures.units && figures.units.length > 0) {
    const unitHeaders = ["Unit ID", "Unit Name", "Booked", "Attended", "No-show", "Cancelled", "Attendance Rate"];
    const unitRows = figures.units.map((u) => [
      u.clinicId,
      u.clinicName || "",
      u.booked,
      u.attended,
      u.noShow,
      u.cancelled,
      u.attendance != null ? `${Math.round(u.attendance * 100)}%` : "N/A",
    ]);
    const wsUnits = XLSX.utils.aoa_to_sheet([unitHeaders, ...unitRows]);
    wsUnits["!cols"] = [{ wch: 15 }, { wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsUnits, "Hospital Units");
  }

  // Sheet 3: Booking Channels
  if (figures.byChannel && figures.byChannel.length > 0) {
    const channelHeaders = ["Channel", "Channel Name", "Booked", "Attended", "No-show", "Attendance Rate"];
    const channelRows = figures.byChannel.map((c) => [
      c.channel,
      CHANNEL_NAMES[c.channel] || c.channel,
      c.booked,
      c.attended,
      c.noShow,
      c.attendance != null ? `${Math.round(c.attendance * 100)}%` : "N/A",
    ]);
    const wsChannels = XLSX.utils.aoa_to_sheet([channelHeaders, ...channelRows]);
    wsChannels["!cols"] = [{ wch: 15 }, { wch: 25 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsChannels, "Booking Channels");
  }

  // Sheet 4: Fee Ledger
  if (figures.ledger) {
    const ledgerHeaders = ["Entitlement", "Visits", "Amount", "Currency"];
    const ledgerRows = figures.ledger.byEntitlement.map((e) => [
      e.entitlement,
      e.entries,
      e.amountMinor,
      figures.ledger?.currency || "XAF",
    ]);
    const wsLedger = XLSX.utils.aoa_to_sheet([ledgerHeaders, ...ledgerRows]);
    wsLedger["!cols"] = [{ wch: 20 }, { wch: 12 }, { wch: 16 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsLedger, "Fee Ledger");
  }

  XLSX.writeFile(wb, `Atria_Report_${periodLabel.replace(/[\s/\\:]+/g, "_")}.xlsx`);
}

/**
 * Downloads a single CSV file of the primary report metrics.
 */
export function exportReportCsv(figures: ReportFigures, periodLabel: string) {
  const rows: (string | number)[][] = [
    ["Metric", "Value"],
    ["Period", periodLabel],
    ["Booked visits", figures.booked],
    ["Attended", figures.attended],
    ["No-shows", figures.noShow],
    ["Cancelled", figures.cancelled],
    ["Late cancelled", figures.lateCancelled],
  ];

  if (figures.units && figures.units.length > 0) {
    rows.push([]);
    rows.push(["Unit", "Booked", "Attended", "No-shows", "Cancelled"]);
    for (const u of figures.units) {
      rows.push([u.clinicName || u.clinicId, u.booked, u.attended, u.noShow, u.cancelled]);
    }
  }

  const csvContent = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Atria_Report_${periodLabel.replace(/[\s/\\:]+/g, "_")}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
