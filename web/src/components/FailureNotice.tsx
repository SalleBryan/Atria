/**
 * A failed read, in words, with a way to try again. For a screen that could
 * not load at all; a form that failed to send keeps its own notice so that
 * what the person typed stays where it is.
 */

import { Notice } from "./controls";

export function FailureNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Notice tone="error">
      {message}{" "}
      <button type="button" className="link" onClick={onRetry}>
        Try again
      </button>
    </Notice>
  );
}
