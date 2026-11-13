/**
 * Changing one's own details (2026-09-28, 2026-09-30): the name, the mobile,
 * and the date of birth, each through PATCH /me. Words follow the chosen
 * language (NFR-L10N-01). The email is
 * what the account signs in with, so it is shown and not changed here. A
 * verified mobile changes by one-time code, which comes with SMS
 * verification; until then only an unverified number can be corrected.
 *
 * Built from the platform's parts: the sign-in fields, the phone and birth
 * date fields of account completion, the picker and the M3 loading indicator.
 */

import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../api/client";
import { messageFor } from "../auth/errors";
import { type CountryCode, countryName, HOME_COUNTRY, isMobile, normalisePhone } from "../auth/phone";
import { useSession } from "../auth/session";
import { BirthDateField, birthDate } from "../components/BirthDateField";
import { Field, Notice } from "../components/controls";
import { User } from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { PhoneField } from "../components/PhoneField";

export type Editing = null | "name" | "phone" | "born";

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

/** A stored date as the language writes it (NFR-L10N-02): fr 02/04/1990, en and pcm 02 April 1990. */
export function shownDateIn(iso: string | null | undefined, language: string): string {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!found) return "";
  if (language === "fr") return shownDate(iso);
  const at = new Date(Date.UTC(Number(found[1]), Number(found[2]) - 1, Number(found[3])));
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "long", year: "numeric" }).format(at);
}

export function EditDetails({
  editing,
  onDone,
  audience,
}: {
  editing: Editing;
  onDone: (said: string | null) => void;
  audience?: "patient" | "staff";
}) {
  const { t } = useTranslation("account");
  const { state, refresh } = useSession();
  const aud = audience ?? (state.status === "signed-in" ? state.audience : "patient");
  const me = state.status === "signed-in" ? state.me : undefined;
  const [given, setGiven] = useState(me?.givenName ?? "");
  const [family, setFamily] = useState(me?.familyName ?? "");
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
      await refresh(aud);
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
      const msg = t(aud === "staff" ? "edit.savedNameStaff" : "edit.savedName");
      await run({ givenName: given.trim(), familyName: family.trim() }, msg);
    } else if (editing === "phone") {
      const number = normalisePhone(phone, country);
      if (!isMobile(number)) {
        setError(country === HOME_COUNTRY ? t("edit.phoneHome") : t("edit.phoneAbroad", { country: countryName(country) }));
        return;
      }
      const msg = t(aud === "staff" ? "edit.savedPhoneStaff" : "edit.savedPhone");
      await run({ phoneE164: number }, msg);
    } else {
      const date = birthDate(born);
      if (!date) {
        setError(t("edit.bornInvalid"));
        return;
      }
      await run({ dateOfBirth: date }, t("edit.savedBorn"));
    }
  }

  const ready =
    editing === "name"
      ? given.trim().length > 0 && family.trim().length > 0
      : editing === "phone"
        ? phone.trim().length > 0
        : born.trim().length > 0;

  return (
    <form className="inner-card settings-card edit-details" onSubmit={save} noValidate>
      {failure && <Notice tone="error">{failure}</Notice>}
      {editing === "name" && (
        <div className="edit-details-pair">
          <Field label={t("edit.given")} icon={User} value={given} onChange={(e) => setGiven(e.target.value)} autoComplete="given-name" />
          <Field label={t("edit.family")} icon={User} value={family} onChange={(e) => setFamily(e.target.value)} autoComplete="family-name" />
        </div>
      )}
      {editing === "phone" && (
        <PhoneField label={t("edit.phone")} value={phone} onChange={setPhone} country={country} onCountry={setCountry} error={error} />
      )}
      {editing === "born" && <BirthDateField label={t("edit.born")} value={born} onChange={setBorn} error={error} />}
      <div className="edit-details-actions">
        <button type="button" className="outline-button" disabled={busy} onClick={() => onDone(null)}>
          {t("edit.keep")}
        </button>
        <button type="submit" className="dock-button" disabled={!ready || busy} aria-busy={busy || undefined}>
          {busy && <LoadingIndicator size={20} label={t("edit.saving")} />}
          {busy ? t("edit.saving") : t("edit.save")}
        </button>
      </div>
    </form>
  );
}
