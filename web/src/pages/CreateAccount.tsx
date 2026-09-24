/**
 * "Desktop · Create account" (FR-ACC-01).
 *
 * Two differences from the Rev A frame, both forced by the model rather than
 * taste. The frame's single "Full name" field is two here, given and family
 * name side by side in the same row, because the person record keeps them
 * apart and splitting a typed name reliably is not possible. And the frame's
 * date of birth is left for profile completion (POST /me/profile, Phase 2):
 * the user pool has nowhere to hold it, and asking for it now would collect a
 * value nothing stores.
 */

import { signInWithRedirect, signUp } from "aws-amplify/auth";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { configureFor } from "../auth/config";
import { errorName, messageFor } from "../auth/errors";
import { MIN_LENGTH, passwordRules } from "../auth/passwordRules";
import { isMobile, normalisePhone } from "../auth/phone";
import { AuthLayout, PatientBrand } from "../components/AuthLayout";
import { Button, Checkbox, Divider, Field, Notice } from "../components/controls";
import { Lock, Mail, Phone, User } from "../components/icons";
import { PatientModeSwitch } from "./PatientModeSwitch";
import { PATIENT_FOOTER } from "./PatientSignIn";

type Errors = Partial<Record<"givenName" | "familyName" | "email" | "phone" | "password" | "terms", string>>;

export function CreateAccount() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ givenName: "", familyName: "", email: "", phone: "", password: "" });
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<"form" | "google" | null>(null);

  useEffect(() => configureFor("patient"), []);

  const set = (name: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [name]: event.target.value }));

  function validate(): Errors {
    const found: Errors = {};
    if (!form.givenName.trim()) found.givenName = "Enter your given name.";
    if (!form.familyName.trim()) found.familyName = "Enter your family name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) found.email = "Enter an email address like you@example.com.";
    if (!isMobile(normalisePhone(form.phone))) found.phone = "Enter a Cameroonian mobile number, such as 6 70 00 00 00.";
    const unmet = passwordRules(form.password).filter((rule) => !rule.met);
    if (!form.password) found.password = "Choose a password.";
    else if (unmet.length) found.password = `The password needs: ${unmet.map((rule) => rule.label.toLowerCase()).join(", ")}.`;
    if (!terms) found.terms = "Agree to the terms to create an account.";
    return found;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      // After React has marked the fields, move to the first one to fix.
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    const email = form.email.trim();
    setBusy("form");
    try {
      await signUp({
        username: email,
        password: form.password,
        options: {
          // Signs the patient straight in once the emailed code is accepted.
          autoSignIn: true,
          userAttributes: {
            email,
            phone_number: normalisePhone(form.phone),
            given_name: form.givenName.trim(),
            family_name: form.familyName.trim(),
          },
        },
      });
      navigate("/verify-email", { state: { email } });
    } catch (caught) {
      if (errorName(caught) === "UsernameExistsException") setErrors({ email: messageFor(caught) });
      else setFailure(messageFor(caught));
    } finally {
      setBusy(null);
    }
  }

  async function google() {
    setBusy("google");
    try {
      await signInWithRedirect({ provider: "Google" });
    } catch (caught) {
      setFailure(messageFor(caught));
      setBusy(null);
    }
  }

  return (
    <AuthLayout product="PATIENT ACCOUNT" brandKey="patient" brand={<PatientBrand />} footer={PATIENT_FOOTER}>
      <PatientModeSwitch />
      <h1 className="title">Create your Atria account.</h1>
      <p className="lede">A few details and you are done.</p>
      <form className="form-card" onSubmit={submit} noValidate>
        {failure && <Notice tone="error">{failure}</Notice>}
        <div className="field-row">
          <Field
            label="Given name"
            icon={User}
            autoComplete="given-name"
            placeholder="Amina"
            value={form.givenName}
            onChange={set("givenName")}
            error={errors.givenName}
          />
          <Field
            label="Family name"
            autoComplete="family-name"
            placeholder="Ngo"
            value={form.familyName}
            onChange={set("familyName")}
            error={errors.familyName}
          />
        </div>
        <Field
          label="Email address"
          icon={Mail}
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={form.email}
          onChange={set("email")}
          error={errors.email}
        />
        <Field
          label="Mobile number"
          icon={Phone}
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="+237 6 70 00 00 00"
          value={form.phone}
          onChange={set("phone")}
          error={errors.phone}
        />
        <Field
          label="Password"
          icon={Lock}
          type="password"
          autoComplete="new-password"
          placeholder={`At least ${MIN_LENGTH} characters`}
          revealable
          value={form.password}
          onChange={set("password")}
          error={errors.password}
        />
        <Checkbox checked={terms} onChange={setTerms}>
          I agree to the Atria terms and privacy notice.
        </Checkbox>
        {errors.terms && <p className="field-error">{errors.terms}</p>}
        <Button type="submit" busy={busy === "form"} disabled={busy !== null}>
          Create account
        </Button>
        <Divider>OR</Divider>
        <Button variant="secondary" busy={busy === "google"} disabled={busy !== null} onClick={google}>
          <span className="google-mark" aria-hidden="true">
            G
          </span>
          Continue with Google
        </Button>
      </form>
      <p className="legal">By creating an account you agree to the Atria terms and the clinic's privacy notice.</p>
    </AuthLayout>
  );
}
