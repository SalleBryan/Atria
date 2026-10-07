/**
 * A date of birth, typed or picked (feedback 2026-09-29).
 *
 * Typing is digits only: the slashes go in by themselves as the day and the
 * month are complete, so "02041990" reads 02/04/1990 and a backspace over a
 * slash takes the digit before it. The calendar button opens a month in the
 * platform's own look (Pickers.tsx), whose heading chooses the month and the
 * year directly, since a month grid is no way to reach 1958 one month at a time.
 * The value handed out is what is shown, DD/MM/YYYY; birthDate() reads it.
 */

import { type CSSProperties, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useMenu } from "./FilterMenu";
import { Calendar, ChevronLeft, ChevronRight } from "./icons";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEK_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/** Digits as DD/MM/YYYY, the slashes placed as each part completes. */
export function maskBirthDate(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)];
  if (digits.length > 4) return `${parts[0]}/${parts[1]}/${parts[2]}`;
  if (digits.length > 2) return `${parts[0]}/${parts[1]}${digits.length === 4 ? "/" : ""}`;
  return digits.length === 2 ? `${digits}/` : digits;
}

/** DD/MM/YYYY as yyyy-mm-dd, or null when it is not a real past date. */
export function birthDate(text: string, today: Date = new Date()): string | null {
  const found = /^\s*(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{4})\s*$/.exec(text);
  if (!found) return null;
  const [day, month, year] = [Number(found[1]), Number(found[2]), Number(found[3])];
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (year < 1900 || date.getTime() > today.getTime()) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const two = (n: number) => String(n).padStart(2, "0");

export function BirthDateField({
  label,
  value,
  onChange,
  error,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"days" | "months" | "years">("days");
  const today = new Date();
  const chosen = birthDate(value);
  // The month shown: the chosen date's, or thirty years back as a starting point.
  const [shown, setShown] = useState({ year: today.getUTCFullYear() - 30, month: 0 });
  const close = useCallback(() => setOpen(false), []);
  const { place } = useMenu({ open, onClose: close, anchor: button, panel, width: 312, align: "end", roomNeeded: 360 });

  useEffect(() => {
    if (!error || !box.current) return;
    box.current.classList.remove("input-nudge");
    void box.current.offsetWidth;
    box.current.classList.add("input-nudge");
  }, [error]);

  const type = (raw: string) => {
    // A backspace over an automatic slash takes the digit before it too.
    const deleting = raw.length < value.length && value.endsWith("/") && !raw.endsWith("/");
    onChange(maskBirthDate(deleting ? raw.slice(0, -1) : raw));
  };

  const openPicker = () => {
    if (chosen) setShown({ year: Number(chosen.slice(0, 4)), month: Number(chosen.slice(5, 7)) - 1 });
    setView(chosen ? "days" : "years");
    setOpen((was) => !was);
  };

  const first = new Date(Date.UTC(shown.year, shown.month, 1, 12));
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(shown.year, shown.month + 1, 0)).getUTCDate();
  const shift = (by: number) => {
    const next = new Date(Date.UTC(shown.year, shown.month + by, 1, 12));
    setShown({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
  };
  const thisYear = today.getUTCFullYear();
  const future = (y: number, m: number, d = 1) => Date.UTC(y, m, d) > today.getTime();
  const described = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div ref={box} className={`input${error ? " input-invalid" : ""}`}>
        <span className="input-icon">
          <Calendar size={17} />
        </span>
        <input
          id={id}
          inputMode="numeric"
          autoComplete="bday"
          placeholder="DD/MM/YYYY"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          onChange={(event) => type(event.target.value)}
        />
        <button
          ref={button}
          type="button"
          className="input-reveal birth-pick"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Choose the date on a calendar"
          onClick={openPicker}
        >
          <Calendar size={17} />
        </button>
      </div>
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {open &&
        createPortal(
          <div className="menu-layer">
            <div className="menu-scrim menu-scrim-clear" onClick={close} aria-hidden="true" />
            <div ref={panel} className="suggest date-picker birth-picker" role="dialog" aria-label={label} style={place}>
              <div className="date-picker-head">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={view === "years" ? "Earlier years" : "Previous month"}
                  onClick={() => (view === "years" ? setShown((s) => ({ ...s, year: s.year - 20 })) : shift(-1))}
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="birth-heading">
                  <button
                    type="button"
                    className={`birth-switch${view === "months" ? " birth-switch-on" : ""}`}
                    onClick={() => setView(view === "months" ? "days" : "months")}
                  >
                    {MONTHS[shown.month]}
                  </button>
                  <button
                    type="button"
                    className={`birth-switch${view === "years" ? " birth-switch-on" : ""}`}
                    onClick={() => setView(view === "years" ? "days" : "years")}
                  >
                    {shown.year}
                  </button>
                </span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={view === "years" ? "Later years" : "Next month"}
                  disabled={view === "years" ? shown.year + 20 > thisYear : future(shown.year, shown.month + 1)}
                  onClick={() => (view === "years" ? setShown((s) => ({ ...s, year: Math.min(thisYear, s.year + 20) })) : shift(1))}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              {view === "years" && (
                <div className="birth-grid" role="listbox" aria-label="Year">
                  {Array.from({ length: 20 }, (_, n) => shown.year - 15 + n)
                    .filter((y) => y <= thisYear && y >= 1900)
                    .map((y, i) => (
                      <button
                        key={y}
                        type="button"
                        role="option"
                        aria-selected={y === shown.year}
                        className={`date-picker-day${y === shown.year ? " date-picker-on" : ""}`}
                        style={{ "--i": i } as CSSProperties}
                        onClick={() => {
                          setShown((s) => ({ year: y, month: future(y, s.month) ? today.getUTCMonth() : s.month }));
                          setView("months");
                        }}
                      >
                        {y}
                      </button>
                    ))}
                </div>
              )}
              {view === "months" && (
                <div className="birth-grid" role="listbox" aria-label="Month">
                  {MONTHS.map((name, m) => (
                    <button
                      key={name}
                      type="button"
                      role="option"
                      aria-selected={m === shown.month}
                      disabled={future(shown.year, m)}
                      className={`date-picker-day${m === shown.month ? " date-picker-on" : ""}`}
                      onClick={() => {
                        setShown((s) => ({ ...s, month: m }));
                        setView("days");
                      }}
                    >
                      {name.slice(0, 3)}
                    </button>
                  ))}
                </div>
              )}
              {view === "days" && (
                <div className="date-picker-grid" role="grid">
                  {WEEK_LETTERS.map((letter, i) => (
                    <span key={`h-${i}`} className="date-picker-weekday" aria-hidden="true">
                      {letter}
                    </span>
                  ))}
                  {Array.from({ length: lead }, (_, i) => (
                    <span key={`e-${i}`} />
                  ))}
                  {Array.from({ length: days }, (_, n) => {
                    const iso = `${shown.year}-${two(shown.month + 1)}-${two(n + 1)}`;
                    const on = iso === chosen;
                    return (
                      <button
                        key={iso}
                        type="button"
                        className={`date-picker-day${on ? " date-picker-on" : ""}`}
                        aria-pressed={on}
                        disabled={future(shown.year, shown.month, n + 1)}
                        onClick={() => {
                          onChange(`${two(n + 1)}/${two(shown.month + 1)}/${shown.year}`);
                          close();
                        }}
                      >
                        {n + 1}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
