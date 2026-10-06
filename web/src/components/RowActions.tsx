/**
 * A row's actions behind one button (feedback 2026-10-06). Five square icons
 * in a row's last column spilled over the role beside them, and said nothing
 * until hovered; the menu names each action and keeps the row to one button.
 *
 * Built like Download report (staff/ReportDownload.tsx): the platform's menu
 * on <body>, placed by useMenu, so no card on the page can paint over it.
 */

import { type ComponentType, type CSSProperties, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useMenu } from "./FilterMenu";
import { Close, Dots } from "./icons";

export interface RowAction {
  key: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  pick: () => void;
  /** Why the action is not offered here, shown under it; the item is then disabled. */
  unavailable?: string | null;
  danger?: boolean;
}

export function RowActions({ label, actions }: { label: string; actions: RowAction[] }) {
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const { place, admin } = useMenu({ open, onClose: close, anchor: button, panel, width: 290, align: "end", roomNeeded: 60 + actions.length * 56 });

  return (
    <>
      <button
        ref={button}
        type="button"
        className="square-button row-actions-button"
        aria-label={label}
        title="Actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
      >
        <Dots size={18} />
      </button>
      {open &&
        createPortal(
          <div className={`menu-layer${admin ? " menu-admin" : ""}`}>
            <div className="menu-scrim menu-scrim-clear" onClick={close} aria-hidden="true" />
            <div ref={panel} className="filter-menu choice-menu" role="menu" aria-label={label} style={place}>
              <div className="filter-menu-head">
                <h2>Actions</h2>
                <button type="button" className="icon-button" onClick={close} aria-label="Close">
                  <Close size={16} />
                </button>
              </div>
              <div className="choice-list">
                {actions.map(({ key, label: name, icon: IconComponent, pick, unavailable, danger }, i) => (
                  <button
                    key={key}
                    type="button"
                    role="menuitem"
                    className={`suggest-item choice-item${danger ? " choice-item-danger" : ""}`}
                    style={{ "--i": i } as CSSProperties}
                    disabled={Boolean(unavailable)}
                    onClick={() => {
                      close();
                      pick();
                    }}
                  >
                    <span className="choice-logo" aria-hidden="true">
                      <IconComponent size={17} />
                    </span>
                    <span className="suggest-text">
                      <span className="suggest-main">{name}</span>
                      {unavailable && <span className="suggest-hint">{unavailable}</span>}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
