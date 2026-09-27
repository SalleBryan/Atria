/**
 * A week of days and the free times on the chosen one: Find care's day chips
 * and time slots, for one clinician and one visit type. Shared by the Move
 * dialog (MoveVisit.tsx) and the desk's booking (staff/BookForPatient.tsx), so
 * both offer times the same way. Free times come from the week search Find
 * care uses, so what is offered is what the server would accept.
 */

import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { clock } from "../patient/data";
import { ChevronLeft, ChevronRight } from "./icons";
import { LoadingIndicator } from "./LoadingIndicator";

export interface Slot {
  startAt: string;
  endAt: string;
}

const WEEK = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export function shift(date: string, byDays: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + byDays * DAY_MS).toISOString().slice(0, 10);
}

export function WeekSlots({
  clinicianId,
  typeId,
  slot,
  onSlot,
  dayLabel = "DAY",
  timeLabel = "TIME",
  fresh = 0,
  onlyToday = false,
  onFailure,
}: {
  clinicianId: string;
  typeId: string;
  slot: Slot | null;
  onSlot: (slot: Slot | null) => void;
  dayLabel?: string;
  timeLabel?: string;
  /** Bumped to read the week again, after a time was taken. */
  fresh?: number;
  /** A walk-in: today only. */
  onlyToday?: boolean;
  onFailure?: (message: string) => void;
}) {
  const today = clock.isoDate(new Date());
  const [weekStart, setWeekStart] = useState(today);
  const [counts, setCounts] = useState<Record<string, Slot[] | undefined>>({});
  const [day, setDay] = useState<string | null>(null);
  const week = useMemo(
    () => (onlyToday ? [today] : Array.from({ length: WEEK }, (_, n) => shift(weekStart, n))),
    [weekStart, onlyToday, today],
  );

  useEffect(() => {
    if (!clinicianId || !typeId) return;
    let live = true;
    const from = week[0] as string;
    const to = week[week.length - 1] as string;
    setCounts({});
    setDay(null);
    api<{ days: Record<string, Slot[]> }>(
      `/clinicians/${encodeURIComponent(clinicianId)}/slots?from=${from}&to=${to}&typeId=${encodeURIComponent(typeId)}`,
    )
      .then((found) => {
        if (!live) return;
        const next: Record<string, Slot[]> = {};
        for (const date of week) next[date] = date < today ? [] : (found.days[date] ?? []);
        setCounts(next);
        setDay(week.find((date) => (next[date] ?? []).length) ?? null);
      })
      .catch(() => live && onFailure?.("Free times could not be loaded. Check your connection and try again."));
    return () => {
      live = false;
    };
    // onFailure is a callback prop; the week is what decides a read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicianId, typeId, week, today, fresh]);

  const slots = day ? counts[day] : undefined;

  return (
    <>
      <div className="row-head">
        <p className="dialog-label">{dayLabel}</p>
        {!onlyToday && (
          <div className="week-nav">
            <button
              type="button"
              className="icon-button"
              aria-label="Previous week"
              disabled={weekStart <= today}
              onClick={() => setWeekStart((start) => (shift(start, -WEEK) < today ? today : shift(start, -WEEK)))}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Next week"
              onClick={() => setWeekStart((start) => shift(start, WEEK))}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
      <div className="days" role="radiogroup" aria-label="Day">
        {week.map((date) => {
          const free = counts[date];
          const on = date === day;
          return (
            <button
              key={date}
              type="button"
              role="radio"
              aria-checked={on}
              className={`day${on ? " day-on" : ""}${free && !free.length ? " day-closed" : ""}`}
              disabled={!free?.length}
              onClick={() => {
                setDay(date);
                onSlot(null);
              }}
            >
              <span className="day-name">{clock.weekday(`${date}T12:00:00Z`)}</span>
              <span className="day-number">{Number(date.slice(8))}</span>
              <span className="day-free">
                {free === undefined ? <LoadingIndicator size={12} label="Checking" /> : free.length ? `${free.length} free` : "None"}
              </span>
            </button>
          );
        })}
      </div>

      <p className="dialog-label">{timeLabel}</p>
      <div className="slots move-slots" role="radiogroup" aria-label="Time">
        {slots?.map((option) => {
          const on = option.startAt === slot?.startAt;
          return (
            <button
              key={option.startAt}
              type="button"
              role="radio"
              aria-checked={on}
              className={`slot${on ? " slot-on" : ""}`}
              onClick={() => onSlot(option)}
            >
              {clock.time(option.startAt)}
            </button>
          );
        })}
        {slots && !slots.length && <p className="empty">No times left on this day.</p>}
        {!slots && day && <LoadingIndicator size={24} label="Finding free times" />}
        {!day && counts[week[0] as string] !== undefined && (
          <p className="empty">{onlyToday ? "No free times left today." : "No free times this week. Try the next one."}</p>
        )}
      </div>
    </>
  );
}
