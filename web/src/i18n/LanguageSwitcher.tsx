/** Language menu: the same choice list as the sign-out menu, no native select. */

import { type CSSProperties, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { useMenu } from "../components/FilterMenu";
import { Close, Globe } from "../components/icons";
import { OFFERED, useLanguage } from "./LanguageProvider";

export function LanguageSwitcher({ className = "icon-button" }: { className?: string }) {
  const { t } = useTranslation("common");
  const { language, setLanguage } = useLanguage();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const { place } = useMenu({ open, onClose: close, anchor: button, panel, width: 300, align: "end", roomNeeded: 240 });

  return (
    <>
      <button
        ref={button}
        type="button"
        className={className}
        aria-label={t("language")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
      >
        <Globe size={17} />
      </button>
      {open &&
        createPortal(
          <div className="menu-layer">
            <div className="menu-scrim menu-scrim-clear" onClick={close} aria-hidden="true" />
            <div ref={panel} className="filter-menu choice-menu" role="menu" aria-label={t("language")} style={place}>
              <div className="filter-menu-head">
                <h2>{t("language")}</h2>
                <button type="button" className="icon-button" onClick={close} aria-label={t("close")}>
                  <Close size={16} />
                </button>
              </div>
              <div className="choice-list">
                {OFFERED.map((code, i) => (
                  <button
                    key={code}
                    type="button"
                    role="menuitemradio"
                    aria-checked={code === language}
                    className="suggest-item choice-item"
                    style={{ "--i": i } as CSSProperties}
                    onClick={() => {
                      close();
                      setLanguage(code);
                    }}
                  >
                    <span className="suggest-text">
                      <span className="suggest-main">{t(`languages.${code}`)}</span>
                      {code === language && <span className="suggest-hint">{t("languageHint")}</span>}
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
