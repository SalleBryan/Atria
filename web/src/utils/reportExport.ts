/**
 * The Reports page as a file: PDF, Excel or CSV (2026-10-01, restyled
 * 2026-10-07). All three carry what the page shows, in the page's words, and
 * the PDF and the workbook are set in the documents' style (utils/export):
 * a cover with the hospital, unit and period, the figures as tiles, then
 * how visits ended, how patients booked, attendance by reminder, the fee
 * ledger and, for the whole hospital, each unit.
 */

import { saveCsv } from "./export/csv";
import { AtriaPdf, type Cell } from "./export/pdf";
import { AtriaWorkbook, type SheetCell } from "./export/sheet";
import { fileName, madeAt } from "./export/tokens";

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
  byBookedBy?: { bookedBy: string; booked: number; attended: number; noShow: number; attendance: number | null }[];
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

/** What the report is and whose: "Weekly report", "5 to 11 October 2026", the unit and the hospital. */
export interface ReportContext {
  title: string;
  period: string;
  unit: string;
  hospital: string;
}

// The Reports page's own words for each code.
export const CHANNEL_LABEL: Record<string, string> = {
  ONLINE: "Online booking",
  WALK_IN: "At the desk",
  PHONE: "By phone",
  REFERRAL: "Referred",
};
export const REMINDER_LABEL: Record<string, string> = { SENT: "Reminder sent", FAILED: "Reminder failed", NOT_SENT: "No reminder" };
export const BOOKED_BY_LABEL: Record<string, string> = {
  PATIENT: "The patient",
  RECEPTIONIST: "A receptionist",
  CLINICIAN: "A clinician",
  CLINIC_MANAGER: "A unit manager",
  TENANT_ADMIN: "An administrator",
};
export const REFUND_LABEL: Record<string, string> = { FULL: "Full refund", PARTIAL: "Partial refund", NONE: "No refund" };

const count = (n: number) => new Intl.NumberFormat("en-GB").format(n);
const money = (amount: number, currency: string) => `${count(amount)} ${currency}`;
const share = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "None");

/** Attendance as the page gives it: of the visits that were due, the share that came. */
export function attendanceOf(f: { attended: number; noShow: number; attendance?: number | null }): number | null {
  if (f.attendance != null) return f.attendance;
  return f.attended + f.noShow ? f.attended / (f.attended + f.noShow) : null;
}
const percent = (rate: number | null | undefined) => (rate == null ? "Not yet" : `${Math.round(rate * 100)}%`);

/** Every table the report holds, in the page's order, for all three formats. */
function tables(f: ReportFigures) {
  const outcomes = [
    ["Attended", f.attended, share(f.attended, f.booked)],
    ["No-show", f.noShow, share(f.noShow, f.booked)],
    ["Cancelled", f.cancelled, share(f.cancelled, f.booked)],
    ["Late cancelled", f.lateCancelled, share(f.lateCancelled, f.booked)],
  ] as const;
  const channels = (f.byChannel ?? []).map(
    (c) => [CHANNEL_LABEL[c.channel] ?? c.channel, c.booked, c.attended, c.noShow, c.attendance] as const,
  );
  const bookers = (f.byBookedBy ?? []).map(
    (b) => [BOOKED_BY_LABEL[b.bookedBy] ?? b.bookedBy, b.booked, b.attended, b.noShow, b.attendance] as const,
  );
  const reminders = (f.byReminder ?? []).map(
    (r) => [REMINDER_LABEL[r.reminder] ?? r.reminder, r.booked, r.attended, r.noShow, r.attendance] as const,
  );
  const currency = f.ledger?.currency ?? "XAF";
  const refunds = (f.ledger?.byEntitlement ?? []).map(
    (e) => [REFUND_LABEL[e.entitlement] ?? e.entitlement, e.entries, e.amountMinor] as const,
  );
  const bands = (f.ledger?.byBand ?? []).map((b) => [b.practice, b.entries, b.amountMinor] as const);
  const units = (f.units ?? []).map(
    (u) => [u.clinicName || "Unnamed unit", u.booked, u.attended, u.noShow, u.cancelled, attendanceOf(u)] as const,
  );
  return { outcomes, channels, bookers, reminders, currency, refunds, bands, units };
}

const tone = (rate: number | null | undefined): Cell =>
  rate == null ? { text: "Not yet", tone: "info" } : { text: percent(rate), tone: rate >= 0.8 ? "ok" : rate >= 0.6 ? "wait" : "bad" };

export async function exportReportPdf(f: ReportFigures, context: ReportContext) {
  const t = tables(f);
  const pdf = await AtriaPdf.create(`ATR-RPT · ${context.title}`);
  pdf.cover({
    kicker: context.title,
    title: context.unit,
    lede: "Visits disposition, attendance rate and fee ledger summary. A record of the period; no money moves through Atria.",
    meta: [
      { label: "Hospital", value: context.hospital },
      { label: "Period", value: context.period },
      { label: "Made", value: madeAt() },
      { label: "Visits booked", value: count(f.booked) },
    ],
  });
  pdf.tiles([
    { label: "Booked", value: count(f.booked) },
    { label: "Attended", value: count(f.attended), tone: "ok" },
    { label: "No-show", value: count(f.noShow), tone: f.noShow ? "bad" : undefined },
    { label: "Cancelled", value: count(f.cancelled + f.lateCancelled) },
    { label: "Attendance", value: percent(attendanceOf(f)), tone: "info" },
  ]);

  let n = 0;
  const next = () => String(++n).padStart(2, "0");
  if (t.units.length) {
    pdf.heading(next(), "Hospital units", "Each unit's visits in the period, and the share of those due that came.");
    pdf.table(
      [
        { label: "Unit", width: 3.2 },
        { label: "Booked", width: 1, align: "right" },
        { label: "Attended", width: 1.1, align: "right" },
        { label: "No-show", width: 1, align: "right" },
        { label: "Cancelled", width: 1.1, align: "right" },
        { label: "Attendance", width: 1.3, align: "right" },
      ],
      t.units.map(([name, booked, attended, noShow, cancelled, rate]) => [
        name,
        count(booked),
        count(attended),
        count(noShow),
        count(cancelled),
        tone(rate),
      ]),
    );
  }
  pdf.heading(next(), "How visits ended", "Attended, missed or cancelled, as a share of the visits booked.");
  pdf.table(
    [
      { label: "Outcome", width: 3 },
      { label: "Visits", width: 1, align: "right" },
      { label: "Share", width: 1, align: "right" },
    ],
    t.outcomes.map(([label, visits, part]) => [label, count(visits), part]),
  );
  pdf.heading(next(), "How patients booked", "How this period's bookings reached the unit, and how many of each came.");
  pdf.table(
    [
      { label: "Channel", width: 2.6 },
      { label: "Booked", width: 1, align: "right" },
      { label: "Came", width: 1, align: "right" },
      { label: "Did not", width: 1, align: "right" },
      { label: "Attendance", width: 1.3, align: "right" },
    ],
    t.channels.map(([label, booked, came, missed, rate]) => [label, count(booked), count(came), count(missed), tone(rate)]),
  );
  pdf.heading(next(), "Who booked", "The patient, or staff on their behalf.");
  pdf.table(
    [
      { label: "Booked by", width: 2.6 },
      { label: "Booked", width: 1, align: "right" },
      { label: "Came", width: 1, align: "right" },
      { label: "Did not", width: 1, align: "right" },
      { label: "Attendance", width: 1.3, align: "right" },
    ],
    t.bookers.map(([label, booked, came, missed, rate]) => [label, count(booked), count(came), count(missed), tone(rate)]),
  );
  pdf.heading(next(), "Attendance by reminder", "Shown side by side, not as cause and effect.");
  pdf.table(
    [
      { label: "Reminder", width: 2.6 },
      { label: "Booked", width: 1, align: "right" },
      { label: "Came", width: 1, align: "right" },
      { label: "Did not", width: 1, align: "right" },
      { label: "Attendance", width: 1.3, align: "right" },
    ],
    t.reminders.map(([label, booked, came, missed, rate]) => [label, count(booked), count(came), count(missed), tone(rate)]),
  );
  pdf.heading(next(), "Fee ledger", "A record of each closed visit's fee and refund. No money moves through Atria.");
  pdf.table(
    [
      { label: "Refund", width: 3 },
      { label: "Visits", width: 1, align: "right" },
      { label: "Amount", width: 1.5, align: "right" },
    ],
    t.refunds.map(([label, visits, amount]) => [label, count(visits), money(amount, t.currency)]),
    { caption: "By refund" },
  );
  pdf.table(
    [
      { label: "Fee band", width: 3 },
      { label: "Visits", width: 1, align: "right" },
      { label: "Amount", width: 1.5, align: "right" },
    ],
    t.bands.map(([label, visits, amount]) => [label, count(visits), money(amount, t.currency)]),
    { caption: "By fee band" },
  );
  pdf.save(fileName([context.title, context.unit, context.period], "pdf"));
}

export async function exportReportExcel(f: ReportFigures, context: ReportContext) {
  const t = tables(f);
  const book = await AtriaWorkbook.create({
    kicker: context.title,
    title: context.unit,
    code: `ATR-RPT · ${context.title}`,
    meta: [
      { label: "Hospital", value: context.hospital },
      { label: "Period", value: context.period },
      { label: "Made", value: madeAt() },
    ],
  });
  const rate = (r: number | null | undefined): SheetCell => (r == null ? "Not yet" : Math.round(r * 100) / 100);
  const share = (part: number) => (f.booked ? Math.round((part / f.booked) * 100) / 100 : 0);

  // Summary: the figures as tiles, then how the visits ended.
  const summary = book.sheet("Summary", [22, 18, 18, 18, 18]);
  const attendance = attendanceOf(f);
  summary.tiles([
    { label: "Booked", value: f.booked },
    { label: "Attended", value: f.attended, tone: "ok" },
    { label: "No-show", value: f.noShow, tone: f.noShow ? "bad" : undefined },
    { label: "Cancelled", value: f.cancelled + f.lateCancelled },
    attendance == null
      ? { label: "Attendance", value: "Not yet", accent: true }
      : { label: "Attendance", value: attendance, accent: true, percent: true },
  ]);
  summary.heading("01", "How visits ended", "Attended, missed or cancelled, as a share of the visits booked.");
  summary.table(
    [
      { label: "Outcome", width: 22 },
      { label: "Visits", width: 18, kind: "number" },
      { label: "Share", width: 18, kind: "percent" },
    ],
    t.outcomes.map(([label, visits]) => [label, visits, share(visits)]),
    { filter: false },
  );
  summary.note("Attendance counts the visits that were due: those who came, of those who came or did not.");

  if (t.units.length) {
    const units = book.sheet("Hospital units", [34, 13, 13, 13, 13, 16]);
    units.heading("02", "Hospital units", "Each unit's visits in the period, and the share of those due that came.");
    units.table(
      [
        { label: "Unit", width: 34 },
        { label: "Booked", width: 13, kind: "number" },
        { label: "Attended", width: 13, kind: "number" },
        { label: "No-show", width: 13, kind: "number" },
        { label: "Cancelled", width: 13, kind: "number" },
        { label: "Attendance", width: 16, kind: "percent" },
      ],
      t.units.map(([name, booked, attended, noShow, cancelled, r]) => [name, booked, attended, noShow, cancelled, rate(r)]),
    );
  }

  const groups = book.sheet("Attendance", [28, 13, 13, 13, 16]);
  const columns = (label: string) =>
    [
      { label, width: 28 },
      { label: "Booked", width: 13, kind: "number" },
      { label: "Came", width: 13, kind: "number" },
      { label: "Did not", width: 13, kind: "number" },
      { label: "Attendance", width: 16, kind: "percent" },
    ] as const;
  const rowsOf = (rows: typeof t.channels) => rows.map(([l, booked, came, missed, r]) => [l, booked, came, missed, rate(r)]);
  groups.heading("03", "How patients booked", "How this period's bookings reached the unit, and how many of each came.");
  groups.table([...columns("Channel")], rowsOf(t.channels), { filter: false });
  groups.heading("04", "Who booked", "The patient, or staff on their behalf.");
  groups.table([...columns("Booked by")], rowsOf(t.bookers), { filter: false });
  groups.heading("05", "Attendance by reminder", "Shown side by side, not as cause and effect.");
  groups.table([...columns("Reminder")], rowsOf(t.reminders), { filter: false });

  const fees = book.sheet("Fee ledger", [30, 13, 20]);
  fees.heading("06", "Fee ledger", "A record of each closed visit's fee and refund. No money moves through Atria.");
  const feeColumns = (label: string) =>
    [
      { label, width: 30 },
      { label: "Visits", width: 13, kind: "number" },
      { label: `Amount (${t.currency})`, width: 20, kind: "number" },
    ] as const;
  fees.table(
    [...feeColumns("Refund")],
    t.refunds.map(([l, v, a]) => [l, v, a]),
    { filter: false },
  );
  fees.table(
    [...feeColumns("Fee band")],
    t.bands.map(([l, v, a]) => [l, v, a]),
    { filter: false },
  );

  await book.save(fileName([context.title, context.unit, context.period], "xlsx"));
}

/** The report's rows as one table: section, row, and the figures that row has. */
export function reportCsv(f: ReportFigures): { head: string[]; rows: (string | number)[][] } {
  const t = tables(f);
  const rows: (string | number)[][] = [
    ...t.units.map(([name, booked, attended, noShow, cancelled, r]) => [
      "Hospital units",
      name,
      booked,
      attended,
      noShow,
      cancelled,
      "",
      percent(r),
    ]),
    ...t.outcomes.map(([label, visits, part]) => ["How visits ended", label, visits, "", "", "", "", part]),
    ...t.channels.map(([label, booked, came, missed, r]) => ["How patients booked", label, booked, came, missed, "", "", percent(r)]),
    ...t.bookers.map(([label, booked, came, missed, r]) => ["Who booked", label, booked, came, missed, "", "", percent(r)]),
    ...t.reminders.map(([label, booked, came, missed, r]) => ["Attendance by reminder", label, booked, came, missed, "", "", percent(r)]),
    ...t.refunds.map(([label, visits, amount]) => ["Fee ledger by refund", label, visits, "", "", "", money(amount, t.currency), ""]),
    ...t.bands.map(([label, visits, amount]) => ["Fee ledger by fee band", label, visits, "", "", "", money(amount, t.currency), ""]),
  ];
  return { head: ["Section", "Row", "Visits or booked", "Came", "Did not", "Cancelled", "Amount", "Share or attendance"], rows };
}

export function exportReportCsv(f: ReportFigures, context: ReportContext) {
  const { head, rows } = reportCsv(f);
  saveCsv(head, rows, fileName([context.title, context.unit, context.period], "csv"));
}
