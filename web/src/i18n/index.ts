/**
 * Translations (NFR-L10N-01). Locale files are src/i18n/locales/<language>/<namespace>.json;
 * the file name is the namespace, so a screen adds a file and reads it with
 * useTranslation("ns"). English is the fallback for any key a language lacks.
 * Pidgin ("pcm") files carry a "_review" key until a native speaker has read them.
 */

import i18next from "i18next";
import { initReactI18next } from "react-i18next";

export const LANGUAGES = ["en", "fr", "pcm"] as const;
export type Language = (typeof LANGUAGES)[number];

const files = import.meta.glob("./locales/*/*.json", { eager: true, import: "default" }) as Record<string, object>;

const resources: Record<string, Record<string, object>> = {};
for (const [path, strings] of Object.entries(files)) {
  const [, language, file] = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/) ?? [];
  if (language && file) (resources[language] ??= {})[file] = strings;
}

void i18next.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  supportedLngs: [...LANGUAGES],
  defaultNS: "common",
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export const isLanguage = (value: unknown): value is Language => LANGUAGES.includes(value as Language);

export default i18next;
