/**
 * Sign out, of this device or of every device (FR-ACC-12).
 *
 * The same menu of choices as "Add to calendar", opened from whatever sign-out
 * control the screen already had. Every device revokes the account's refresh
 * tokens, so no other session can renew itself; one already open keeps its
 * current access, at most an hour, and then ends.
 */

import { type CSSProperties, type ReactNode, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useSession } from "../auth/session";
import { useMenu } from "./FilterMenu";
import { Close, Globe, SignOut } from "./icons";

export function SignOutMenu({
  className,
  label,
  align = "start",
  children,
}: {
  className: string;
  label?: string;
  align?: "start" | "end";
  children: ReactNode;
}) {
  const { signOut } = useSession();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const { place } = useMenu({ open, onClose: close, anchor: button, panel, width: 300, align, roomNeeded: 190 });

  const choices = [
    { id: "here", label: "This device", hint: "Your other devices stay signed in", icon: SignOut, everywhere: false },
    { id: "everywhere", label: "All devices", hint: "Others lose access within the hour", icon: Globe, everywhere: true },
  ];

  return (
    <>
      <button
        ref={button}
        type="button"
        className={className}
        aria-label={label}
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
            <div ref={panel} className="filter-menu choice-menu" role="menu" aria-label="Sign out" style={place}>
              <div className="filter-menu-head">
                <h2>Sign out</h2>
                <button type="button" className="icon-button" onClick={close} aria-label="Close">
                  <Close size={16} />
                </button>
              </div>
              <div className="choice-list">
                {choices.map(({ id, label: text, hint, icon: IconComponent, everywhere }, i) => (
                  <button
                    key={id}
                    type="button"
                    role="menuitem"
                    className="suggest-item choice-item"
                    style={{ "--i": i } as CSSProperties}
                    onClick={() => {
                      close();
                      void signOut({ everywhere });
                    }}
                  >
                    <span className="choice-logo" aria-hidden="true">
                      <IconComponent size={18} />
                    </span>
                    <span className="suggest-text">
                      <span className="suggest-main">{text}</span>
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
