/**
 * Finishing a patient account (2026-09-29). Google gives Atria a name and an
 * email and nothing more, and the email sign-up has no date of birth, so
 * GET /me names what the record still lacks: the mobile reminders go to, the
 * date of birth the guardian rules need, and the agreement to the terms. The
 * patient app shows this before anything else until they are given, at the
 * end of a Google sign-up and at every later sign-in.
 *
 * The mobile is kept unverified; verifying it by code comes with SMS.
 */

import { type FormEvent, useState } from "react";

import { api, type Me } from "../api/client";
import { messageFor } from "../auth/errors";
import { type CountryCode, countryName, HOME_COUNTRY, isMobile, normalisePhone } from "../auth/phone";
import { useSession } from "../auth/session";
import { AuthLayout, PatientBrand } from "../components/AuthLayout";
import { Button, Checkbox, Field, Notice } from "../components/controls";
import { Calendar } from "../components/icons";
import { PhoneField } from "../components/PhoneField";
import { SignOutMenu } from "../components/SignOutMenu";
import { PATIENT_FOOTER } from "./PatientSignIn";

type Errors = Partial<Record<"phone" | "born" | "terms", string>>;

/** "02/04/1990" or "2/4/1990" as 1990-04-02; null when it is not a real past date. */
export function birthDate(text: string): string | null {
  const found = /^\s*(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{4})\s*$/.exec(text);
  if (!found) return null;
  const [day, month, year] = [Number(found[1]), Number(found[2]), Number(found[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (year < 1900 || date.getTime() > Date.now()) return null;
  return date.toISOString().slice(0, 10);
}

export function CompleteProfile({ me }: { me: Me }) {
  const { refresh } = useSession();
  const missing = me.missing ?? [];
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState<CountryCode>(HOME_COUNTRY);
  const [born, setBorn] = useState("");
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found: Errors = {};
    const number = normalisePhone(phone, country);
    const date = birthDate(born);
    if (missing.includes("phone") && !isMobile(number)) {
      found.phone =
        country === HOME_COUNTRY
          ? "Enter a Cameroonian mobile number, such as 6 70 00 00 00."
          : `Enter a mobile number that works in ${countryName(country)}.`;
    }
    if (missing.includes("dateOfBirth") && !date) found.born = "Enter your date of birth as day, month and year, such as 02/04/1990.";
    if (missing.includes("terms") && !terms) found.terms = "Agree to the terms to use Atria.";
    setErrors(found);
    if (Object.keys(found).length) return;

    setBusy(true);
    setFailure(null);
    try {
      await api("/me", {
        method: "PATCH",
        json: {
          ...(missing.includes("phone") ? { phoneE164: number } : {}),
          ...(missing.includes("dateOfBirth") ? { dateOfBirth: date } : {}),
          ...(missing.includes("terms") ? { acceptTerms: true } : {}),
        },
      });
      await refresh("patient");
    } catch (caught) {
      setFailure(messageFor(caught));
      setBusy(false);
    }
  }

  const name = me.givenName ? `, ${me.givenName}` : "";
  return (
    <AuthLayout product="PATIENT ACCOUNT" brandKey="patient" brand={<PatientBrand />} footer={PATIENT_FOOTER}>
      <h1 className="title">Finish your account{name}.</h1>
      <p className="lede">
        {missing.includes("phone")
          ? "Your reminders come by text, so we need your mobile. "
          : ""}
        {missing.includes("dateOfBirth") ? "Your date of birth decides which visits you can book for yourself." : ""}
        {!missing.includes("phone") && !missing.includes("dateOfBirth") ? "One last step before you book." : ""}
      </p>
      <form className="form-card" onSubmit={submit} noValidate>
        {failure && <Notice tone="error">{failure}</Notice>}
        {missing.includes("phone") && (
          <PhoneField label="Mobile number" value={phone} onChange={setPhone} country={country} onCountry={setCountry} error={errors.phone} />
        )}
        {missing.includes("dateOfBirth") && (
          <Field
            label="Date of birth"
            icon={Calendar}
            inputMode="numeric"
            autoComplete="bday"
            placeholder="DD/MM/YYYY"
            value={born}
            onChange={(event) => setBorn(event.target.value)}
            error={errors.born}
          />
        )}
        {missing.includes("terms") && (
          <>
            <Checkbox checked={terms} onChange={setTerms}>
              I agree to the Atria terms and privacy notice.
            </Checkbox>
            {errors.terms && <p className="field-error">{errors.terms}</p>}
          </>
        )}
        <Button type="submit" busy={busy} disabled={busy}>
          Continue
        </Button>
      </form>
      <p className="legal">
        Not you?{" "}
        <SignOutMenu className="link link-button">Sign out</SignOutMenu>
      </p>
    </AuthLayout>
  );
}
