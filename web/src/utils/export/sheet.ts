/**
 * An Atria workbook: sheets set like the documents' tables (2026-10-07).
 *
 * A table sheet opens with the documents' title block (the eyebrow, the
 * title in Outfit, a muted lede and the meta line), then a white sheet with
 * no gridlines: a tinted small-caps head, hairlines between rows, numbers to
 * the right in tabular figures, statuses as the documents' tinted pills. The
 * head is frozen and filterable. An import template keeps its head on the
 * first row, where the import reads it, and offers its choices as lists.
 *
 * ExcelJS is loaded only when a workbook is made, so the console never
 * downloads it for anyone who does not export.
 */

import type { Workbook, Worksheet } from "exceljs";

import { FACE, INK, TONE, type Tone, saveFile } from "./tokens";

export interface SheetColumn {
  label: string;
  /** In characters, as Excel measures a column. */
  width: number;
  kind?: "text" | "number" | "percent" | "mono" | "date";
}

export type SheetCell = string | number | null | undefined | { text: string; tone: Tone };

export interface TableSheet {
  name: string;
  title?: string;
  lede?: string;
  meta?: string;
  columns: SheetColumn[];
  rows: SheetCell[][];
  /** A line under the table, in the muted note style. */
  note?: string;
}

const argb = (hex: string) => `FF${hex.slice(1).toUpperCase()}`;
const solid = (hex: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: argb(hex) } });
const hairline = (hex: string) => ({ style: "thin" as const, color: { argb: argb(hex) } });

function headRow(sheet: Worksheet, rowNumber: number, columns: SheetColumn[]) {
  const row = sheet.getRow(rowNumber);
  row.height = 24;
  columns.forEach((column, i) => {
    const cell = row.getCell(i + 1);
    cell.value = column.label.toUpperCase();
    cell.font = { name: FACE.text, size: 8.5, bold: true, color: { argb: argb(INK.muted) } };
    cell.fill = solid(INK.tint);
    cell.border = { top: hairline(INK.hair), bottom: hairline(INK.hair) };
    cell.alignment = {
      vertical: "middle",
      horizontal: column.kind === "number" || column.kind === "percent" ? "right" : "left",
      indent: 1,
    };
  });
}

function bodyCell(sheet: Worksheet, rowNumber: number, index: number, column: SheetColumn, value: SheetCell, last: boolean) {
  const cell = sheet.getRow(rowNumber).getCell(index + 1);
  const numeric = column.kind === "number" || column.kind === "percent";
  if (value && typeof value === "object") {
    cell.value = value.text;
    cell.font = { name: FACE.text, size: 9.5, bold: true, color: { argb: argb(TONE[value.tone].ink) } };
    cell.fill = solid(TONE[value.tone].ground);
  } else {
    cell.value = value ?? "";
    cell.font =
      column.kind === "mono"
        ? { name: FACE.mono, size: 9.5, color: { argb: argb(INK.p800) } }
        : { name: FACE.text, size: 10, bold: index === 0, color: { argb: argb(INK.ink) } };
    if (column.kind === "number") cell.numFmt = "#,##0";
    if (column.kind === "percent") cell.numFmt = "0%";
  }
  cell.alignment = { vertical: "middle", horizontal: numeric ? "right" : "left", indent: 1, wrapText: !numeric };
  cell.border = { bottom: hairline(last ? INK.hair : INK.hair2) };
}

export class AtriaWorkbook {
  private constructor(private readonly book: Workbook) {}

  static async create(): Promise<AtriaWorkbook> {
    const ExcelJS = (await import("exceljs")).default;
    const book = new ExcelJS.Workbook();
    book.creator = "Atria";
    book.created = new Date();
    return new AtriaWorkbook(book);
  }

  private sheet(name: string): Worksheet {
    return this.book.addWorksheet(name.slice(0, 31), {
      properties: { tabColor: { argb: argb(INK.p700) } },
      views: [{ showGridLines: false }],
    });
  }

  /** A table under the documents' title block. */
  table({ name, title, lede, meta, columns, rows, note }: TableSheet) {
    const sheet = this.sheet(name);
    sheet.columns = columns.map((c) => ({ width: c.width }));
    let at = 1;
    if (title) {
      const eyebrow = sheet.getCell(at, 1);
      eyebrow.value = "ATRIA";
      eyebrow.font = { name: FACE.text, size: 8.5, bold: true, color: { argb: argb(INK.p700) } };
      at += 1;
      const heading = sheet.getCell(at, 1);
      heading.value = title;
      // In the text face, bold: a workbook cannot carry its fonts, and Excel
      // often cannot reach Outfit even where it is installed (it fell back to
      // Arial on the machine this was checked on), while Plus Jakarta Sans holds.
      heading.font = { name: FACE.text, size: 18, bold: true, color: { argb: argb(INK.ink) } };
      sheet.getRow(at).height = 28;
      at += 1;
      for (const [text, size] of [
        [lede, 10],
        [meta, 9],
      ] as const) {
        if (!text) continue;
        const cell = sheet.getCell(at, 1);
        cell.value = text;
        cell.font = { name: FACE.text, size, color: { argb: argb(INK.muted) } };
        at += 1;
      }
      at += 1;
    }
    const head = at;
    headRow(sheet, head, columns);
    // No fixed height on a body row: Excel sizes it to its wrapped text.
    rows.forEach((row, r) => {
      columns.forEach((column, i) => bodyCell(sheet, head + 1 + r, i, column, row[i], r === rows.length - 1));
    });
    if (!rows.length) {
      const cell = sheet.getCell(head + 1, 1);
      cell.value = "Nothing to show for this period.";
      cell.font = { name: FACE.text, size: 10, italic: true, color: { argb: argb(INK.muted) } };
    }
    if (note) {
      const cell = sheet.getCell(head + Math.max(rows.length, 1) + 2, 1);
      cell.value = note;
      cell.font = { name: FACE.text, size: 9, color: { argb: argb(INK.muted) } };
    }
    sheet.views = [{ state: "frozen", ySplit: head, showGridLines: false }];
    if (rows.length) sheet.autoFilter = { from: { row: head, column: 1 }, to: { row: head + rows.length, column: columns.length } };
  }

  /**
   * An import template: the head on row one, where the import reads it, the
   * sample rows under it, and a list of choices on the columns that have one.
   * `choices` maps a column's index to a list, or to a range on another sheet.
   */
  template({ name, columns, rows, choices = {}, blankRows = 200 }: { name: string; columns: SheetColumn[]; rows: SheetCell[][]; choices?: Record<number, string[] | string>; blankRows?: number }) {
    const sheet = this.sheet(name);
    sheet.columns = columns.map((c) => ({ width: c.width }));
    headRow(sheet, 1, columns);
    rows.forEach((row, r) => columns.forEach((column, i) => bodyCell(sheet, 2 + r, i, column, row[i], false)));
    for (const [index, list] of Object.entries(choices)) {
      const formula = typeof list === "string" ? list : `"${list.join(",")}"`;
      for (let r = 2; r <= blankRows + 1; r++) {
        sheet.getRow(r).getCell(Number(index) + 1).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [formula],
          showErrorMessage: true,
          errorTitle: "Not one of the choices",
          error: "Pick a value from the list.",
        };
      }
    }
    sheet.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
  }

  async save(fileName: string) {
    const buffer = await this.book.xlsx.writeBuffer();
    saveFile(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileName);
  }

  /** The workbook's bytes, for a test to read back. */
  bytes(): Promise<ArrayBuffer> {
    return this.book.xlsx.writeBuffer() as Promise<ArrayBuffer>;
  }
}
