/**
 * Hospital settings · Intake forms (FR-ADM-06, FR-BKG-15).
 *
 * The questions a visit type asks when it is booked. The administrator writes
 * the questions, never reads the answers: those are care context, for the
 * patient and the clinician only (FR-PRV-10). Saving a form publishes a new
 * version; answers already given keep the version they answered, so a
 * clinician always reads an answer beside the question that was asked.
 */

import { type CSSProperties, type FormEvent, type ReactNode, useState } from "react";

import { api } from "../api/client";
import { Checkbox, Field, Notice } from "../components/controls";
import { ArrowLeft, Clipboard, Close, Pencil, Plus, Shield } from "../components/icons";
import { SelectMenu } from "../components/Pickers";
import type { IntakeField, IntakeForm } from "../patient/data";
import { sentence } from "./labels";

const KIND: Record<IntakeField["kind"], string> = {
  text: "Short answer",
  longText: "Long answer",
  choice: "One of several",
  yesNo: "Yes or no",
  number: "A number",
};

export function FormsTab({
  forms,
  types,
  dialog: Dialog,
  onSaved,
}: {
  forms: IntakeForm[];
  types: { name: string; intakeFormId?: string | null; active: boolean | null }[];
  dialog: DialogComponent;
  onSaved: (message: string) => void;
}) {
  const [editing, setEditing] = useState<IntakeForm | "new" | null>(null);
  const uses = (id: string) => types.filter((t) => t.intakeFormId === id && t.active !== false).map((t) => t.name);
  return (
    <section className="glass accounts-card" aria-label="Intake forms">
      <p className="accounts-banner settings-banner">
        <Shield size={18} />
        You write the questions. The answers are care context: only the patient and their clinician read them, never the front
        desk, unit managers or administrators, and they are deleted 90 days after the visit.
      </p>
      <div className="settings-card-top">
        <p>Asked when a visit is booked. Choose a form for each visit type under Visit types.</p>
        <button type="button" className="staff-primary accounts-new" onClick={() => setEditing("new")}>
          <Plus size={16} />
          New form
        </button>
      </div>
      <ul className="accounts-rows">
        {forms.map((f, index) => (
          <li key={f.intakeFormId} className="account-row settings-form-row" style={{ "--i": index } as CSSProperties}>
            <span className="account-text">
              <span className="account-name">{f.name}</span>
              <span className="account-sub">
                {f.fields.length === 1 ? "1 question" : `${f.fields.length} questions`}, version {f.version}
              </span>
            </span>
            <span className="account-role">
              <span>{uses(f.intakeFormId).length ? uses(f.intakeFormId).join(", ") : "Not used yet"}</span>
            </span>
            <span className="account-actions">
              <button type="button" className="square-button" aria-label={`Edit ${f.name}`} title="Edit" onClick={() => setEditing(f)}>
                <Pencil size={15} />
              </button>
            </span>
          </li>
        ))}
        {!forms.length && <li className="empty">No forms yet.</li>}
      </ul>
      {editing && (
        <FormDialog
          form={editing === "new" ? null : editing}
          dialog={Dialog}
          onClose={() => setEditing(null)}
          onDone={(message) => {
            setEditing(null);
            onSaved(message);
          }}
        />
      )}
    </section>
  );
}

type DialogComponent = (props: {
  title: string;
  lede: string;
  icon: ReactNode;
  busy: boolean;
  onClose: () => void;
  formId: string;
  submit: (event: FormEvent) => void;
  submitLabel: string;
  canSubmit: boolean;
  children: ReactNode;
}) => ReactNode;

interface Draft {
  key: number;
  id: string;
  kind: IntakeField["kind"];
  label: string;
  hint: string;
  required: boolean;
  options: string;
  min: string;
  max: string;
}

let nextKey = 1;

function draftOf(field?: IntakeField): Draft {
  return {
    key: nextKey++,
    id: field?.id ?? "",
    kind: field?.kind ?? "longText",
    label: field?.label ?? "",
    hint: field?.hint ?? "",
    required: field?.required ?? false,
    options: (field?.options ?? []).map((o) => o.label).join("\n"),
    min: field?.min !== undefined ? String(field.min) : "0",
    max: field?.max !== undefined && field.kind === "number" ? String(field.max) : "999",
  };
}

/** An id from the question's words, kept once a question has one. */
function idFor(draft: Draft, taken: Set<string>): string {
  if (draft.id) return draft.id;
  const words = draft.label.replace(/[^A-Za-z0-9 ]/g, "").trim().split(/\s+/).slice(0, 3);
  let base = words.map((w, i) => (i ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join("") || "question";
  if (!/^[A-Za-z]/.test(base)) base = `q${base}`;
  let id = base.slice(0, 32);
  for (let n = 2; taken.has(id); n += 1) id = `${base.slice(0, 30)}${n}`;
  return id;
}

function slug(label: string, taken: Set<string>): string {
  let base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "option";
  if (!/^[a-z]/.test(base)) base = `o-${base}`;
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

function FormDialog({
  form,
  dialog: Dialog,
  onClose,
  onDone,
}: {
  form: IntakeForm | null;
  dialog: DialogComponent;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [name, setName] = useState(form?.name ?? "");
  const [fields, setFields] = useState<Draft[]>(form ? form.fields.map(draftOf) : [draftOf()]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const change = (key: number, patch: Partial<Draft>) => setFields((all) => all.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const move = (index: number, by: number) =>
    setFields((all) => {
      const next = [...all];
      const [taken] = next.splice(index, 1);
      next.splice(index + by, 0, taken!);
      return next;
    });

  const problems = fields.flatMap((f) => {
    if (!f.label.trim()) return ["Every question needs its words."];
    if (f.kind === "choice" && f.options.split("\n").filter((o) => o.trim()).length < 2) return [`"${f.label}" needs at least two options.`];
    if (f.kind === "number" && !(Number(f.min) <= Number(f.max))) return [`"${f.label}" needs a lowest number below its highest.`];
    return [];
  });
  const ready = name.trim() && fields.length > 0 && !problems.length;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    const ids = new Set<string>();
    const body = {
      name: name.trim(),
      fields: fields.map((f) => {
        const id = idFor(f, ids);
        ids.add(id);
        const optionIds = new Set<string>();
        return {
          id,
          kind: f.kind,
          label: f.label.trim(),
          required: f.required,
          ...(f.hint.trim() ? { hint: f.hint.trim() } : {}),
          ...(f.kind === "choice"
            ? {
                options: f.options
                  .split("\n")
                  .map((o) => o.trim())
                  .filter(Boolean)
                  .map((label) => ({ id: slug(label, optionIds), label })),
              }
            : {}),
          ...(f.kind === "number" ? { min: Number(f.min), max: Number(f.max) } : {}),
        };
      }),
    };
    try {
      if (form) {
        await api(`/admin/intake-forms/${encodeURIComponent(form.intakeFormId)}`, { method: "PUT", json: body });
      } else {
        await api("/admin/intake-forms", { method: "POST", json: body });
      }
      onDone(
        form
          ? `${body.name} is now version ${form.version + 1}. Bookings from now on ask it; answers already given keep theirs.`
          : `${body.name} added. Choose it for a visit type to ask it at booking.`,
      );
    } catch (caught) {
      setFailure(`${sentence(caught instanceof Error ? caught.message : "The form could not be saved")} Nothing was changed.`);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={form ? form.name : "New intake form"}
      lede={form ? "Saving publishes a new version. Answers already given keep the questions they answered." : "Questions a patient answers when they book."}
      icon={<Clipboard size={22} />}
      busy={busy}
      onClose={onClose}
      formId="intake-form"
      submit={submit}
      submitLabel={form ? "Publish new version" : "Add form"}
      canSubmit={Boolean(ready)}
    >
      <Field label="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      <span className="settings-label">Questions</span>
      <ol className="form-questions">
        {fields.map((f, index) => (
          <li key={f.key} className="form-question" style={{ "--i": index } as CSSProperties}>
            <div className="form-question-top">
              <span className="form-question-number">{index + 1}</span>
              <SelectMenu
                label="Kind of answer"
                value={f.kind}
                width={200}
                options={(Object.keys(KIND) as IntakeField["kind"][]).map((k) => ({ id: k, label: KIND[k] }))}
                onChange={(kind) => change(f.key, { kind: kind as IntakeField["kind"] })}
              />
              <span className="form-question-tools">
                <button type="button" className="icon-button" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
                  <ArrowLeft size={14} className="turn-up" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Move down"
                  disabled={index === fields.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowLeft size={14} className="turn-down" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Remove question"
                  disabled={fields.length === 1}
                  onClick={() => setFields((all) => all.filter((x) => x.key !== f.key))}
                >
                  <Close size={14} />
                </button>
              </span>
            </div>
            <Field label="Question" value={f.label} maxLength={160} onChange={(e) => change(f.key, { label: e.target.value })} />
            <Field label="Help, if any" value={f.hint} maxLength={200} onChange={(e) => change(f.key, { hint: e.target.value })} />
            {f.kind === "choice" && (
              <label className="form-options">
                <span className="settings-label">Options, one per line</span>
                <textarea className="dialog-text" value={f.options} onChange={(e) => change(f.key, { options: e.target.value })} />
              </label>
            )}
            {f.kind === "number" && (
              <div className="off-fields">
                <Field label="Lowest" inputMode="numeric" value={f.min} onChange={(e) => change(f.key, { min: e.target.value.replace(/\D/g, "") })} />
                <Field label="Highest" inputMode="numeric" value={f.max} onChange={(e) => change(f.key, { max: e.target.value.replace(/\D/g, "") })} />
              </div>
            )}
            <Checkbox checked={f.required} onChange={(required) => change(f.key, { required })}>
              Needed to share answers
            </Checkbox>
          </li>
        ))}
      </ol>
      <button type="button" className="outline-button form-add" disabled={fields.length >= 20} onClick={() => setFields((all) => [...all, draftOf()])}>
        <Plus size={15} />
        Add a question
      </button>
      {problems[0] && <p className="availability-note">{problems[0]}</p>}
      {failure && <Notice tone="error">{failure}</Notice>}
    </Dialog>
  );
}
