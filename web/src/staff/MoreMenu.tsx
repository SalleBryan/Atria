/**
 * The phone's "More" (2026-09-28): a bottom bar holds four destinations, and
 * a manager or an administrator has up to twelve. The rest, and signing out,
 * open from here in the platform's own menu.
 */

import { type ComponentType, type CSSProperties, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";

import { useSession } from "../auth/session";
import { useMenu } from "../components/FilterMenu";
import { Close, Globe, More, SignOut } from "../components/icons";

interface Item {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
}

export function MoreMenu({ items, active }: { items: Item[]; active: boolean }) {
  const { signOut } = useSession();
  const navigate = useNavigate();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const { place } = useMenu({ open, onClose: close, anchor: button, panel, width: 300, align: "end", roomNeeded: 320 });

  const choices = [
    ...items.map((item) => ({
      key: item.to,
      label: item.label,
      hint: null as string | null,
      icon: item.icon,
      run: () => navigate(item.to),
    })),
    { key: "out-here", label: "Sign out", hint: "Of this device", icon: SignOut, run: () => void signOut({ everywhere: false }) },
    {
      key: "out-all",
      label: "Sign out everywhere",
      hint: "Others lose access within the hour",
      icon: Globe,
      run: () => void signOut({ everywhere: true }),
    },
  ];

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`bottom-item${active ? " active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
      >
        <span className="bottom-indicator">
          <More size={20} />
        </span>
        <span className="bottom-label">More</span>
      </button>
      {open &&
        createPortal(
          <div className="menu-layer">
            <div className="menu-scrim menu-scrim-clear" onClick={close} aria-hidden="true" />
            <div ref={panel} className="filter-menu choice-menu" role="menu" aria-label="More" style={place}>
              <div className="filter-menu-head">
                <h2>More</h2>
                <button type="button" className="icon-button" onClick={close} aria-label="Close">
                  <Close size={16} />
                </button>
              </div>
              <div className="choice-list">
                {choices.map(({ key, label, hint, icon: IconComponent, run }, i) => (
                  <button
                    key={key}
                    type="button"
                    role="menuitem"
                    className="suggest-item choice-item"
                    style={{ "--i": i } as CSSProperties}
                    onClick={() => {
                      close();
                      run();
                    }}
                  >
                    <span className="choice-logo" aria-hidden="true">
                      <IconComponent size={18} />
                    </span>
                    <span className="suggest-text">
                      <span className="suggest-main">{label}</span>
                      {hint && <span className="suggest-hint">{hint}</span>}
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
