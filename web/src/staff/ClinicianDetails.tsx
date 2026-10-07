/**
 * Correct a clinician's professional details (2026-10-07): the specialty, the
 * year on the Order's roll, the Ordre number and the languages they consult
 * in. A typo made at creation or in an import ("General Practioner") was on
 * the directory for good. Only what changed is sent; patients see it at once.
 *
 * The name, mobile and unit are not here: the name and mobile are the
 * person's own (their account page), and the unit is fixed at creation.
 */

import { type FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { api } from "../api/client";
import { PACK } from "../auth/phone";
import { Field, Notice } from "../components/controls";
import { Close, Stethoscope } from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { sentence } from "./labels";

interface Details {
  staffId: string;
  specialty: string | null;
  registrationYear: number | null;
  ordreNumber: string | null;
  languages: string[];
}

const languageName = (code: string) => (code === "fr" ? "French" : code === "en" ? "English" : code);

export function ClinicianDetails({
  staffId,
  name,
  onClose,
  onDone,
}: {
  staffId: string;
  name: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [found, setFound] = useState<Details | null>(null);
  const [specialty, setSpecialty] = useState("");
  const [year, setYear] = useState("");
  const [ordre, setOrdre] = useState("");
  const [languages, setLanguages] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api<Details>(`/admin/staff/${encodeURIComponent(staffId)}/clinician`)
      .then((details) => {
        if (!live) return;
        setFound(details);
        setSpecialty(details.specialty ?? "");
        setYear(details.registrationYear ? String(details.registrationYear) : "");
        setOrdre(details.ordreNumber ?? "");
        setLanguages(details.languages);
      })
      .catch((error: unknown) => live && setFailure(sentence(error instanceof Error ? error.message : "The details could not be loaded.")));
    return () => {
      live = false;
    };
  }, [staffId]);

  const changes = (): Record<string, unknown> => {
    if (!found) return {};
    const out: Record<string, unknown> = {};
    if (specialty.trim() !== (found.specialty ?? "")) out.specialty = specialty.trim();
    if (Number(year) !== found.registrationYear) out.registrationYear = Number(year);
    if (ordre.trim() !== (found.ordreNumber ?? "")) out.ordreNumber = ordre.trim() || null;
    if ([...languages].sort().join() !== [...found.languages].sort().join()) out.languages = languages;
    return out;
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    const wrong: Record<string, string> = {};
    if (!specialty.trim()) wrong.specialty = "Enter their specialty.";
    const asNumber = Number(year);
    if (!(Number.isInteger(asNumber) && asNumber >= 1950 && asNumber <= new Date().getFullYear())) {
      wrong.registrationYear = "Enter the year they joined the Order's roll, such as 2012.";
    }
    if (!languages.length) wrong.languages = "Choose at least one language they consult in.";
    setErrors(wrong);
    if (Object.keys(wrong).length) return;
    const changed = changes();
    if (!Object.keys(changed).length) {
      onClose();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await api(`/admin/staff/${encodeURIComponent(staffId)}/clinician`, { method: "PATCH", json: changed });
      onDone(`${name}'s details are corrected.`);
    } catch (caught) {
      setFailure(`${sentence(caught instanceof Error ? caught.message : "The details could not be saved")} Nothing was changed.`);
      setBusy(false);
    }
  }

  return createPortal(
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div
        className="dialog staff-dialog move-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clinician-details-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="move-scroll">
          <button type="button" className="icon-button dialog-close" onClick={onClose} aria-label="Close" disabled={busy}>
            <Close size={16} />
          </button>
          <span className="dialog-icon accounts-dialog-icon" aria-hidden="true">
            <Stethoscope size={22} />
          </span>
          <h2 id="clinician-details-title">{name}'s clinician details</h2>
          <p className="dialog-lede">Patients see the change at once, and it is recorded against your account.</p>
          {!found ? (
            failure ? (
              <Notice tone="error">{failure}</Notice>
            ) : (
              <LoadingIndicator size={28} label="Loading the details" />
            )
          ) : (
            <form id="clinician-details-form" onSubmit={save} noValidate>
              <div className="sheet-grid clinician-fields">
                <Field
                  label="Specialty"
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                  error={errors.specialty}
                  autoComplete="off"
                />
                <Field
                  label="Year on the Order's roll"
                  inputMode="numeric"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  error={errors.registrationYear}
                  autoComplete="off"
                />
                <Field label="Ordre number" value={ordre} onChange={(e) => setOrdre(e.target.value)} autoComplete="off" />
                <div className="field">
                  <span className="field-label" id="clinician-details-languages">
                    Consults in
                  </span>
                  <div className="chips" role="group" aria-labelledby="clinician-details-languages">
                    {[...new Set([...(PACK.languages ?? ["fr", "en"]).map(String), ...found.languages])].map((code) => (
                      <button
                        key={code}
                        type="button"
                        aria-pressed={languages.includes(code)}
                        className={`chip-choice${languages.includes(code) ? " chip-on" : ""}`}
                        onClick={() => setLanguages((now) => (now.includes(code) ? now.filter((c) => c !== code) : [...now, code]))}
                      >
                        {languageName(code)}
                      </button>
                    ))}
                  </div>
                  {errors.languages && <p className="field-error">{errors.languages}</p>}
                </div>
              </div>
              {failure && <Notice tone="error">{failure}</Notice>}
            </form>
          )}
        </div>
        <div className="dialog-actions move-actions">
          <button type="button" className="outline-button keep" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            form="clinician-details-form"
            className="staff-primary"
            disabled={busy || !found}
            aria-busy={busy || undefined}
          >
            {busy ? <LoadingIndicator size={20} label="Saving" /> : null}
            {busy ? "Saving" : "Save details"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
