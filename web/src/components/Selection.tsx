/**
 * Choosing rows of a paged list to act on together (2026-09-30): a box on
 * each row that may be acted on, one in the header that takes every such row
 * on the page shown, and a bar saying how many are chosen with what can be
 * done to them. The choice is the page's own: moving to another page, or
 * searching, starts again, so nothing unseen is ever included.
 *
 * The boxes are the platform's checkbox (controls.tsx) without a label of
 * their own; the row's name is their accessible name.
 */

import { type ReactNode, useEffect, useMemo, useState } from "react";

import { CheckMark, Close, Trash, Undo } from "./icons";

export function useSelection(selectable: string[], resetKey: unknown) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  // Another page, search or filter: nothing carries over.
  useEffect(() => setChosen(new Set()), [resetKey]);
  const key = selectable.join("|");
  // A row that left the page (deleted, filtered away) is no longer chosen.
  useEffect(() => setChosen((c) => new Set([...c].filter((id) => selectable.includes(id)))), [key]);

  return useMemo(() => {
    const all = selectable.length > 0 && selectable.every((id) => chosen.has(id));
    return {
      chosen,
      count: chosen.size,
      all,
      some: chosen.size > 0 && !all,
      has: (id: string) => chosen.has(id),
      toggle: (id: string) =>
        setChosen((c) => {
          const next = new Set(c);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      toggleAll: () => setChosen(all ? new Set() : new Set(selectable)),
      clear: () => setChosen(new Set()),
    };
  }, [chosen, selectable]);
}

/** One row's box, or the header's (then [mixed] when only some are chosen). */
export function SelectBox({
  checked,
  mixed = false,
  label,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  mixed?: boolean;
  label: string;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <label className={`checkbox select-box${mixed ? " select-box-mixed" : ""}${disabled ? " checkbox-off" : ""}`}>
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        ref={(el) => {
          if (el) el.indeterminate = mixed;
        }}
        onChange={onChange}
      />
      <span className="checkbox-box" aria-hidden="true">
        {mixed ? <span className="select-box-dash" /> : <CheckMark size={13} />}
      </span>
    </label>
  );
}

/** "3 selected", with Delete, Restore and Clear; shown only while something is chosen. */
export function SelectionBar({
  count,
  noun,
  onDelete,
  onRestore,
  onClear,
  children,
}: {
  count: number;
  noun: [string, string];
  onDelete?: () => void;
  onRestore?: () => void;
  onClear: () => void;
  /** A page's own batch action, before Restore and Delete. */
  children?: ReactNode;
}) {
  if (!count) return null;
  return (
    <div className="selection-bar" role="region" aria-label="Selected">
      <span className="selection-count" aria-live="polite">
        {count} {count === 1 ? noun[0] : noun[1]} selected
      </span>
      {children}
      {onRestore && (
        <button type="button" className="selection-restore" onClick={onRestore}>
          <Undo size={15} />
          Restore
        </button>
      )}
      {onDelete && (
        <button type="button" className="selection-delete" onClick={onDelete}>
          <Trash size={15} />
          Delete
        </button>
      )}
      <button type="button" className="square-button" aria-label="Clear the selection" title="Clear" onClick={onClear}>
        <Close size={15} />
      </button>
    </div>
  );
}

/**
 * Runs [one] for each id in turn, and says what happened. A batch fails only
 * when nothing went through; otherwise it reports what could not be done.
 */
export async function forEach(ids: string[], one: (id: string) => Promise<unknown>): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await one(id);
      done += 1;
    } catch {
      failed += 1;
    }
  }
  if (!done && failed) throw new Error(failed === 1 ? "That could not be deleted." : "None of those could be deleted.");
  return { done, failed };
}
