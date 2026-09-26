/**
 * A search field that guesses as you type (feedback 2026-09-25).
 *
 * Each search bar says which categories it searches (clinicians,
 * specialties, clinics, roles...) and what picking a suggestion does. As
 * the person types, every category is matched and the best few of each are
 * offered under the field, grouped and labelled, before they finish the word.
 *
 * Matching forgives what people actually type: case and accents are ignored,
 * any word of a name can be the one they start with ("mbar" finds Esther
 * Mbarga), and from four letters on one slip is allowed ("cardoilogy" still
 * finds Cardiology). Closer matches rank first.
 *
 * The list is a combobox (WAI-ARIA 1.2): arrows move through it, Enter picks,
 * Escape closes it and keeps what was typed. Like the filter menu it is drawn
 * in its own layer on <body>, zoomed by --fit, so no panel clips it.
 */

import {
  type ComponentType,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Search } from "./icons";

export type Suggestion = {
  id: string;
  label: string;
  /** A second line, such as a specialty under a clinician's name. */
  hint?: string;
  /** What is matched, where the label carries more, such as a name without its "Dr". */
  match?: string;
  /** Other words the suggestion answers to, such as a clinic's town. */
  also?: string[];
  onPick: () => void;
};

export type SuggestionGroup = {
  id: string;
  label: string;
  icon?: ComponentType<{ size?: number }>;
  items: Suggestion[];
};

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** One slip allowed: whether `a` and `b` differ by at most one edit. */
function nearly(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      // A swap of two neighbouring letters counts as the one slip.
      if (a[i + 1] === b[j] && a[i] === b[j + 1]) {
        i += 2;
        j += 2;
        continue;
      }
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * How well `query` matches `text`, higher is better, 0 for no match.
 *
 *   4  the whole text starts with it
 *   3  a word of the text starts with it
 *   2  it appears inside the text
 *   1  a word starts with it but for one slip (four letters or more)
 *
 * A query of several words matches when every word does, scored by the weakest.
 */
export function rank(text: string, query: string): number {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const haystack = fold(text);
  const parts = haystack.split(/[^a-z0-9+@.]+/).filter(Boolean);
  let worst = 4;
  for (const word of words) {
    let best = 0;
    if (haystack.startsWith(word)) best = 4;
    else if (parts.some((p) => p.startsWith(word))) best = 3;
    else if (haystack.includes(word)) best = 2;
    else if (word.length >= 4 && parts.some((p) => nearly(p.slice(0, word.length), word) || nearly(p, word))) best = 1;
    if (!best) return 0;
    worst = Math.min(worst, best);
  }
  return worst;
}

/** The best matches of each group, most likely first, empty groups left out. */
export function suggest(groups: SuggestionGroup[], query: string, perGroup = 4): SuggestionGroup[] {
  if (!query.trim()) return [];
  return groups
    .map((group) => ({
      ...group,
      items: group.items
        .map((item) => ({
          item,
          score: Math.max(rank(item.match ?? item.label, query), ...(item.also ?? []).map((a) => rank(a, query) - 0.5)),
        }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
        .slice(0, perGroup)
        .map(({ item }) => item),
    }))
    .filter((group) => group.items.length);
}

/** The typed part of a label in bold, where it can be found. */
function Marked({ text, query }: { text: string; query: string }) {
  const word = fold(query).trim().split(/\s+/)[0] ?? "";
  const at = word ? fold(text).indexOf(word) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + word.length)}</mark>
      {text.slice(at + word.length)}
    </>
  );
}

export function SearchSuggest({
  value,
  onChange,
  groups,
  placeholder,
  label,
  onSubmit,
  className = "find-search",
  trailing,
  form = false,
}: {
  value: string;
  onChange: (value: string) => void;
  groups: SuggestionGroup[];
  placeholder: string;
  label: string;
  /** Enter with nothing highlighted. */
  onSubmit?: (value: string) => void;
  className?: string;
  /** Drawn inside the field after the input, such as a filter button. */
  trailing?: ReactNode;
  /** A <form role="search"> rather than a <div>, for a search that goes somewhere. */
  form?: boolean;
}) {
  const box = useRef<HTMLElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<CSSProperties>({});
  // The list is drawn on <body>, so it is told which console's colours to wear.
  const [admin, setAdmin] = useState(false);

  const shown = open ? suggest(groups, value) : [];
  const flat = shown.flatMap((g) => g.items);

  useEffect(() => setActive(-1), [value]);

  useLayoutEffect(() => {
    if (!shown.length || !box.current) return;
    const fit = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fit")) || 1;
    const rect = box.current.getBoundingClientRect();
    const top = rect.bottom / fit + 8;
    setPlace({
      left: rect.left / fit,
      top,
      width: rect.width / fit,
      maxHeight: window.innerHeight / fit - top - 16,
    });
    setAdmin(Boolean(box.current.closest(".admin-app")));
  }, [shown.length, value]);

  const pick = (item: Suggestion) => {
    setOpen(false);
    item.onPick();
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && flat.length) {
      event.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % flat.length);
    } else if (event.key === "ArrowUp" && flat.length) {
      event.preventDefault();
      setActive((a) => (a <= 0 ? flat.length - 1 : a - 1));
    } else if (event.key === "Enter") {
      const chosen = flat[active];
      if (chosen) {
        event.preventDefault();
        pick(chosen);
      } else if (!form && onSubmit) {
        event.preventDefault();
        setOpen(false);
        onSubmit(value);
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setOpen(false);
    onSubmit?.(value);
  };

  const field = (
    <>
      <Search size={18} />
      <input
        ref={input}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={shown.length > 0}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKey}
      />
      {trailing}
    </>
  );

  let index = -1;
  return (
    <>
      {form ? (
        <form ref={(node) => void (box.current = node)} className={className} role="search" onSubmit={submit}>
          {field}
        </form>
      ) : (
        <div ref={(node) => void (box.current = node)} className={className}>
          {field}
        </div>
      )}
      {shown.length > 0 &&
        createPortal(
          <div className={`menu-layer menu-layer-passive${admin ? " menu-admin" : ""}`}>
            <div className="suggest" id={listId} role="listbox" aria-label={`${label} suggestions`} style={place}>
              {shown.map((group) => (
                <div key={group.id} className="suggest-group" role="group" aria-label={group.label}>
                  <p className="suggest-label" aria-hidden="true">
                    {group.label}
                  </p>
                  {group.items.map((item) => {
                    index += 1;
                    const i = index;
                    const Icon = group.icon;
                    return (
                      <div
                        key={item.id}
                        id={`${listId}-${i}`}
                        role="option"
                        aria-selected={i === active}
                        className={`suggest-item${i === active ? " suggest-item-on" : ""}`}
                        style={{ "--i": i } as CSSProperties}
                        // Keep the focus in the field, so picking does not blur it first.
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => pick(item)}
                      >
                        {Icon && (
                          <span className="suggest-icon" aria-hidden="true">
                            <Icon size={15} />
                          </span>
                        )}
                        <span className="suggest-text">
                          <span className="suggest-main">
                            <Marked text={item.label} query={value} />
                          </span>
                          {item.hint && <span className="suggest-hint">{item.hint}</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
