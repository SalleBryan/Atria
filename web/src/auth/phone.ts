/**
 * Mobile numbers: which country one belongs to, its stored form, and whether
 * it can be a mobile (FR-ACC-01).
 *
 * The tenant's region pack names the home country (Cameroon for Phase 1's one
 * tenant), which a phone field starts on and whose own mobile pattern, from
 * the specification (web/src/generated), a Cameroonian number is held to.
 * Any other country's number is checked by libphonenumber's rules for it.
 * People write their number with spaces and without the country code, so
 * both are accepted, and the stored form is E.164.
 */

import {
  AsYouType,
  type CountryCode,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
} from "libphonenumber-js/min";

import { REGION_PACKS, type RegionPack } from "../generated/regionPacks";

export type { CountryCode };

export const PACK: RegionPack = REGION_PACKS.CM as RegionPack;

/** The country a phone field starts on: the tenant's own. */
export const HOME_COUNTRY = (PACK.code ?? "CM") as CountryCode;

/** Where several countries share a calling code, the one a code alone most likely means. */
const MAIN_COUNTRY: Record<string, CountryCode> = {
  "1": "US",
  "7": "RU",
  "44": "GB",
  "47": "NO",
  "61": "AU",
  "212": "MA",
  "262": "RE",
  "290": "SH",
  "358": "FI",
  "590": "GP",
  "599": "CW",
  "39": "IT",
};

export const dialCode = (country: CountryCode): string => `+${getCountryCallingCode(country)}`;

/** Every country with its calling code, the home country first and the rest by name. */
export function countries(): { code: CountryCode; name: string; dial: string }[] {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const all = getCountries().map((code) => ({ code, name: names.of(code) ?? code, dial: dialCode(code) }));
  all.sort((a, b) => (a.code === HOME_COUNTRY ? -1 : b.code === HOME_COUNTRY ? 1 : a.name.localeCompare(b.name)));
  return all;
}

export const countryName = (country: CountryCode): string =>
  new Intl.DisplayNames(["en"], { type: "region" }).of(country) ?? country;

/**
 * The country a number written with its code (+237..., 00237...) belongs to,
 * as soon as the code can be told. Where a code is shared, the country
 * already chosen wins if it is one of them.
 */
export function countryOf(raw: string, current?: CountryCode): CountryCode | undefined {
  const compact = raw.replace(/[\s().-]/g, "").replace(/^00/, "+");
  if (!compact.startsWith("+") || compact.length < 2) return undefined;
  const typing = new AsYouType();
  typing.input(compact);
  const exact = typing.getCountry();
  if (exact) return exact;
  const code = typing.getCallingCode();
  if (!code) return undefined;
  const sharing = getCountries().filter((c) => getCountryCallingCode(c) === code);
  if (current && sharing.includes(current)) return current;
  return MAIN_COUNTRY[code] ?? sharing[0];
}

/** The number in E.164, read as the chosen country's where it has no code of its own. */
export function normalisePhone(raw: string, country: CountryCode = HOME_COUNTRY): string {
  const compact = raw.replace(/[\s().-]/g, "").replace(/^00/, "+");
  const parsed = parsePhoneNumberFromString(compact, country);
  if (parsed) return parsed.number;
  return compact.startsWith("+") ? compact : `${dialCode(country)}${compact}`;
}

/** Whether a number can be a mobile: the region pack's own pattern at home, libphonenumber's rules elsewhere. */
export function isMobile(e164: string, pack: RegionPack = PACK): boolean {
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return false;
  if (pack.dialCode && e164.startsWith(pack.dialCode)) {
    return pack.msisdnPattern ? new RegExp(pack.msisdnPattern).test(e164) : true;
  }
  return parsePhoneNumberFromString(e164)?.isValid() ?? false;
}

/** The number with its country code replaced by another's, as picking a flag does. */
export function withCountry(raw: string, country: CountryCode): string {
  const compact = raw.replace(/[\s().-]/g, "").replace(/^00/, "+");
  let rest = compact;
  if (compact.startsWith("+")) {
    const typing = new AsYouType();
    typing.input(compact);
    const code = typing.getCallingCode();
    rest = code ? compact.slice(1 + code.length) : "";
  }
  return `${dialCode(country)} ${rest}`;
}
