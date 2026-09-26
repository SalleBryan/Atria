/**
 * "Add to calendar", as a choice of the calendars people use most, each shown
 * with its own official logo (feedback 2026-09-25/26; the files come from the
 * Iconify "logos" set, CC0, and the VS Code icon set, MIT). Google Calendar
 * and Outlook open their own new-event page in a new tab, filled in, for the
 * person to save to their own account; Apple Calendar, and any other app,
 * takes the visit as a file (.ics), which an iPhone or a Mac opens in Calendar.
 *
 * Nothing leaves Atria until the person picks one, and then only what the
 * event needs: what, with whom, where, when and the reference.
 */

import { type CSSProperties, type ReactNode, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useMenu } from "../components/FilterMenu";
import { Close } from "../components/icons";
import { downloadCalendarEntry, googleCalendarLink, outlookCalendarLink } from "./calendar";
import appleLogo from "../assets/apple.svg";
import googleCalendarLogo from "../assets/google-calendar.svg";
import outlookLogo from "../assets/outlook.svg";
import type { Appointment, AppointmentType, Clinic, Clinician } from "./data";

export function AddToCalendar({
  appointment,
  joined,
  className,
  children,
}: {
  appointment: Appointment;
  joined: { clinician?: Clinician; clinic?: Clinic; type?: AppointmentType };
  className: string;
  children: ReactNode;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const { place } = useMenu({ open, onClose: close, anchor: button, panel, width: 300, align: "start", roomNeeded: 250 });

  const choices = [
    {
      id: "google",
      label: "Google Calendar",
      hint: "Opens in a new tab",
      logo: googleCalendarLogo,
      pick: () => window.open(googleCalendarLink(appointment, joined), "_blank", "noopener,noreferrer"),
    },
    {
      id: "outlook",
      label: "Outlook",
      hint: "Opens in a new tab",
      logo: outlookLogo,
      pick: () => window.open(outlookCalendarLink(appointment, joined), "_blank", "noopener,noreferrer"),
    },
    {
      id: "apple",
      label: "Apple Calendar",
      hint: "Or any other calendar app, as a file",
      logo: appleLogo,
      pick: () => downloadCalendarEntry(appointment, joined),
    },
  ];

  return (
    <>
      <button
        ref={button}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div className="menu-layer">
            <div className="menu-scrim menu-scrim-clear" onClick={close} aria-hidden="true" />
            <div ref={panel} className="filter-menu choice-menu" role="menu" aria-label="Add to calendar" style={place}>
              <div className="filter-menu-head">
                <h2>Add to calendar</h2>
                <button type="button" className="icon-button" onClick={close} aria-label="Close">
                  <Close size={16} />
                </button>
              </div>
              <div className="choice-list">
                {choices.map(({ id, label, hint, logo, pick }, i) => (
                  <button
                    key={id}
                    type="button"
                    role="menuitem"
                    className={`suggest-item choice-item choice-${id}`}
                    style={{ "--i": i } as CSSProperties}
                    onClick={() => {
                      close();
                      pick();
                    }}
                  >
                    <span className="choice-logo" aria-hidden="true">
                      <img src={logo} alt="" />
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
