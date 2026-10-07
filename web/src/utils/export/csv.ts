/**
 * An Atria CSV (2026-10-07). A CSV carries no fonts or colours, so what it
 * shares with the documents is its words: the same plain headings and
 * labels as the screen and the PDF (never a code like WALK_IN), dates a
 * person reads, and a byte-order mark so Excel opens accented names intact.
 * One table per file, head first, so any spreadsheet or script reads it.
 */

import { saveFile } from "./tokens";

export type CsvCell = string | number | null | undefined;

const quoted = (value: CsvCell) => {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function csvText(head: string[], rows: CsvCell[][]): string {
  return [head, ...rows].map((row) => row.map(quoted).join(",")).join("\r\n");
}

export function saveCsv(head: string[], rows: CsvCell[][], fileName: string) {
  saveFile(new Blob(["﻿", csvText(head, rows), "\r\n"], { type: "text/csv;charset=utf-8" }), fileName);
}
