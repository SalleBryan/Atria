/**
 * A week of hours, one row a day: a tick to open the day, and a start and an
 * end from the platform's time menu. Shared by a clinician's working hours
 * (staff/Availability.tsx) and a unit's opening hours (staff/Settings.tsx), so
 * the two read and behave the same. Weekday 0 is Monday, as the API counts.
 */

import { CheckMark } from "./icons";
import { halfHours, type PickerOption, SelectMenu } from "./Pickers";

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export type Hours = Record<string, { start: string; end: string }>;
export type Week = Record<string, { on: boolean; start: string; end: string }>;

/** Half hours, plus a saved time that is not on one, so it is never shown as blank. */
export function timeOptions(current: string): PickerOption[] {
  const times = halfHours();
  return times.some((t) => t.id === current) ? times : [...times, { id: current, label: current }].sort((a, b) => a.id.localeCompare(b.id));
}

export function weekFrom(hours: Hours | null | undefined, fallback = { start: "08:00", end: "16:00" }): Week {
  return Object.fromEntries(
    WEEKDAYS.map((_, day) => {
      const span = hours?.[String(day)];
      return [String(day), { on: Boolean(span), start: span?.start ?? fallback.start, end: span?.end ?? fallback.end }];
    }),
  );
}

/** The week as the API takes it: each weekday its span, or null for a day off. */
export function daysOf(week: Week): Record<string, { start: string; end: string } | null> {
  return Object.fromEntries(Object.entries(week).map(([day, v]) => [day, v.on ? { start: v.start, end: v.end } : null]));
}

export function WeekHours({
  week,
  onChange,
  editable = true,
  closedLabel = "Day off",
}: {
  week: Week;
  onChange: (week: Week) => void;
  editable?: boolean;
  closedLabel?: string;
}) {
  return (
    <ol className="week-rows">
      {WEEKDAYS.map((name, day) => {
        const row = week[String(day)] as Week[string];
        const set = (patch: Partial<typeof row>) => onChange({ ...week, [String(day)]: { ...row, ...patch } });
        return (
          <li key={name} className={`week-row${row.on ? "" : " week-row-off"}`}>
            <label className={`checkbox week-day${editable ? "" : " checkbox-off"}`}>
              <input type="checkbox" checked={row.on} disabled={!editable} onChange={(event) => set({ on: event.target.checked })} />
              <span className="checkbox-box" aria-hidden="true">
                <CheckMark size={13} />
              </span>
              <span>{name}</span>
            </label>
            {row.on ? (
              <span className="week-times">
                <SelectMenu
                  label={`${name} start`}
                  value={row.start}
                  options={timeOptions(row.start)}
                  width={140}
                  disabled={!editable}
                  onChange={(start) => set({ start })}
                />
                <span aria-hidden="true">to</span>
                <SelectMenu
                  label={`${name} end`}
                  value={row.end}
                  options={timeOptions(row.end)}
                  width={140}
                  disabled={!editable}
                  onChange={(end) => set({ end })}
                />
              </span>
            ) : (
              <span className="week-off">{closedLabel}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
