/**
 * Filters: the few most popular options inline, the rest in a menu.
 *
 * A row of filter chips shows "All", then as many of the most popular options
 * as fit on one line (four at most), then "More". Never a second line: the
 * moment the options would wrap, the ones that do not fit move into the menu
 * (feedback 2026-09-27), on every screen and at every window size. The filter button and "More"
 * open the same menu, which holds every option of every filter. On a desktop
 * or tablet the menu drops down from the button; on a phone it rises as a
 * sheet from the bottom edge (feedback 2026-09-25).
 *
 * The menu is drawn in a layer of its own on <body>, zoomed by the same --fit
 * as the screens (src/layout/fit.ts), so a glass panel or a scrolling list
 * never clips it and it is always the size of the chips that opened it.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Close, Filter } from "./icons";

export type FilterOption = {
  id: string;
  label: string;
  /** How many results the option leaves, shown beside it in the menu. */
  count?: number;
  /** A class for a colour dot before the label, as the week's clinicians have. */
  dot?: string;
};

export type FilterSection = {
  id: string;
  label: string;
  /** Most popular first. */
  options: FilterOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  allLabel?: string;
};

/** Options ordered by how many results each has, then by name. */
export function byPopularity<T>(items: readonly T[], keyOf: (item: T) => string | null | undefined): FilterOption[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b)).map(([id, count]) => ({ id, label: id, count }));
}

const MAX_INLINE = 4;

/** Whether chips of these widths, in order, wrap into at most `lines` lines of `room`. */
export function packs(widths: readonly number[], room: number, gap: number, lines: number): boolean {
  let used = 1;
  let x = 0;
  for (const width of widths) {
    const next = x === 0 ? width : x + gap + width;
    if (next <= room) {
      x = next;
      continue;
    }
    used += 1;
    if (used > lines || width > room) return false;
    x = width;
  }
  return true;
}

/**
 * The inline row. Every candidate is also drawn in an invisible copy of the
 * row that never wraps, and that copy is what gets measured, so a chip that is
 * hidden now can come back when the window widens.
 */
export function ChipRow({
  label,
  options,
  value,
  onChange,
  allLabel = "All",
  allDot,
  onMore,
  moreActive = 0,
  variant = "chip",
  className = "",
  trailing,
  moreRef,
  moreAlways = false,
}: {
  label: string;
  options: FilterOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  allLabel?: string;
  allDot?: string;
  /** Opens the menu. Without it, "More" is not offered. */
  onMore?: () => void;
  /** How many filters are set in the menu but not visible in the row. */
  moreActive?: number;
  variant?: "chip" | "week";
  className?: string;
  trailing?: ReactNode;
  /** The "More" chip, for a menu to hang from when there is no filter button. */
  moreRef?: RefObject<HTMLButtonElement | null>;
  /** Offer "More" even when every option fits, because the menu holds other filters too. */
  moreAlways?: boolean;
}) {
  const row = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const candidates = options.slice(0, MAX_INLINE);
  const [fits, setFits] = useState(candidates.length);
  const lines = 1;

  const measure = useCallback(() => {
    const box = row.current;
    const copy = ruler.current;
    if (!box || !copy) return;
    // Nothing laid out (a test, or a row not shown yet): offer every candidate.
    if (!box.clientWidth) {
      setFits(Math.min(options.length, MAX_INLINE));
      return;
    }
    const chips = [...copy.children] as HTMLElement[];
    const gap = parseFloat(getComputedStyle(copy).columnGap) || 8;
    const trail = box.querySelector<HTMLElement>("[data-trailing]");
    // The copy holds All, the candidates, then More.
    const widths = chips.map((chip) => chip.offsetWidth);
    const all = widths[0] ?? 0;
    const more = widths[widths.length - 1] ?? 0;
    const each = widths.slice(1, -1);
    const style = getComputedStyle(box);
    const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const room = box.clientWidth - padding - (trail ? trail.offsetWidth + gap : 0);
    const everyOne = options.length <= each.length;
    if (!moreAlways && everyOne && packs([all, ...each], room, gap, lines)) {
      setFits(each.length);
      return;
    }
    let count = each.length;
    while (count > 0 && !packs([all, ...each.slice(0, count), ...(onMore ? [more] : [])], room, gap, lines)) count -= 1;
    setFits(count);
  }, [onMore, moreAlways, options.length]);

  useLayoutEffect(measure, [measure, options, value]);
  useEffect(() => {
    const box = row.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(box);
    return () => observer.disconnect();
  }, [measure]);

  // The chosen option is always visible: it takes the last place if it would not otherwise be shown.
  let shown = candidates.slice(0, fits);
  const chosen = options.find((o) => o.id === value);
  if (chosen && !shown.includes(chosen)) shown = [...shown.slice(0, Math.max(0, fits - 1)), chosen];
  const hidden = options.length - shown.length;

  const chipClass = variant === "week" ? "week-chip" : "chip-choice";
  const onClass = variant === "week" ? " week-chip-on" : " chip-on";
  const chip = (option: FilterOption | null, key: string, live: boolean) => {
    const on = (option?.id ?? null) === value;
    const dot = option ? option.dot : allDot;
    return (
      <button
        key={key}
        type="button"
        role={live ? "radio" : undefined}
        aria-checked={live ? on : undefined}
        tabIndex={live ? undefined : -1}
        className={`${chipClass}${on ? onClass : ""}`}
        onClick={live ? () => onChange(option?.id ?? null) : undefined}
      >
        {dot && <span className={`week-dot ${dot}`} aria-hidden="true" />}
        {option?.label ?? allLabel}
      </button>
    );
  };
  const moreChip = (live: boolean) => (
    <button
      key="more"
      ref={live ? moreRef : undefined}
      type="button"
      className={`${chipClass} chip-more${moreActive ? onClass : ""}`}
      tabIndex={live ? undefined : -1}
      aria-haspopup={live ? "dialog" : undefined}
      onClick={live ? onMore : undefined}
    >
      <Filter size={14} />
      {hidden > 0 ? `${hidden} more` : "Filters"}
      {moreActive > 0 && <span className="chip-count">{moreActive}</span>}
    </button>
  );

  return (
    <div ref={row} className={`chip-row ${variant === "week" ? "week-filters" : "chips"}} ${className}`}>
      <div className="chip-row-live" role="radiogroup" aria-label={label}>
        {chip(null, "all", true)}
        {shown.map((option) => chip(option, option.id, true))}
      </div>
      {onMore && (moreAlways || hidden > 0 || moreActive > 0) && moreChip(true)}
      {trailing && <span data-trailing="">{trailing}</span>}
      <div className="chip-row-ruler" aria-hidden="true" inert>
        <div ref={ruler} className="chip-row-ruler-line">
          {chip(null, "all", false)}
          {candidates.map((option) => chip(option, option.id, false))}
          {moreChip(false)}
        </div>
      </div>
    </div>
  );
}

/**
 * What every anchored menu needs: where to draw it under (or, short of room,
 * over) its button, in the zoomed canvas's units; which console's colours to
 * wear, since it is drawn on <body>; focus moved in on opening and handed
 * back on closing; and Escape to close.
 */
export function useMenu({
  open,
  onClose,
  anchor,
  panel,
  width,
  align,
  roomNeeded = 240,
}: {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement | null>;
  panel: RefObject<HTMLElement | null>;
  width: number;
  /** Line up the menu's start (left) or end (right) edge with the button's. */
  align: "start" | "end";
  /** Below this much room under the button, the menu opens above it. */
  roomNeeded?: number;
}): { place: CSSProperties; admin: boolean } {
  const [place, setPlace] = useState<CSSProperties>({});
  const [admin, setAdmin] = useState(false);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const fit = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fit")) || 1;
    const box = anchor.current.getBoundingClientRect();
    const canvasWidth = window.innerWidth / fit;
    const canvasHeight = window.innerHeight / fit;
    const edge = align === "end" ? box.right / fit - width : box.left / fit;
    const left = Math.max(16, Math.min(edge, canvasWidth - width - 16));
    const below = canvasHeight - box.bottom / fit - 26;
    if (below >= roomNeeded || below >= box.top / fit) {
      const top = box.bottom / fit + 10;
      setPlace({ left, top, width, maxHeight: below, transformOrigin: `top ${align === "end" ? "right" : "left"}` });
    } else {
      const bottom = canvasHeight - box.top / fit + 10;
      setPlace({ left, bottom, width, maxHeight: box.top / fit - 26, transformOrigin: `bottom ${align === "end" ? "right" : "left"}` });
    }
    setAdmin(Boolean(anchor.current.closest(".admin-app")));
  }, [open, anchor, width, align, roomNeeded]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    (panel.current?.querySelector<HTMLElement>("[aria-checked='true']") ?? panel.current?.querySelector<HTMLElement>("button"))?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onClose, panel]);

  return { place, admin };
}

/** The menu, anchored under `anchor` (or a sheet on a phone). */
export function FilterMenu({
  open,
  onClose,
  anchor,
  title,
  sections,
  results,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement | null>;
  title: string;
  sections: FilterSection[];
  /** The button that closes the menu, such as "Show 4 clinicians". */
  results: string;
  onClear: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const { place, admin } = useMenu({ open, onClose, anchor, panel, width: 380, align: "end" });

  if (!open) return null;
  const set = sections.filter((s) => s.value !== null).length;
  return createPortal(
    <div className={`menu-layer${admin ? " menu-admin" : ""}`}>
      <div className="menu-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={panel} className="filter-menu" role="dialog" aria-modal="true" aria-label={title} style={place}>
        <div className="filter-menu-head">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close filters">
            <Close size={16} />
          </button>
        </div>
        <div className="filter-menu-body">
          {sections.map((section) => (
            <fieldset key={section.id} className="filter-section">
              <legend>{section.label}</legend>
              <div className="filter-options" role="radiogroup" aria-label={section.label}>
                {[null, ...section.options].map((option, i) => {
                  const on = (option?.id ?? null) === section.value;
                  return (
                    <button
                      key={option?.id ?? "all"}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={`filter-option${on ? " filter-option-on" : ""}`}
                      style={{ "--i": i } as CSSProperties}
                      onClick={() => section.onChange(option?.id ?? null)}
                    >
                      {option?.dot && <span className={`week-dot ${option.dot}`} aria-hidden="true" />}
                      <span className="filter-option-label">{option?.label ?? section.allLabel ?? "All"}</span>
                      {option?.count !== undefined && <span className="filter-option-count">{option.count}</span>}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
        <div className="filter-menu-foot">
          <button type="button" className="link-button" onClick={onClear} disabled={!set}>
            Clear all
          </button>
          <button type="button" className="button button-primary filter-menu-done" onClick={onClose}>
            {results}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
