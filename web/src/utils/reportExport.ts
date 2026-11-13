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

/** What differs from an earlier period (core/report.change). A difference, never a cause. */
export interface ReportComparison {
  from: string;
  to: string;
  counts: Record<"booked" | "attended" | "noShow" | "cancelled" | "lateCancelled", { before: number; after: number; change: number }>;
  attendance: { before: number | null; after: number | null; points: number | null };
}

/** What the general queue measured (core/queue_metrics). Measurements only, never a saving. */
export interface QueueFigures {
  tickets: number;
  seen: number;
  byChannel: Record<string, number>;
  medianWaitMinutes: number | null;
  medianConsultationMinutes: number | null;
  arrivedInWindow: number;
  promiseBreached: number;
  medianBreachMinutes: number | null;
  longestBreachMinutes: number | null;
  bypassed: number;
  urgent: number;
  late: number;
  doctorIdleWhileWaitingMinutes: number;
}

export interface ReportFigures {
  comparison?: ReportComparison;
  queue?: QueueFigures | null;
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

export const signed = (n: number) => (n > 0 ? `up ${n}` : n < 0 ? `down ${-n}` : "no change");

/** "was 63%, up 12.5 points", or why there is nothing to compare. */
export function attendanceChange({ before, points }: ReportComparison["attendance"]): string {
  if (points == null) return "No earlier figure to compare";
  return `was ${percent(before)}, ${points === 0 ? "no change" : `${points > 0 ? "up" : "down"} ${Math.abs(points)} points`}`;
}

/** A span as people read it: minutes below an hour, then hours and minutes (working rules, section 11). */
export function spanText(minutes: number | null): string {
  if (minutes == null) return "Not available here";
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole} min`;
  return `${Math.floor(whole / 60)} h ${String(whole % 60).padStart(2, "0")} min`;
}

/** The queue as labelled rows, for the page and all three files. Counts and times, no cause. */
export function queueRows(q: QueueFigures): [string, string][] {
  const kept = q.arrivedInWindow - q.promiseBreached;
  const joined = Object.entries(q.byChannel).map(([channel, n]): [string, string] => [
    `Taken ${(CHANNEL_LABEL[channel] ?? channel).toLowerCase()}`,
    count(n),
  ]);
  return [
    ["Places in the queue", count(q.tickets)],
    ["Seen by a doctor", count(q.seen)],
    ["Typical wait after arriving", spanText(q.medianWaitMinutes)],
    ["Typical consultation", spanText(q.medianConsultationMinutes)],
    ["Seen within their arrival window", `${count(kept)} of ${count(q.arrivedInWindow)} who arrived in it`],
    ["Typical time past the window, when late", spanText(q.medianBreachMinutes)],
    ["Longest time past the window", spanText(q.longestBreachMinutes)],
    ["Doctor free while someone waited", spanText(q.doctorIdleWhileWaitingMinutes)],
    ["Places passed over once or more", count(q.bypassed)],
    ["Places marked urgent", count(q.urgent)],
    ["Places that arrived late", count(q.late)],
    ...joined,
  ];
}

const COMPARED: [keyof ReportComparison["counts"], string][] = [
  ["booked", "Booked"],
  ["attended", "Attended"],
  ["noShow", "No-show"],
  ["cancelled", "Cancelled"],
  ["lateCancelled", "Late cancelled"],
];

/** The comparison as rows: what it is, the earlier count, this period's, and the change in words. */
function comparisonRows(f: ReportFigures) {
  const c = f.comparison;
  if (!c) return [];
  return [
    ...COMPARED.map(([key, label]) => [label, c.counts[key].before, c.counts[key].after, signed(c.counts[key].change)] as const),
    [
      "Attendance",
      percent(c.attendance.before),
      percent(c.attendance.after),
      attendanceChange(c.attendance).replace(/^was [^,]*, /, ""),
    ] as const,
  ];
}

/** Every table the report holds, in the page's order, for all three formats. */
function tables(f: ReportFigures) {
  // Three different percentages, kept apart (audit F18): the share of booked
  // visits, the share of closed outcomes, and attendance (attended of attended
  // plus no-show). A visit not yet closed counts in the first and not the second.
  const closed = f.attended + f.noShow + f.cancelled + f.lateCancelled;
  const open = Math.max(0, f.booked - closed);
  const outcomes = [
    ["Attended", f.attended],
    ["No-show", f.noShow],
    ["Cancelled", f.cancelled],
    ["Late cancelled", f.lateCancelled],
  ].map(([label, n]) => [label as string, n as number, share(n as number, f.booked), share(n as number, closed)] as const);
  const stillOpen = ["Still open", open, share(open, f.booked), "Not closed"] as const;
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
  return {
    outcomes: [...outcomes, stillOpen],
    comparison: comparisonRows(f),
    queue: f.queue ? queueRows(f.queue) : [],
    channels,
    bookers,
    reminders,
    currency,
    refunds,
    bands,
    units,
  };
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
  pdf.heading(next(), "How visits ended", "Every booked visit, as a share of the visits booked and of those closed.");
  pdf.table(
    [
      { label: "Outcome", width: 3 },
      { label: "Visits", width: 1, align: "right" },
      { label: "Share of booked", width: 1.4, align: "right" },
      { label: "Share of closed", width: 1.4, align: "right" },
    ],
    t.outcomes.map(([label, visits, ofBooked, ofClosed]) => [label, count(visits), ofBooked, ofClosed]),
  );
  if (f.comparison) {
    pdf.heading(
      next(),
      "Compared with the earlier period",
      `${f.comparison.from} to ${f.comparison.to}. A difference is shown, not a reason for it.`,
    );
    pdf.table(
      [
        { label: "Figure", width: 3 },
        { label: "Earlier", width: 1.2, align: "right" },
        { label: "This period", width: 1.4, align: "right" },
        { label: "Change", width: 1.6, align: "right" },
      ],
      t.comparison.map(([label, before, after, change]) => [label, String(before), String(after), change]),
    );
  }
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
  if (t.queue.length) {
    pdf.heading(next(), "The general queue", "What the queue measured. Late is against the arrival window as last sent to the patient.");
    pdf.table(
      [
        { label: "Measure", width: 3.4 },
        { label: "Value", width: 2.2, align: "right" },
      ],
      t.queue,
    );
  }
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
  const sheetShare = (part: number, g: ReportFigures) => {
    const closed = g.attended + g.noShow + g.cancelled + g.lateCancelled;
    return closed ? Math.round((part / closed) * 100) / 100 : 0;
  };

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
  summary.heading("01", "How visits ended", "Every booked visit, as a share of the visits booked and of those closed.");
  summary.table(
    [
      { label: "Outcome", width: 22 },
      { label: "Visits", width: 18, kind: "number" },
      { label: "Share of booked", width: 18, kind: "percent" },
      { label: "Share of closed", width: 18, kind: "percent" },
    ],
    t.outcomes.map(([label, visits]) => [label, visits, share(visits), label === "Still open" ? "Not closed" : sheetShare(visits, f)]),
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

  if (f.comparison) {
    const sheet = book.sheet("Comparison", [28, 16, 16, 22]);
    sheet.heading(
      "00",
      "Compared with the earlier period",
      `${f.comparison.from} to ${f.comparison.to}. A difference is shown, not a reason for it.`,
    );
    sheet.table(
      [
        { label: "Figure", width: 28 },
        { label: "Earlier", width: 16 },
        { label: "This period", width: 16 },
        { label: "Change", width: 22 },
      ],
      t.comparison.map(([label, before, after, change]) => [label, String(before), String(after), change]),
      { filter: false },
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

  if (t.queue.length) {
    const queue = book.sheet("Queue", [40, 34]);
    queue.heading("07", "The general queue", "What the queue measured. Late is against the arrival window as last sent to the patient.");
    queue.table(
      [
        { label: "Measure", width: 40 },
        { label: "Value", width: 34 },
      ],
      t.queue,
      { filter: false },
    );
  }

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
    ...t.outcomes.map(([label, visits, ofBooked, ofClosed]) => [
      "How visits ended",
      label,
      visits,
      "",
      "",
      "",
      "",
      `${ofBooked} of booked; ${ofClosed} of closed`,
    ]),
    ...t.comparison.map(([label, before, after, change]) => [
      "Compared with the earlier period",
      label,
      after,
      "",
      "",
      "",
      "",
      `was ${before}, ${change}`,
    ]),
    ...t.channels.map(([label, booked, came, missed, r]) => ["How patients booked", label, booked, came, missed, "", "", percent(r)]),
    ...t.bookers.map(([label, booked, came, missed, r]) => ["Who booked", label, booked, came, missed, "", "", percent(r)]),
    ...t.reminders.map(([label, booked, came, missed, r]) => ["Attendance by reminder", label, booked, came, missed, "", "", percent(r)]),
    ...t.queue.map(([label, value]) => ["The general queue", label, "", "", "", "", "", value]),
    ...t.refunds.map(([label, visits, amount]) => ["Fee ledger by refund", label, visits, "", "", "", money(amount, t.currency), ""]),
    ...t.bands.map(([label, visits, amount]) => ["Fee ledger by fee band", label, visits, "", "", "", money(amount, t.currency), ""]),
  ];
  return { head: ["Section", "Row", "Visits or booked", "Came", "Did not", "Cancelled", "Amount", "Share or attendance"], rows };
}

export function exportReportCsv(f: ReportFigures, context: ReportContext) {
  const { head, rows } = reportCsv(f);
  saveCsv(head, rows, fileName([context.title, context.unit, context.period], "csv"));
}
