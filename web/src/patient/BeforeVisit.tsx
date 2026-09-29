/**
 * "Before your visit": the questions a visit asks and the patient's answers,
 * on the visit (FR-BKG-15). Only the patient and their clinician read them;
 * the card says so, and lets the patient add or change them until the visit
 * starts.
 */

import { useCallback, useEffect, useState } from "react";

import { api } from "../api/client";
import { IntakeDialog } from "../components/IntakeDialog";
import { Lock } from "../components/icons";
import { LoadingPane } from "../components/LoadingPane";
import type { CareContext, IntakeAnswers, IntakeForm } from "./data";

/** An answer as a person reads it, against the question it answered. */
export function answerText(form: IntakeForm, fieldId: string, value: unknown): string {
  const field = form.fields.find((f) => f.id === fieldId);
  if (field?.kind === "yesNo") return value ? "Yes" : "No";
  if (field?.kind === "choice") return field.options?.find((o) => o.id === value)?.label ?? String(value);
  return String(value);
}

export function AnswerList({ form, answers }: { form: IntakeForm; answers: IntakeAnswers }) {
  const shown = form.fields.filter((f) => answers[f.id] !== undefined);
  if (!shown.length) return <p className="empty">No answers given.</p>;
  return (
    <dl className="intake-answers">
      {shown.map((field) => (
        <div key={field.id}>
          <dt>{field.label}</dt>
          <dd>{answerText(form, field.id, answers[field.id])}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BeforeVisit({ appointmentId, clinician }: { appointmentId: string; clinician: string }) {
  const [care, setCare] = useState<CareContext | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      setCare(await api<CareContext>(`/appointments/${appointmentId}/care-context`));
    } catch {
      setFailed(true);
    }
  }, [appointmentId]);

  useEffect(() => {
    setCare(null);
    setFailed(false);
    void load();
  }, [load]);

  if (failed) return null;
  if (!care) {
    return (
      <section className="panel inner-card before-visit" aria-label="Before your visit">
        <LoadingPane label="Loading your answers" />
      </section>
    );
  }
  if (!care.form) return null;
  const answered = care.answers && Object.keys(care.answers).length > 0;

  return (
    <section className="panel inner-card before-visit" aria-labelledby="before-title">
      <div className="panel-head">
        <h3 id="before-title">Before your visit</h3>
        {care.editable && (
          <button type="button" className="link" onClick={() => setEditing(true)}>
            {answered ? "Change answers" : "Add answers"}
          </button>
        )}
      </div>
      {answered && care.answers ? (
        <AnswerList form={care.form} answers={care.answers} />
      ) : (
        <p className="empty">
          {care.editable
            ? `${clinician} asks a few questions before the visit. Answering helps the visit start where it should.`
            : "No answers were given for this visit."}
        </p>
      )}
      <p className="before-private">
        <Lock size={13} />
        Only you and {clinician} can read these. Deleted 90 days after the visit.
      </p>
      {editing && (
        <IntakeDialog
          form={care.form}
          clinician={clinician}
          initial={care.answers}
          mode="edit"
          onClose={() => setEditing(false)}
          onSubmit={async (answers) => {
            setCare(
              await api<CareContext>(`/appointments/${appointmentId}/care-context`, {
                method: "PUT",
                json: { answers, consent: true, method: "WEB" },
              }),
            );
            setEditing(false);
          }}
        />
      )}
    </section>
  );
}
