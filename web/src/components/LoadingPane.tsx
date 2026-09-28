/**
 * What loading looks like everywhere (feedback 2026-09-28): the M3 Expressive
 * loading indicator centred in the space the content will fill, rather than
 * placeholder rows or a word at the bottom. As a list item it fills the list.
 */

import { LoadingIndicator } from "./LoadingIndicator";

export function LoadingPane({ label = "Loading", className = "", glass = false }: { label?: string; className?: string; glass?: boolean }) {
  return (
    <div className={`loading-pane${glass ? " glass" : ""} ${className}`.trim()} aria-busy="true">
      <LoadingIndicator size={44} label={label} />
    </div>
  );
}

export function LoadingRow({ label = "Loading" }: { label?: string }) {
  return (
    <li className="loading-pane loading-row" aria-busy="true">
      <LoadingIndicator size={44} label={label} />
    </li>
  );
}
