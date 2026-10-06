/**
 * Long lists are paged, never scrolled without end (feedback 2026-09-25), but
 * only past 50 rows, so a batch selection reaches a whole page of them
 * (feedback 2026-10-06). The list's box keeps `overflow-y: auto`, so a page
 * taller than the box scrolls inside it and the pager stays in view.
 */

import { useEffect, useState } from "react";

import { ChevronLeft, ChevronRight } from "./icons";

/** A page's length everywhere: past this many rows, a list turns pages. */
export const PAGE_ROWS = 50;

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
        {busy && !total ? "" : total ? `${first} to ${last} of ${total}` : `No ${noun} to show`}
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
