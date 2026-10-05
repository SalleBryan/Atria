/**
 * "Download report": the report as a PDF, an Excel workbook or a CSV file.
 *
 * Built like Add to calendar (patient/AddToCalendar.tsx): the platform's menu
 * on <body>, placed by useMenu, so no card on the page can paint over it. The
 * menu drawn inside the page sat under the Attendance tile (audit 2026-10-05).
 */

import { type CSSProperties, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useMenu } from "../components/FilterMenu";
import { Close, Download } from "../components/icons";

export interface ReportFormat {
  id: "pdf" | "xlsx" | "csv";
  label: string;
  hint: string;
  pick: () => void;
}

export function ReportDownload({ formats, admin }: { formats: ReportFormat[]; admin: boolean }) {
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const { place } = useMenu({ open, onClose: close, anchor: button, panel, width: 280, align: "end", roomNeeded: 230 });

  return (
    <>
      <button
        ref={button}
        type="button"
        className="outline-button reports-download-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
      >
        <Download size={15} />
        Download report
      </button>
      {open &&
        createPortal(
          <div className={`menu-layer${admin ? " menu-admin" : ""}`}>
            <div className="menu-scrim menu-scrim-clear" onClick={close} aria-hidden="true" />
            <div ref={panel} className="filter-menu choice-menu" role="menu" aria-label="Download report" style={place}>
              <div className="filter-menu-head">
                <h2>Download report</h2>
                <button type="button" className="icon-button" onClick={close} aria-label="Close">
                  <Close size={16} />
                </button>
              </div>
              <div className="choice-list">
                {formats.map(({ id, label, hint, pick }, i) => (
                  <button
                    key={id}
                    type="button"
                    role="menuitem"
                    className="suggest-item choice-item"
                    style={{ "--i": i } as CSSProperties}
                    onClick={() => {
                      close();
                      pick();
                    }}
                  >
                    <span className="suggest-icon" aria-hidden="true">
                      <Download size={15} />
                    </span>
                    <span className="suggest-text">
                      <span className="suggest-main">{label}</span>
                      <span className="suggest-hint">{hint}</span>
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
