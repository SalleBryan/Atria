/**
 * An Atria workbook, set like the Atria documents (2026-10-07, branded the
 * same day at the user's request).
 *
 * Every sheet is a page of the documents: the platform's pale ground all
 * round, a brand-blue banner with the Atria mark, the kicker and the title,
 * a white strip of the details (hospital, unit, period, when it was made),
 * then the content, built in parts as a PDF is: figure tiles with the
 * attendance one in accent blue, numbered section headings, white tables
 * with a tinted small-caps head and hairlines, attendance as a figure with
 * an in-cell bar (as the Reports page draws it), and muted notes. Printed,
 * a sheet is A4 landscape, one page wide, with the documents' running foot:
 * the code on the left, "Page n of m" on the right.
 *
 * The banner is a solid fill, not a gradient: spreadsheet programs that do
 * not draw gradient fills would leave white words on white.
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
  kind?: "text" | "number" | "percent" | "mono";
}

export type SheetCell = string | number | null | undefined | { text: string; tone: Tone };

/** What a workbook is, on every sheet's banner and in its printed foot. */
export interface Brand {
  /** Small caps over the title: "Weekly report". */
  kicker: string;
  title: string;
  /** Hospital, unit, period and the like, in the white strip under the banner. */
  meta: { label: string; value: string }[];
  /** The printed foot's code: "ATR-RPT · Weekly report". */
  code: string;
}

const argb = (hex: string) => `FF${hex.slice(1).toUpperCase()}`;
const solid = (hex: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: argb(hex) } });
const line = (hex: string) => ({ style: "thin" as const, color: { argb: argb(hex) } });
const font = (size: number, colour: string, extra: { bold?: boolean; italic?: boolean; mono?: boolean } = {}) => ({
  name: extra.mono ? FACE.mono : FACE.text,
  size,
  bold: extra.bold,
  italic: extra.italic,
  color: { argb: argb(colour) },
});

/** The Atria mark as a PNG: the pulse line in a glass tile, for the banner. */
function markPng(): string | null {
  try {
    const size = 96;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.beginPath();
    ctx.roundRect(1, 1, size - 2, size - 2, 30);
    ctx.fillStyle = "rgba(255,255,255,0.24)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 2;
    ctx.stroke();
    // M3 12h4l2-5 3 10 2.5-6 1.8 3H21, in a 24 box drawn at half the tile.
    const s = size / 2 / 24;
    const o = size / 4;
    const points: [number, number][] = [[3, 12], [7, 12], [9, 7], [12, 17], [14.5, 11], [16.3, 14], [21, 14]];
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(o + x * s, o + y * s) : ctx.moveTo(o + x * s, o + y * s)));
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    return canvas.toDataURL("image/png").split(",")[1] ?? null;
  } catch {
    return null;
  }
}

/** One sheet, built top to bottom in the documents' parts. Column A is the page's margin. */
export class AtriaSheet {
  private row = 1;
  private readonly last: number;
  private notes = 0;
  private readonly span: number;

  constructor(
    private readonly sheet: Worksheet,
    widths: number[],
  ) {
    this.last = widths.length + 1; // column B onwards holds the content
    this.span = widths.reduce((sum, w) => sum + w, 0);
    sheet.getColumn(1).width = 3;
    widths.forEach((w, i) => (sheet.getColumn(i + 2).width = w));
    sheet.getColumn(this.last + 1).width = 3;
    // The page's ground under everything; parts paint white on top of it.
    for (let c = 1; c <= this.last + 12; c++) sheet.getColumn(c).fill = solid(INK.ground);
  }

  private cell(row: number, col: number) {
    return this.sheet.getRow(row).getCell(col);
  }

  private gap(height = 10) {
    this.sheet.getRow(this.row).height = height;
    this.row += 1;
  }

  /** The banner: the mark, ATRIA, the kicker and the title, in brand blue. */
  banner(brand: Brand, logo: number | null) {
    this.gap(14);
    const top = this.row;
    this.sheet.mergeCells(top, 2, top + 2, this.last);
    const cell = this.cell(top, 2);
    cell.value = {
      richText: [
        { text: "ATRIA", font: font(11, "#FFFFFF", { bold: true }) },
        { text: "   HEALTHCARE APPOINTMENTS\n", font: font(7.5, "#DCE8FF", { bold: true }) },
        { text: `${brand.title}\n`, font: font(18, "#FFFFFF", { bold: true }) },
        { text: brand.kicker.toUpperCase(), font: font(8.5, "#DCE8FF", { bold: true }) },
      ],
    };
    cell.fill = solid(INK.p800);
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true, indent: logo == null ? 1 : 7 };
    this.sheet.getRow(top).height = 26;
    this.sheet.getRow(top + 1).height = 26;
    this.sheet.getRow(top + 2).height = 26;
    if (logo != null) {
      this.sheet.addImage(logo, { tl: { col: 1.25, row: top - 1 + 0.75 }, ext: { width: 46, height: 46 }, editAs: "oneCell" });
    }
    this.row = top + 3;
    // The details strip, white, as the cover's meta card.
    const strip = this.row;
    this.sheet.mergeCells(strip, 2, strip, this.last);
    const meta = this.cell(strip, 2);
    meta.value = {
      richText: brand.meta.flatMap((item, i) => [
        { text: `${i ? "      " : ""}${item.label.toUpperCase()}  `, font: font(7.5, INK.muted, { bold: true }) },
        { text: item.value, font: font(10, INK.ink, { bold: true }) },
      ]),
    };
    meta.fill = solid(INK.surface);
    meta.alignment = { vertical: "middle", indent: 1, wrapText: true };
    meta.border = { bottom: line(INK.hair) };
    // A narrow sheet wraps the details onto a second line; give it the room.
    const length = brand.meta.reduce((sum, item) => sum + item.label.length + item.value.length + 8, 0);
    this.sheet.getRow(strip).height = length * 1.05 > this.span ? 46 : 30;
    this.row += 1;
    this.gap(14);
  }

  /** Figure tiles in a row: a small-caps label over a large figure; `accent` is the blue one. */
  tiles(items: { label: string; value: string | number; accent?: boolean; tone?: Tone; percent?: boolean }[]) {
    const labels = this.row;
    const values = this.row + 1;
    items.forEach((item, i) => {
      const col = i + 2;
      const ground = item.accent ? INK.p700 : INK.surface;
      const label = this.cell(labels, col);
      label.value = item.label.toUpperCase();
      label.font = font(7.5, item.accent ? "#DCE8FF" : INK.muted, { bold: true });
      label.fill = solid(ground);
      label.alignment = { vertical: "bottom", indent: 1 };
      label.border = { top: line(item.accent ? INK.p700 : INK.hair), left: line(INK.hair), right: line(INK.hair) };
      const value = this.cell(values, col);
      value.value = item.value;
      if (item.percent) value.numFmt = "0%";
      else if (typeof item.value === "number") value.numFmt = "#,##0";
      value.font = font(20, item.accent ? "#FFFFFF" : item.tone ? TONE[item.tone].ink : INK.ink, { bold: true });
      value.fill = solid(ground);
      value.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      value.border = { bottom: line(item.accent ? INK.p700 : INK.hair), left: line(INK.hair), right: line(INK.hair) };
    });
    this.sheet.getRow(labels).height = 22;
    this.sheet.getRow(values).height = 34;
    this.row += 2;
    this.gap(16);
  }

  /** A section heading, as the documents number their chapters. */
  heading(number: string, title: string, sub?: string) {
    const cell = this.cell(this.row, 2);
    cell.value = {
      richText: [
        { text: `${number}   `, font: font(11, INK.p600, { bold: true, mono: true }) },
        { text: title, font: font(14, INK.ink, { bold: true }) },
      ],
    };
    this.sheet.getRow(this.row).height = 24;
    this.row += 1;
    if (sub) {
      const note = this.cell(this.row, 2);
      note.value = sub;
      note.font = font(9, INK.muted);
      this.row += 1;
    }
    this.gap(6);
  }

  /**
   * A white table: tinted small-caps head, hairlines, figures to the right,
   * tones as the documents' pills, attendance with an in-cell bar. Returns
   * the head's row, which a template's lists and the frozen pane start from.
   */
  table(columns: SheetColumn[], rows: SheetCell[][], { empty = "Nothing to show for this period.", filter = true }: { empty?: string; filter?: boolean } = {}): number {
    const head = this.row;
    columns.forEach((column, i) => {
      const cell = this.cell(head, i + 2);
      cell.value = column.label.toUpperCase();
      cell.font = font(8, INK.muted, { bold: true });
      cell.fill = solid(INK.tint);
      cell.border = { top: line(INK.hair), bottom: line(INK.hair), ...(i === 0 ? { left: line(INK.hair) } : {}), ...(i === columns.length - 1 ? { right: line(INK.hair) } : {}) };
      cell.alignment = { vertical: "middle", horizontal: column.kind === "number" || column.kind === "percent" ? "right" : "left", indent: 1 };
    });
    this.sheet.getRow(head).height = 24;
    const body = rows.length ? rows : [[empty]];
    body.forEach((row, r) => {
      const at = head + 1 + r;
      const lastRow = r === body.length - 1;
      columns.forEach((column, i) => {
        const value = row[i];
        const cell = this.cell(at, i + 2);
        const numeric = column.kind === "number" || column.kind === "percent";
        if (value && typeof value === "object") {
          cell.value = value.text;
          cell.font = font(9.5, TONE[value.tone].ink, { bold: true });
          cell.fill = solid(TONE[value.tone].ground);
        } else {
          cell.value = value ?? "";
          cell.font = !rows.length
            ? font(10, INK.muted, { italic: true })
            : column.kind === "mono"
              ? font(9.5, INK.p800, { mono: true })
              : font(10, INK.ink, { bold: i === 0 });
          cell.fill = solid(INK.surface);
          if (column.kind === "number") cell.numFmt = "#,##0";
          if (column.kind === "percent") cell.numFmt = "0%";
        }
        cell.alignment = { vertical: "middle", horizontal: numeric ? "right" : "left", indent: 1, wrapText: !numeric };
        cell.border = {
          bottom: line(lastRow ? INK.hair : INK.hair2),
          ...(i === 0 ? { left: line(INK.hair) } : {}),
          ...(i === columns.length - 1 ? { right: line(INK.hair) } : {}),
        };
      });
      this.sheet.getRow(at).height = 21;
    });
    const end = head + body.length;
    // Attendance read at a glance: a bar in the cell, on the Reports page's blue.
    columns.forEach((column, i) => {
      if (column.kind !== "percent" || !rows.length) return;
      const letter = this.sheet.getColumn(i + 2).letter;
      this.sheet.addConditionalFormatting({
        ref: `${letter}${head + 1}:${letter}${end}`,
        rules: [
          {
            type: "dataBar",
            priority: 1,
            minLength: 0,
            maxLength: 100,
            cfvo: [
              { type: "num", value: 0 },
              { type: "num", value: 1 },
            ],
            color: { argb: argb(INK.p200) },
            gradient: false,
          } as never,
        ],
      });
    });
    if (filter && rows.length) this.sheet.autoFilter = { from: { row: head, column: 2 }, to: { row: end, column: columns.length + 1 } };
    this.row = end + 1;
    this.gap(16);
    return head;
  }

  /** A muted note under a part. */
  note(text: string) {
    const cell = this.cell(this.row, 2);
    cell.value = text;
    cell.font = font(9, INK.muted);
    this.row += 1;
    this.notes += 1;
  }

  /** Lists of choices on a template's columns, for the rows under its head. */
  choices(head: number, lists: Record<number, string[] | string>, rows = 200) {
    for (const [index, list] of Object.entries(lists)) {
      const formula = typeof list === "string" ? list : `"${list.join(",")}"`;
      for (let r = head + 1; r <= head + rows; r++) {
        this.cell(r, Number(index) + 2).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [formula],
          showErrorMessage: true,
          errorTitle: "Not one of the choices",
          error: "Pick a value from the list.",
        };
      }
    }
  }

  /** Keep the rows above `row` in view when scrolling. */
  freezeAbove(row: number) {
    this.sheet.views = [{ state: "frozen", ySplit: row, xSplit: 0, showGridLines: false }];
  }
}

export class AtriaWorkbook {
  private logo: number | null = null;

  private constructor(
    private readonly book: Workbook,
    private readonly brand: Brand,
  ) {
    const png = markPng();
    if (png) this.logo = book.addImage({ base64: png, extension: "png" });
  }

  static async create(brand: Brand): Promise<AtriaWorkbook> {
    const ExcelJS = (await import("exceljs")).default;
    const book = new ExcelJS.Workbook();
    book.creator = "Atria";
    book.title = `${brand.kicker}, ${brand.title}`;
    book.created = new Date();
    return new AtriaWorkbook(book, brand);
  }

  /**
   * A new sheet with the banner and the details already on it. `widths` are
   * the content's columns, in characters, from column B.
   */
  sheet(name: string, widths: number[]): AtriaSheet {
    const sheet = this.book.addWorksheet(name.slice(0, 31), {
      properties: { tabColor: { argb: argb(INK.p700) } },
      views: [{ showGridLines: false }],
      pageSetup: {
        paperSize: 9, // A4
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true,
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 },
      },
      headerFooter: {
        oddFooter: `&L&"${FACE.mono},Regular"&8${this.brand.code}&R&"${FACE.text},Regular"&8Page &P of &N`,
      },
    });
    const page = new AtriaSheet(sheet, widths);
    page.banner(this.brand, this.logo);
    return page;
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
