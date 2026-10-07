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
