/**
 * A mobile number field with its country (feedback 2026-09-25, 2026-09-29).
 *
 * The flag and the country's dial code stand in front of the input, so the
 * person types only their own number, 670000000 or 6 70 00 00 00, and it is
 * grouped as they type. The flag button opens a searchable list of countries;
 * picking one changes the code in front and keeps the number. A number typed
 * or pasted with its code (+44..., 0044...) switches the flag to that country
 * and the code comes off the input. The value handed out is the national
 * number; normalisePhone(value, country) gives the stored E.164. The flags
 * load only when a phone field is on the screen.
 */

import { type ComponentType, type CSSProperties, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { type CountryCode, countries, countryName, dialCode, HOME_COUNTRY, nationalInput } from "../auth/phone";
import { useMenu } from "./FilterMenu";
import { Close, Search } from "./icons";

type Flags = Record<string, ComponentType<{ title?: string; className?: string }>>;
let flagSet: Flags | null = null;

function useFlags(): Flags | null {
  const [flags, setFlags] = useState<Flags | null>(flagSet);
  useEffect(() => {
    if (flagSet) return;
    let live = true;
    void import("country-flag-icons/react/3x2").then((module) => {
      flagSet = module as unknown as Flags;
      if (live) setFlags(flagSet);
    });
    return () => {
      live = false;
    };
  }, []);
  return flags;
}

function Flag({ flags, country }: { flags: Flags | null; country: CountryCode }) {
  const Shape = flags?.[country];
  return <span className="flag">{Shape ? <Shape /> : null}</span>;
}

export function PhoneField({
  label,
  value,
  onChange,
  country,
  onCountry,
  error,
  hint,
  placeholder = "6 70 00 00 00",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  country: CountryCode;
  onCountry: (country: CountryCode) => void;
  error?: string;
  hint?: string;
  placeholder?: string;
}) {
  const id = useId();
  const flags = useFlags();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const close = () => {
    setOpen(false);
    setSearch("");
  };
  const { place } = useMenu({ open, onClose: close, anchor: button, panel, width: 320, align: "start", roomNeeded: 300 });

  const all = useMemo(() => countries(), []);
  const words = search.trim().toLowerCase().replace(/^\+/, "");
  const shown = words
    ? all.filter((c) => c.name.toLowerCase().includes(words) || c.dial.slice(1).startsWith(words) || c.code.toLowerCase() === words)
    : all;

  // A stored number (+237...) opens as its national part.
  const shownValue = nationalInput(value, country).text;
  const type = (raw: string) => {
    const read = nationalInput(raw, country);
    if (read.country !== country) onCountry(read.country);
    onChange(read.text);
  };
  const pick = (next: CountryCode) => {
    onCountry(next);
    onChange(nationalInput(shownValue, next).text);
    close();
    window.setTimeout(() => input.current?.focus(), 0);
  };

  const described = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className={`input phone-input${error ? " input-invalid" : ""}`}>
        <button
          ref={button}
          type="button"
          className="phone-country"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Country: ${countryName(country)}. Change`}
          onClick={() => setOpen((shown) => !shown)}
        >
          <Flag flags={flags} country={country} />
          <svg className="phone-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="m2 3.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="phone-dial" id={`${id}-dial`}>
          {dialCode(country)}
        </span>
        <input
          ref={input}
          id={id}
          type="tel"
          autoComplete="tel-national"
          inputMode="tel"
          placeholder={country === HOME_COUNTRY ? placeholder : ""}
          value={shownValue}
          aria-invalid={error ? true : undefined}
          aria-describedby={[`${id}-dial`, described].filter(Boolean).join(" ")}
          onChange={(event) => type(event.target.value)}
        />
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
            <div ref={panel} className="filter-menu country-menu" role="dialog" aria-label="Choose a country" style={place}>
              <div className="filter-menu-head">
                <h2>Country</h2>
                <button type="button" className="icon-button" onClick={close} aria-label="Close">
                  <Close size={16} />
                </button>
              </div>
              <div className="find-search country-search">
                <Search size={16} />
                <input
                  aria-label="Search countries"
                  placeholder="Country or code"
                  value={search}
                  autoFocus
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && shown[0]) {
                      event.preventDefault();
                      pick(shown[0].code);
                    }
                  }}
                />
              </div>
              <ul className="country-list" role="listbox" aria-label="Countries">
                {shown.map((c, i) => (
                  <li key={c.code} role="option" aria-selected={c.code === country}>
                    <button
                      type="button"
                      className={`country-item${c.code === country ? " country-item-on" : ""}`}
                      style={{ "--i": Math.min(i, 12) } as CSSProperties}
                      onClick={() => pick(c.code)}
                    >
                      <Flag flags={flags} country={c.code} />
                      <span className="country-name">{c.name}</span>
                      <span className="country-dial">{c.dial}</span>
                    </button>
                  </li>
                ))}
                {!shown.length && <li className="empty">No country matches.</li>}
              </ul>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
