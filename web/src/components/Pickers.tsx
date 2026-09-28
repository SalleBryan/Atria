/**
 * Choosing one value from a list, and choosing a date, in the platform's own
 * look rather than the browser's (feedback 2026-09-27).
 *
 * The field is the sign-in pages' input (.input), compact; the list is the
 * suggestion panel search uses (.suggest), with the chosen row tinted as a
 * suggestion is; the date picker's days are Find care's day chips in a month
 * grid. All drawn in the zoomed menu layer (useMenu), so a scrolling card or
 * a dialog never clips them, and all close on Escape or a tap outside.
 */

import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { clock } from "../patient/data";
import { useMenu } from "./FilterMenu";
import { Calendar, ChevronLeft, ChevronRight, Search } from "./icons";

export interface PickerOption {
  id: string;
  label: string;
  hint?: string;
  /** Something before the label, such as initials. */
  lead?: ReactNode;
}

function Chevron() {
  return (
    <svg className="picker-chevron" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A field that opens a list of choices under it. */
export function SelectMenu({
  label,
  value,
  options,
  onChange,
  icon,
  disabled = false,
  width = 260,
  className = "",
  placeholder = "Choose",
  searchable = false,
}: {
  label: string;
  value: string | null;
  options: PickerOption[];
  onChange: (id: string) => void;
  icon?: ReactNode;
  disabled?: boolean;
  width?: number;
  className?: string;
  /** What an empty picker says. */
  placeholder?: string;
  /** A search box over the list, for long lists such as every clinician. */
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  // The menu takes focus as it opens; a searchable one hands it to the box.
  useEffect(() => {
    if (!open || !searchable) return;
    const frame = requestAnimationFrame(() => search.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, searchable]);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);
  const { place, admin } = useMenu({ open, onClose: close, anchor: button, panel, width, align: "start", roomNeeded: searchable ? 300 : 220 });
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length
    ? options.filter((o) => words.every((w) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(w)))
    : options;
  const chosen = options.find((o) => o.id === value);

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`picker-field ${className}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${chosen?.label ?? "none"}`}
        disabled={disabled}
        onClick={() => setOpen((shown) => !shown)}
      >
        {chosen?.lead ?? icon}
        <span className={`picker-value${chosen ? "" : " picker-empty"}`}>{chosen?.label ?? placeholder}</span>
        <Chevron />
      </button>
      {open &&
        createPortal(
          <div className={`menu-layer${admin ? " menu-admin" : ""}`}>
            <div className="menu-scrim menu-scrim-clear" onClick={close} aria-hidden="true" />
            <div ref={panel} className={`suggest picker-list${searchable ? " picker-searchable" : ""}`} role="listbox" aria-label={label} style={place}>
              {searchable && (
                <div className="picker-search">
                  <Search size={15} />
                  <input
                    type="search"
                    aria-label={`Search ${label.toLowerCase()}`}
                    placeholder="Search"
                    ref={search}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && shown[0]) {
                        event.preventDefault();
                        onChange(shown[0].id);
                        close();
                      }
                    }}
                  />
                </div>
              )}
              {searchable && !shown.length && <p className="picker-none">Nothing matches "{query.trim()}".</p>}
              {shown.map((option, i) => {
                const on = option.id === value;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={on}
                    aria-checked={on}
                    className={`suggest-item choice-item${on ? " suggest-item-on" : ""}`}
                    style={{ "--i": i } as CSSProperties}
                    onClick={() => {
                      onChange(option.id);
                      close();
                    }}
                  >
                    {option.lead}
                    <span className="suggest-text">
                      <span className="suggest-main">{option.label}</span>
                      {option.hint && <span className="suggest-hint">{option.hint}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** Times on the half hour, which every grid the platform allows divides. */
export function halfHours(from = 6, to = 22): PickerOption[] {
  const times: PickerOption[] = [];
  for (let minutes = from * 60; minutes <= to * 60; minutes += 30) {
    const text = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    times.push({ id: text, label: text });
  }
  return times;
}

const WEEK_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

function noon(date: string) {
  return new Date(`${date}T12:00:00Z`);
}

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** A field that opens a month to choose a date from, never before `min`. */
export function DatePicker({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: string;
  min: string;
  onChange: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(value.slice(0, 7));
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const { place, admin } = useMenu({ open, onClose: close, anchor: button, panel, width: 300, align: "start", roomNeeded: 320 });

  const first = noon(`${month}-01`);
  // Monday first, as the rest of the platform counts weekdays.
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, n) => `${month}-${String(n + 1).padStart(2, "0")}`)];
  const shift = (by: number) => setMonth(iso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + by, 1, 12))).slice(0, 7));

  return (
    <>
      <button
        ref={button}
        type="button"
        className="picker-field"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${clock.long(noon(value))}`}
        onClick={() => {
          setMonth(value.slice(0, 7));
          setOpen((shown) => !shown);
        }}
      >
        <Calendar size={15} />
        <span className="picker-value">{clock.day(noon(value))}</span>
        <Chevron />
      </button>
      {open &&
        createPortal(
          <div className={`menu-layer${admin ? " menu-admin" : ""}`}>
            <div className="menu-scrim menu-scrim-clear" onClick={close} aria-hidden="true" />
            <div ref={panel} className="suggest date-picker" role="dialog" aria-label={label} style={place}>
              <div className="date-picker-head">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Previous month"
                  disabled={month <= min.slice(0, 7)}
                  onClick={() => shift(-1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>{new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(first)}</span>
                <button type="button" className="icon-button" aria-label="Next month" onClick={() => shift(1)}>
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="date-picker-grid" role="grid">
                {WEEK_LETTERS.map((letter, i) => (
                  <span key={`h-${i}`} className="date-picker-weekday" aria-hidden="true">
                    {letter}
                  </span>
                ))}
                {cells.map((date, i) =>
                  date ? (
                    <button
                      key={date}
                      type="button"
                      className={`date-picker-day${date === value ? " date-picker-on" : ""}${date === iso(new Date(Date.now())) ? " date-picker-today" : ""}`}
                      disabled={date < min}
                      aria-pressed={date === value}
                      aria-label={clock.long(noon(date))}
                      onClick={() => {
                        onChange(date);
                        close();
                      }}
                    >
                      {Number(date.slice(8))}
                    </button>
                  ) : (
                    <span key={`e-${i}`} />
                  ),
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
