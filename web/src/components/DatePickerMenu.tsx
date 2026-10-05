/**
 * Smooth calendar picker menu for navigating days, weeks, months, or years.
 *
 * Provides a popover with 3-mode browsing:
 * - Days: full calendar month grid with weekday headers
 * - Months: 12-month selector
 * - Years: 20-year grid with decade paging (< / >)
 *
 * Allows jumping across years smoothly without tedious day-by-day navigation.
 */

import { type CSSProperties, useCallback, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useMenu } from "./FilterMenu";
import { Calendar, ChevronLeft, ChevronRight } from "./icons";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEK_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

const two = (n: number) => String(n).padStart(2, "0");

export interface DatePickerMenuProps {
  /** Selected ISO date (YYYY-MM-DD). */
  value?: string | null;
  /** Callback when a date is picked (YYYY-MM-DD). */
  onChange: (dateIso: string) => void;
  /** Accessible label. */
  label?: string;
  /** Optional minimum allowable date (YYYY-MM-DD). */
  minDate?: string;
  /** Optional maximum allowable date (YYYY-MM-DD). */
  maxDate?: string;
  /** Alignment of the popover menu ("start" | "end"). Default "start". */
  align?: "start" | "end";
  /** Custom class for the trigger button. */
  buttonClass?: string;
  /** Whether to render as an icon-only square button. Default true. */
  compact?: boolean;
  /** Optional text to display alongside calendar icon on the trigger button. */
  buttonLabel?: string;
}

export function DatePickerMenu({
  value,
  onChange,
  label = "Choose date",
  minDate,
  maxDate,
  align = "start",
  buttonClass = "square-button",
  compact = true,
  buttonLabel,
}: DatePickerMenuProps) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"days" | "months" | "years">("days");

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const selectedIso = value || todayIso;

  const parsedYear = Number(selectedIso.slice(0, 4)) || today.getUTCFullYear();
  const parsedMonth = Number(selectedIso.slice(5, 7)) - 1 || today.getUTCMonth();

  const [shown, setShown] = useState({ year: parsedYear, month: parsedMonth });

  const close = useCallback(() => {
    setOpen(false);
    setView("days");
  }, []);

  const { place } = useMenu({
    open,
    onClose: close,
    anchor: button,
    panel,
    width: 312,
    align,
    roomNeeded: 380,
  });

  const toggle = () => {
    if (!open) {
      const y = Number(selectedIso.slice(0, 4)) || today.getUTCFullYear();
      const m = (Number(selectedIso.slice(5, 7)) || 1) - 1;
      setShown({ year: y, month: m });
      setView("days");
    }
    setOpen((prev) => !prev);
  };

  const shift = (by: number) => {
    const next = new Date(Date.UTC(shown.year, shown.month + by, 1, 12));
    setShown({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
  };

  const shiftYears = (delta: number) => {
    setShown((curr) => ({ ...curr, year: curr.year + delta }));
  };

  const first = new Date(Date.UTC(shown.year, shown.month, 1, 12));
  const lead = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(shown.year, shown.month + 1, 0)).getUTCDate();

  const isOutOfRange = (iso: string) => {
    if (minDate && iso < minDate) return true;
    if (maxDate && iso > maxDate) return true;
    return false;
  };

  return (
    <div className="date-picker-menu-wrap" style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={button}
        id={id}
        type="button"
        className={buttonClass}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={toggle}
      >
        <Calendar size={16} />
        {!compact && buttonLabel && <span>{buttonLabel}</span>}
      </button>

      {open &&
        createPortal(
          <div className="menu-layer">
            <div className="menu-scrim menu-scrim-clear" onClick={close} aria-hidden="true" />
            <div
              ref={panel}
              className="suggest date-picker birth-picker"
              role="dialog"
              aria-label={label}
              style={place}
            >
              <div className="date-picker-head">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={view === "years" ? "Earlier 20 years" : view === "months" ? "Previous year" : "Previous month"}
                  onClick={() => {
                    if (view === "years") shiftYears(-20);
                    else if (view === "months") shiftYears(-1);
                    else shift(-1);
                  }}
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
                  aria-label={view === "years" ? "Later 20 years" : view === "months" ? "Next year" : "Next month"}
                  onClick={() => {
                    if (view === "years") shiftYears(20);
                    else if (view === "months") shiftYears(1);
                    else shift(1);
                  }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              {view === "years" && (
                <div className="birth-grid" role="listbox" aria-label="Choose Year">
                  {Array.from({ length: 20 }, (_, n) => shown.year - 10 + n).map((y, i) => {
                    const isSelected = y === (Number(selectedIso.slice(0, 4)) || today.getUTCFullYear());
                    return (
                      <button
                        key={y}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className={`date-picker-day${isSelected ? " date-picker-on" : ""}`}
                        style={{ "--i": i } as CSSProperties}
                        onClick={() => {
                          setShown((curr) => ({ ...curr, year: y }));
                          setView("months");
                        }}
                      >
                        {y}
                      </button>
                    );
                  })}
                </div>
              )}

              {view === "months" && (
                <div className="birth-grid" role="listbox" aria-label="Choose Month">
                  {MONTHS.map((name, m) => {
                    const isSelected =
                      shown.year === (Number(selectedIso.slice(0, 4)) || today.getUTCFullYear()) &&
                      m === (Number(selectedIso.slice(5, 7)) || 1) - 1;
                    return (
                      <button
                        key={name}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className={`date-picker-day${isSelected ? " date-picker-on" : ""}`}
                        onClick={() => {
                          setShown((curr) => ({ ...curr, month: m }));
                          setView("days");
                        }}
                      >
                        {name.slice(0, 3)}
                      </button>
                    );
                  })}
                </div>
              )}

              {view === "days" && (
                <>
                  <div className="date-picker-grid" role="grid">
                    {WEEK_LETTERS.map((letter, i) => (
                      <span key={`h-${i}`} className="date-picker-weekday" aria-hidden="true">
                        {letter}
                      </span>
                    ))}
                    {Array.from({ length: lead }, (_, i) => (
                      <span key={`e-${i}`} />
                    ))}
                    {Array.from({ length: daysInMonth }, (_, n) => {
                      const dayIso = `${shown.year}-${two(shown.month + 1)}-${two(n + 1)}`;
                      const isSelected = dayIso === selectedIso;
                      const disabled = isOutOfRange(dayIso);
                      return (
                        <button
                          key={dayIso}
                          type="button"
                          className={`date-picker-day${isSelected ? " date-picker-on" : ""}`}
                          aria-pressed={isSelected}
                          disabled={disabled}
                          onClick={() => {
                            onChange(dayIso);
                            close();
                          }}
                        >
                          {n + 1}
                        </button>
                      );
                    })}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "8px 12px 4px",
                      borderTop: "1px solid var(--line-hairline, #e1e7f0)",
                      marginTop: 4,
                    }}
                  >
                    <button
                      type="button"
                      className="today-button"
                      style={{ fontSize: 12, padding: "2px 10px" }}
                      onClick={() => {
                        onChange(todayIso);
                        close();
                      }}
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      className="today-button"
                      style={{ fontSize: 12, padding: "2px 10px", color: "var(--ink-muted)" }}
                      onClick={close}
                    >
                      Close
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
