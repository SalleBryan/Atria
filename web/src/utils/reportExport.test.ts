/**
 * The report as a file (2026-10-07): the same figures in the page's words in
 * every format, and the workbook set in the documents' style.
 */

import ExcelJS from "exceljs";

import { AtriaWorkbook } from "./export/sheet";
import { INK } from "./export/tokens";
import { type ReportFigures, reportCsv } from "./reportExport";

const WEEK: ReportFigures = {
  booked: 5,
  attended: 0,
  noShow: 3,
  cancelled: 1,
  lateCancelled: 1,
  byChannel: [{ channel: "WALK_IN", booked: 5, attended: 0, noShow: 3, attendance: 0 }],
  byBookedBy: [{ bookedBy: "RECEPTIONIST", booked: 2, attended: 0, noShow: 1, attendance: 0 }],
  byReminder: [{ reminder: "NOT_SENT", booked: 4, attended: 0, noShow: 2, attendance: 0 }],
  ledger: {
    entries: 5,
    currency: "XAF",
    byEntitlement: [{ entitlement: "NONE", entries: 3, amountMinor: 4500 }],
    byBand: [{ practice: "General consultation", entries: 5, amountMinor: 7500 }],
  },
};

describe("reportCsv", () => {
  it("says what the page says, never a code", () => {
    const { head, rows } = reportCsv(WEEK);
    expect(head[0]).toBe("Section");
    const text = rows.flat().join(" ");
    expect(text).toContain("At the desk");
    expect(text).toContain("No reminder");
    expect(text).toContain("A receptionist");
    expect(text).toContain("No refund");
    expect(text).toContain("4,500 XAF");
    expect(text).not.toMatch(/WALK_IN|NOT_SENT|\bNONE\b/);
  });
});

describe("outcome shares (audit F18)", () => {
  it("names the share of booked and of closed apart, and counts open visits", () => {
    const rows = reportCsv({ ...WEEK, booked: 10, attended: 4, noShow: 2, cancelled: 1, lateCancelled: 1 }).rows;
    const ended = rows.filter((r) => r[0] === "How visits ended");
    expect(ended.find((r) => r[1] === "Attended")?.[7]).toBe("40% of booked; 50% of closed");
    expect(ended.find((r) => r[1] === "Still open")?.[2]).toBe(2);
  });
});

describe("comparison in the export", () => {
  const compared: ReportFigures = {
    ...WEEK,
    comparison: {
      from: "2026-09-14",
      to: "2026-09-20",
      counts: {
        booked: { before: 8, after: 10, change: 2 },
        attended: { before: 5, after: 6, change: 1 },
        noShow: { before: 3, after: 2, change: -1 },
        cancelled: { before: 1, after: 1, change: 0 },
        lateCancelled: { before: 0, after: 1, change: 1 },
      },
      attendance: { before: 0.625, after: 0.75, points: 12.5 },
    },
  };

  it("adds the earlier period to the CSV in the page's words", () => {
    const rows = reportCsv(compared).rows.filter((r) => r[0] === "Compared with the earlier period");
    expect(rows.find((r) => r[1] === "Booked")?.[7]).toBe("was 8, up 2");
    expect(rows.find((r) => r[1] === "No-show")?.[7]).toBe("was 3, down 1");
    expect(rows.find((r) => r[1] === "Attendance")?.[7]).toBe("was 63%, up 12.5 points");
  });

  it("adds nothing without a comparison", () => {
    expect(reportCsv(WEEK).rows.some((r) => r[0] === "Compared with the earlier period")).toBe(false);
  });
});

describe("AtriaWorkbook", () => {
  it("sets a sheet in the documents' style: brand banner, details, tinted small-caps head, frozen", async () => {
    const book = await AtriaWorkbook.create({
      kicker: "Weekly report",
      title: "General Outpatient Department",
      code: "ATR-RPT · Weekly report",
      meta: [{ label: "Hospital", value: "Regional Hospital Buea" }],
    });
    const page = book.sheet("Summary", [30, 12]);
    page.heading("01", "How visits ended");
    const head = page.table(
      [
        { label: "Figure", width: 30 },
        { label: "Value", width: 12, kind: "number" },
      ],
      [["Booked", 5]],
    );
    page.freezeAbove(head);
    const read = new ExcelJS.Workbook();
    await read.xlsx.load(await book.bytes());
    const sheet = read.getWorksheet("Summary")!;
    const banner = sheet.getCell("B2");
    const words = (banner.value as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join("");
    expect(words).toContain("ATRIA");
    expect(words).toContain("General Outpatient Department");
    expect((banner.fill as ExcelJS.FillPattern).fgColor?.argb).toBe(`FF${INK.p800.slice(1)}`);
    const details = (sheet.getCell("B5").value as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join("");
    expect(details).toContain("Regional Hospital Buea");
    const label = sheet.getCell(head, 2);
    expect(label.value).toBe("FIGURE");
    expect((label.fill as ExcelJS.FillPattern).fgColor?.argb).toBe(`FF${INK.tint.slice(1)}`);
    expect(sheet.getCell(head + 1, 3).value).toBe(5);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: head, showGridLines: false });
    expect(sheet.headerFooter.oddFooter).toContain("ATR-RPT");
  });
});
