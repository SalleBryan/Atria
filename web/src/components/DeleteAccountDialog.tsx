/**
 * Deleting an account (2026-09-29): the one dialog for a patient deleting
 * their own, and an administrator deleting a patient's or a staff account.
 * Whoever deletes, the account waits 30 days before it is erased and can be
 * restored until then, and the dialog says so before anything happens.
 */

import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { messageFor } from "../auth/errors";
import { Notice } from "./controls";
import { Alert, Trash, Undo } from "./icons";
import { LoadingIndicator } from "./LoadingIndicator";

export function DeleteAccountDialog({
  title,
  lede,
  points,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  lede: ReactNode;
  /** What happens at once, each a short sentence. */
  points: string[];
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>("button.keep")?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function confirm() {
    setBusy(true);
    setFailure(null);
    try {
      await onConfirm();
    } catch (caught) {
      setFailure(messageFor(caught));
      setBusy(false);
    }
  }

  return createPortal(
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div
        ref={dialog}
        className="dialog staff-dialog delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="dialog-icon" aria-hidden="true">
          <Trash size={22} />
        </span>
        <h2 id="delete-title">{title}</h2>
        <p className="dialog-lede">{lede}</p>
        <ul className="delete-points">
          {points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <div className="dialog-note">
          <Alert size={15} />
          <p>Nothing is erased for 30 days. Until then the account can be restored exactly as it was.</p>
        </div>
        {failure && <Notice tone="error">{failure}</Notice>}
        <div className="dialog-actions">
          <button type="button" className="outline-button keep" onClick={onClose} disabled={busy}>
            Keep the account
          </button>
          <button type="button" className="danger-button" onClick={confirm} disabled={busy} aria-busy={busy || undefined}>
            {busy ? <LoadingIndicator size={20} label="Deleting" /> : null}
            {busy ? "Deleting" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Taking a deleted account back within its 30 days. */
export function RestoreDialog({ name, onConfirm, onClose }: { name: string; onConfirm: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  return createPortal(
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div className="dialog staff-dialog" role="dialog" aria-modal="true" aria-labelledby="restore-title" onClick={(event) => event.stopPropagation()}>
        <span className="dialog-icon dialog-icon-blue" aria-hidden="true">
          <Undo size={22} />
        </span>
        <h2 id="restore-title">Restore {name}?</h2>
        <p className="dialog-lede">
          The account comes back as it was before it was deleted, and can sign in again. Visits cancelled by the deletion stay cancelled.
        </p>
        {failure && <Notice tone="error">{failure}</Notice>}
        <div className="dialog-actions">
          <button type="button" className="outline-button keep" onClick={onClose} disabled={busy}>
            Leave it deleted
          </button>
          <button
            type="button"
            className="staff-primary"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={async () => {
              setBusy(true);
              setFailure(null);
              try {
                await onConfirm();
              } catch (caught) {
                setFailure(messageFor(caught));
                setBusy(false);
              }
            }}
          >
            {busy ? <LoadingIndicator size={20} label="Restoring" /> : null}
            {busy ? "Restoring" : "Restore account"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Restoring multiple deleted accounts back within their 30 days. */
export function BatchRestoreDialog({
  count,
  noun = "account",
  onConfirm,
  onClose,
}: {
  count: number;
  noun?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const label = count === 1 ? noun : `${noun}s`;
  return createPortal(
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div className="dialog staff-dialog" role="dialog" aria-modal="true" aria-labelledby="restore-title" onClick={(event) => event.stopPropagation()}>
        <span className="dialog-icon dialog-icon-blue" aria-hidden="true">
          <Undo size={22} />
        </span>
        <h2 id="restore-title">Restore {count} {label}?</h2>
        <p className="dialog-lede">
          Each account comes back as it was before it was deleted, and can sign in again. Visits cancelled by the deletion stay cancelled.
        </p>
        {failure && <Notice tone="error">{failure}</Notice>}
        <div className="dialog-actions">
          <button type="button" className="outline-button keep" onClick={onClose} disabled={busy}>
            Leave deleted
          </button>
          <button
            type="button"
            className="staff-primary"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={async () => {
              setBusy(true);
              setFailure(null);
              try {
                await onConfirm();
              } catch (caught) {
                setFailure(messageFor(caught));
                setBusy(false);
              }
            }}
          >
            {busy ? <LoadingIndicator size={20} label="Restoring" /> : null}
            {busy ? "Restoring" : `Restore ${count} ${label}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Whole days until a purge instant, never below zero. */
export function daysLeft(purgeAt: string | null | undefined): number {
  if (!purgeAt) return 0;
  return Math.max(0, Math.ceil((Date.parse(purgeAt) - Date.now()) / 86400000));
}
