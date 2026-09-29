/**
 * The questions a visit asks before it (FR-BKG-15), and the patient's consent
 * to share the answers with their clinician (AD-06).
 *
 * Each field is drawn in the platform's own controls: text and long text as
 * inputs, a choice and a yes or no as segmented buttons, a number as a
 * numeric input. Only questions marked needed have to be answered; the rest
 * can be left. The consent box is required to send anything at all, and says
 * exactly who reads the answers.
 */

import { useId } from "react";

import type { IntakeAnswers, IntakeForm } from "../patient/data";
import { Checkbox } from "./controls";

/** The first needed question left unanswered, if any. */
export function missingAnswer(form: IntakeForm, answers: IntakeAnswers): string | null {
  const field = form.fields.find((f) => f.required && (answers[f.id] === undefined || answers[f.id] === ""));
  return field ? field.label : null;
}

/** Only what was answered, so an empty field is not sent as an answer. */
export function answered(answers: IntakeAnswers): IntakeAnswers {
  return Object.fromEntries(Object.entries(answers).filter(([, v]) => v !== "" && v !== undefined && v !== null));
}

export function IntakeFields({
  form,
  answers,
  onChange,
  consent,
  onConsent,
  clinician,
}: {
  form: IntakeForm;
  answers: IntakeAnswers;
  onChange: (answers: IntakeAnswers) => void;
  consent: boolean;
  onConsent: (consent: boolean) => void;
  /** Who reads the answers, by name where known. */
  clinician: string;
}) {
  const id = useId();
  const set = (field: string, value: string | number | boolean | undefined) => {
    const next = { ...answers };
    if (value === undefined || value === "") delete next[field];
    else next[field] = value;
    onChange(next);
  };
  return (
    <div className="intake">
      {form.fields.map((field, i) => {
        const fieldId = `${id}-${field.id}`;
        const value = answers[field.id];
        return (
          <div key={field.id} className="intake-field" style={{ ["--i" as string]: i }}>
            <label className="intake-label" htmlFor={fieldId}>
              {field.label}
              {field.required ? <span className="intake-needed"> needed</span> : <span className="intake-optional"> optional</span>}
            </label>
            {field.hint && <p className="intake-hint">{field.hint}</p>}
            {field.kind === "longText" && (
              <textarea
                id={fieldId}
                className="dialog-text intake-text"
                maxLength={field.max ?? 1000}
                value={typeof value === "string" ? value : ""}
                onChange={(e) => set(field.id, e.target.value)}
              />
            )}
            {field.kind === "text" && (
              <div className="input intake-input">
                <input
                  id={fieldId}
                  maxLength={field.max ?? 160}
                  value={typeof value === "string" ? value : ""}
                  onChange={(e) => set(field.id, e.target.value)}
                />
              </div>
            )}
            {field.kind === "number" && (
              <div className="input intake-input intake-number">
                <input
                  id={fieldId}
                  inputMode="numeric"
                  value={typeof value === "number" ? String(value) : ""}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
                    set(field.id, digits ? Number(digits) : undefined);
                  }}
                />
                {field.min !== undefined && field.max !== undefined && (
                  <span className="intake-range">
                    {field.min} to {field.max}
                  </span>
                )}
              </div>
            )}
            {(field.kind === "choice" || field.kind === "yesNo") && (
              <div className="segmented intake-choices" role="radiogroup" aria-labelledby={fieldId} id={fieldId}>
                {(field.kind === "yesNo"
                  ? [
                      { id: "yes", label: "Yes", value: true },
                      { id: "no", label: "No", value: false },
                    ]
                  : (field.options ?? []).map((o) => ({ ...o, value: o.id }))
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={value === option.value}
                    className={`segment${value === option.value ? " segment-on" : ""}`}
                    onClick={() => set(field.id, value === option.value ? undefined : option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="intake-consent">
        <Checkbox checked={consent} onChange={onConsent}>
          Share these answers with {clinician} only. The front desk and the hospital's administrators cannot read them, and they are
          deleted 90 days after the visit.
        </Checkbox>
      </div>
    </div>
  );
}
