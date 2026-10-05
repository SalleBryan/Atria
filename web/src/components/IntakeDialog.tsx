/**
 * "Before your visit": a visit's intake questions in a dialog (FR-BKG-15).
 *
 * At booking it is the step between choosing a time and holding it: the
 * patient answers what they like, agrees to share, and books; or books without
 * answering, and can add answers from the visit later. From a visit it adds
 * or changes the answers until the visit starts.
 */

import { type FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { IntakeAnswers, IntakeForm } from "../patient/data";
import { Notice } from "./controls";
import { Clipboard } from "./icons";
import { answered, IntakeFields, missingAnswer } from "./IntakeFields";
import { LoadingIndicator } from "./LoadingIndicator";

export function IntakeDialog({
  form,
  clinician,
  initial,
  mode,
  onClose,
  onSubmit,
  onSkip,
}: {
  form: IntakeForm;
  clinician: string;
  initial?: IntakeAnswers | null;
  /** "book" offers booking without answers; "edit" saves them to a visit. */
  mode: "book" | "edit";
  onClose: () => void;
  onSubmit: (answers: IntakeAnswers) => Promise<void>;
  onSkip?: () => Promise<void>;
}) {
  const [answers, setAnswers] = useState<IntakeAnswers>(initial ?? {});
  const [consent, setConsent] = useState(Boolean(initial));
  const [busy, setBusy] = useState<"share" | "skip" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialog.current
      ?.querySelector<HTMLElement>("textarea, input, button")
      ?.focus();
    const onKey = (event: KeyboardEvent) =>
      event.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const missing = missingAnswer(form, answers);
  const ready = consent && !missing;

  async function share(event: FormEvent) {
    event.preventDefault();
    if (!ready) {
      setFailure(
        missing
          ? `Please answer: ${missing}`
          : "Tick the box to share your answers.",
      );
      return;
    }
    setBusy("share");
    setFailure(null);
    try {
      await onSubmit(answered(answers));
    } catch (caught) {
      setFailure(
        caught instanceof Error
          ? caught.message
          : "That did not go through. Try again.",
      );
      setBusy(null);
    }
  }

  async function skip() {
    if (!onSkip) return;
    setBusy("skip");
    setFailure(null);
    try {
      await onSkip();
    } catch (caught) {
      setFailure(
        caught instanceof Error
          ? caught.message
          : "That did not go through. Try again.",
      );
      setBusy(null);
    }
  }

  // On <body>, outside the zoomed layout, like every other dialog: the scrim
  // covers the whole window. The header scrolls with the questions so a short
  // window keeps room for them; the actions stay put.
  return createPortal(
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div
        ref={dialog}
        className="dialog move-dialog intake-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="intake-title"
        onClick={(event) => event.stopPropagation()}
      >
        <form onSubmit={share}>
          <div className="move-scroll">
            <span className="dialog-icon dialog-icon-blue" aria-hidden="true">
              <Clipboard size={22} />
            </span>
            <h2 id="intake-title">Before your visit</h2>
            <p className="dialog-lede">
              A few questions from {clinician}, so your visit starts where it
              should.{" "}
              {mode === "book"
                ? "Answer what you like, or book now and add them later from your visit."
                : "You can change them until the visit starts."}
            </p>
            <IntakeFields
              form={form}
              answers={answers}
              onChange={(next) => {
                setAnswers(next);
                setFailure(null);
              }}
              consent={consent}
              onConsent={(next) => {
                setConsent(next);
                setFailure(null);
              }}
              clinician={clinician}
            />
          </div>
          {failure && <Notice tone="error">{failure}</Notice>}
          <div className="dialog-actions move-actions">
            {mode === "book" ? (
              <button
                type="button"
                className="outline-button keep"
                onClick={() => void skip()}
                disabled={Boolean(busy)}
              >
                {busy === "skip" ? (
                  <LoadingIndicator size={18} label="Booking" />
                ) : null}
                {busy === "skip" ? "Booking" : "Book without answers"}
              </button>
            ) : (
              <button
                type="button"
                className="outline-button keep"
                onClick={onClose}
                disabled={Boolean(busy)}
              >
                Not now
              </button>
            )}
            <button
              type="submit"
              className="dock-button"
              disabled={Boolean(busy)}
              aria-busy={busy === "share" || undefined}
            >
              {busy === "share" ? (
                <LoadingIndicator
                  size={20}
                  label={mode === "book" ? "Booking" : "Saving"}
                />
              ) : null}
              <span>
                {busy === "share"
                  ? mode === "book"
                    ? "Booking"
                    : "Saving"
                  : mode === "book"
                    ? "Share and book"
                    : "Save answers"}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
