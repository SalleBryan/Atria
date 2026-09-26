/**
 * Long lists are paged, never scrolled without end (feedback 2026-09-25).
 *
 * A page is as many rows as the list's box holds, measured, so the list does
 * not scroll and the pager under it is always in view. On a phone, where the
 * page itself scrolls, a page is a fixed length instead. The box keeps
 * `overflow-y: auto`, so that if even the shortest page cannot fit (a very
 * short window), the rows scroll rather than spill out.
 */

import { type RefObject, useEffect, useLayoutEffect, useState } from "react";

import { useTier } from "../layout/fit";
import { ChevronLeft, ChevronRight } from "./icons";

/** A page's length on a phone, and wherever nothing is laid out to measure (a test). */
export const PHONE_PAGE = 10;

/**
 * How many rows the box holds. `row` finds a row to measure; until one is
 * there, `pitch` (a row's height plus the gap under it) stands in.
 */
export function useRowsThatFit(
  box: RefObject<HTMLElement | null>,
  { row, pitch, gap = 8, least = 2 }: { row: string; pitch: number; gap?: number; least?: number },
): number {
  const phone = useTier() === "mobile";
  const [size, setSize] = useState(PHONE_PAGE);
  // The box often mounts after the first render (once the list has loaded),
  // so follow the ref to whatever element it holds now.
  const [element, setElement] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (box.current !== element) setElement(box.current);
  });

  useLayoutEffect(() => {
    if (phone || !element) {
      setSize(PHONE_PAGE);
      return;
    }
    const measure = () => {
      if (!element.clientHeight) {
        setSize(PHONE_PAGE);
        return;
      }
      const style = getComputedStyle(element);
      const room = element.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
      const one = element.querySelector<HTMLElement>(row);
      const step = one ? one.offsetHeight + gap : pitch;
      setSize(Math.max(least, Math.floor((room + gap) / step)));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, phone, row, pitch, gap, least]);

  return size;
}

/**
 * One page of a list held in full on the client. `reset` names what the list
 * is (a search, a filter, a day): when it changes the pages start again.
 */
export function usePages<T>(items: readonly T[], size: number, reset: string) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [reset, size]);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const at = Math.min(page, pages - 1);
  const shown = items.slice(at * size, at * size + size);
  return {
    shown,
    page: at,
    pages,
    first: items.length ? at * size + 1 : 0,
    last: at * size + shown.length,
    total: items.length,
    previous: () => setPage((p) => Math.max(0, p - 1)),
    next: () => setPage((p) => Math.min(pages - 1, p + 1)),
    /** Turn to the page holding the item at this index, such as the one selected. */
    reveal: (index: number) => {
      if (index >= 0) setPage(Math.floor(index / size));
    },
  };
}

export function Pager({
  first,
  last,
  total,
  page,
  pages,
  onPrevious,
  onNext,
  busy = false,
  hasNext,
  note,
  noun = "visits",
}: {
  first: number;
  last: number;
  total: number;
  page: number;
  pages: number;
  onPrevious: () => void;
  onNext: () => void;
  busy?: boolean;
  /** For a list paged by the server, which knows whether more follow. */
  hasNext?: boolean;
  note?: string;
  noun?: string;
}) {
  const more = hasNext ?? page < pages - 1;
  return (
    <div className="pager">
      <span className="pager-count" aria-live="polite">
        {busy && !total ? "Loading" : total ? `${first} to ${last} of ${total}` : `No ${noun} to show`}
        {note && <span className="pager-note"> · {note}</span>}
      </span>
      {pages > 1 && (
        <span className="pager-pages">
          <span className="pager-of">
            Page {page + 1} of {pages}
          </span>
          <button type="button" className="square-button" aria-label="Previous page" disabled={page === 0 || busy} onClick={onPrevious}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" className="square-button" aria-label="Next page" disabled={!more || busy} onClick={onNext}>
            <ChevronRight size={16} />
          </button>
        </span>
      )}
    </div>
  );
}
