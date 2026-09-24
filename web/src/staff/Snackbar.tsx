/**
 * A Material 3 snackbar: a short confirmation along the bottom, on the
 * inverse surface, that rises on the fast spatial spring and leaves by
 * itself. Announced politely, so a screen reader hears it without losing its
 * place.
 */

import { useEffect, useRef } from "react";

import { CheckMark } from "../components/icons";

export function Snackbar({ message, onDone, after = 6000 }: { message: string | null; onDone: () => void; after?: number }) {
  // Held in a ref, so a parent re-rendering does not restart the countdown.
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => done.current(), after);
    return () => window.clearTimeout(timer);
  }, [message, after]);

  return (
    <div className="snackbar-slot" role="status" aria-live="polite">
      {message && (
        <div className="snackbar" key={message}>
          <CheckMark size={15} />
          <span>{message}</span>
          <button type="button" onClick={onDone}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
