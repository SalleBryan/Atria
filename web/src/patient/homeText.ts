/**
 * Language-aware wording for the patient Home screen (NFR-L10N-01). The English
 * helpers in `data.tsx` are shared by other screens and stay as they are; these
 * read the same clock and answer in the active language. Times, XAF amounts and
 * the clinic's zone follow the region pack, not the language (NFR-L10N-02).
 */

import type { TFunction } from "i18next";

import { clock } from "./data";

const ZONE = "Africa/Douala";
const intl = (lng: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(lng === "fr" ? "fr-FR" : "en-GB", { timeZone: ZONE, ...options });

/** "Wed 10 Sep" in English and Pidgin, "mer. 10 sept." in French. */
export function dayShort(instant: string | Date, lng: string): string {
  if (lng !== "fr") return clock.day(instant);
  return intl(lng, { weekday: "short", day: "numeric", month: "short" }).format(new Date(instant));
}

/** Month tile, upper case. */
export function monthTile(instant: string | Date, lng: string): string {
  if (lng !== "fr") return clock.month(instant);
  return intl(lng, { month: "short" }).format(new Date(instant)).replace(/\.$/, "").toUpperCase();
}

export function dayLong(instant: string | Date, lng: string): string {
  if (lng !== "fr") return clock.long(instant);
  return intl(lng, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(instant));
}

export function greetingText(t: TFunction, now = new Date()): string {
  const hour = clock.hour(now);
  return t(hour < 12 ? "greeting.morning" : hour < 18 ? "greeting.afternoon" : "greeting.evening");
}

/** The words for "in 2 days", "Tomorrow", "3 h", "Now": same rules as `until` in data.tsx. */
export function untilText(t: TFunction, instant: string, now = new Date()): string {
  const minutes = Math.round((new Date(instant).getTime() - now.getTime()) / 60000);
  const days = Math.round((Date.parse(`${clock.isoDate(instant)}T00:00:00Z`) - Date.parse(`${clock.isoDate(now)}T00:00:00Z`)) / 86400000);
  if (days >= 2) return t("until.days", { count: days });
  if (days === 1) return t("until.tomorrow");
  if (minutes >= 60) return t("until.hours", { count: Math.round(minutes / 60) });
  return minutes > 0 ? t("until.minutes", { count: minutes }) : t("until.now");
}
