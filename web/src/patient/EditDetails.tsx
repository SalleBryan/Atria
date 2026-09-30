/**
 * Changing one's own details (2026-09-28, 2026-09-30): the name, the mobile,
 * the date of birth and the language, each through PATCH /me. The email is
 * what the account signs in with, so it is shown and not changed here. A
 * verified mobile changes by one-time code, which comes with SMS
 * verification; until then only an unverified number can be corrected.
 *
 * Built from the platform's parts: the sign-in fields, the phone and birth
 * date fields of account completion, the picker and the M3 loading indicator.
 */

import { type FormEvent, useState } from "react";

import { api } from "../api/client";
import { messageFor } from "../auth/errors";
import { type CountryCode, countryName, HOME_COUNTRY, isMobile, normalisePhone } from "../auth/phone";
import { useSession } from "../auth/session";
import { BirthDateField, birthDate } from "../components/BirthDateField";
import { Field, Notice } from "../components/controls";
import { User } from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { PhoneField } from "../components/PhoneField";
import { SelectMenu } from "../components/Pickers";
import { languageName } from "./data";

export type Editing = null | "name" | "language" | "phone" | "born";

/** "+237670000142" as "6 70 00 01 42", for the field beside its flag. */
export function localMobile(e164: string | null | undefined): string {
  const cm = /^\+237(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(e164 ?? "");
  return cm ? cm.slice(1).join(" ") : (e164 ?? "");
}

/** "1990-04-02" as "02/04/1990", as the birth date field shows it. */
export function shownDate(iso: string | null | undefined): string {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return found ? `${found[3]}/${found[2]}/${found[1]}` : "";
}

export function EditDetails({ editing, onDone }: { editing: Editing; onDone: (said: string | null) => void }) {
  const { state, refresh } = useSession();
  const me = state.status === "signed-in" ? state.me : undefined;
  const [given, setGiven] = useState(me?.givenName ?? "");
  const [family, setFamily] = useState(me?.familyName ?? "");
  const [language, setLanguage] = useState(me?.languages?.[0] ?? "en");
  const [phone, setPhone] = useState(localMobile(me?.phoneE164));
  const [country, setCountry] = useState<CountryCode>(HOME_COUNTRY);
  const [born, setBorn] = useState(shownDate(me?.dateOfBirth));
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (!me || !editing) return null;

  async function run(body: Record<string, unknown>, said: string) {
    setBusy(true);
    setFailure(null);
    try {
      await api("/me", { method: "PATCH", json: body });
      await refresh("patient");
      onDone(said);
    } catch (caught) {
      setFailure(messageFor(caught));
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    if (editing === "name") {
      await run({ givenName: given.trim(), familyName: family.trim() }, "Your name is saved. The front desk sees it too.");
    } else if (editing === "language") {
      await run({ preferredLanguage: language }, `Messages will come in ${languageName(language)}.`);
    } else if (editing === "phone") {
      const number = normalisePhone(phone, country);
      if (!isMobile(number)) {
        setError(
          country === HOME_COUNTRY
            ? "Enter a Cameroonian mobile number, such as 6 70 00 00 00."
            : `Enter a mobile number that works in ${countryName(country)}.`,
        );
        return;
      }
      await run({ phoneE164: number }, "Your mobile is saved. Reminders are texted there from now on.");
    } else {
      const date = birthDate(born);
      if (!date) {
        setError("Enter your date of birth as day, month and year, such as 02/04/1990.");
        return;
      }
      await run({ dateOfBirth: date }, "Your date of birth is saved.");
    }
  }

  const ready =
    editing === "name"
      ? given.trim().length > 0 && family.trim().length > 0
      : editing === "language"
        ? true
        : editing === "phone"
          ? phone.trim().length > 0
          : born.trim().length > 0;

  return (
    <form className="inner-card settings-card edit-details" onSubmit={save} noValidate>
      {failure && <Notice tone="error">{failure}</Notice>}
      {editing === "name" && (
        <div className="edit-details-pair">
          <Field label="Given name" icon={User} value={given} onChange={(e) => setGiven(e.target.value)} autoComplete="given-name" />
          <Field label="Family name" icon={User} value={family} onChange={(e) => setFamily(e.target.value)} autoComplete="family-name" />
        </div>
      )}
      {editing === "language" && (
        <div className="field">
          <span className="field-label">Language</span>
          <SelectMenu
            label="Language"
            value={language}
            width={260}
            options={["en", "fr"].map((code) => ({ id: code, label: languageName(code) }))}
            onChange={setLanguage}
          />
        </div>
      )}
      {editing === "phone" && (
        <PhoneField label="Mobile number" value={phone} onChange={setPhone} country={country} onCountry={setCountry} error={error} />
      )}
      {editing === "born" && <BirthDateField label="Date of birth" value={born} onChange={setBorn} error={error} />}
      <div className="edit-details-actions">
        <button type="button" className="outline-button" disabled={busy} onClick={() => onDone(null)}>
          Keep as it was
        </button>
        <button type="submit" className="dock-button" disabled={!ready || busy} aria-busy={busy || undefined}>
          {busy && <LoadingIndicator size={20} label="Saving" />}
          {busy ? "Saving" : "Save"}
        </button>
      </div>
    </form>
  );
}
