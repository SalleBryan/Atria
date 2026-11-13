/**
 * The language the app reads in. The signed-in person's saved choice (GET /me
 * preferredLanguage) wins, then this browser's last choice, then English.
 * Choosing saves to the browser and, when signed in, to the account (PATCH /me).
 */

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { PACK } from "../auth/phone";
import { SessionContext } from "../auth/session";
import i18n, { isLanguage, type Language } from "./index";

const KEY = "atria.language";

/** The region pack's languages that the app has strings for. */
export const OFFERED: Language[] = ((PACK.languages ?? ["en"]) as unknown[]).filter(isLanguage);

function stored(): Language {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    // Storage can be blocked; English then.
  }
  return "en";
}

interface Choice {
  language: Language;
  setLanguage: (language: Language) => void;
}

const LanguageContext = createContext<Choice | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const session = useContext(SessionContext);
  const signedIn = session?.state.status === "signed-in";
  const saved = session?.state.status === "signed-in" ? session.state.me.preferredLanguage : null;
  const [language, setCurrent] = useState<Language>(stored);

  useEffect(() => {
    if (isLanguage(saved)) setCurrent(saved);
  }, [saved]);

  useEffect(() => {
    void i18n.changeLanguage(language);
    document.documentElement.lang = language;
    try {
      localStorage.setItem(KEY, language);
    } catch {
      // Not remembered on this browser; the account still holds it when signed in.
    }
  }, [language]);

  const setLanguage = useCallback(
    (next: Language) => {
      setCurrent(next);
      // The screen is already in the new language; a failed save only means it is not kept on the account.
      if (signedIn) void api("/me", { method: "PATCH", json: { preferredLanguage: next } }).catch(() => undefined);
    },
    [signedIn],
  );

  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): Choice {
  const choice = useContext(LanguageContext);
  if (!choice) throw new Error("useLanguage outside LanguageProvider");
  return choice;
}
