/**
 * Mobile numbers, checked against the tenant's region pack (FR-ACC-01).
 *
 * Phase 1 has one tenant, on the Cameroon pack, so that is the pack used; the
 * pattern itself comes from the specification (web/src/generated). People
 * write their number with spaces and without the country code, so both are
 * accepted and the stored form is E.164.
 */

import { REGION_PACKS, type RegionPack } from "../generated/regionPacks";

export const PACK: RegionPack = REGION_PACKS.CM as RegionPack;

export function normalisePhone(raw: string, pack: RegionPack = PACK): string {
  const compact = raw.replace(/[\s().-]/g, "");
  const dial = pack.dialCode ?? "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (dial && compact.startsWith(dial.slice(1))) return `+${compact}`;
  return `${dial}${compact}`;
}

export function isMobile(e164: string, pack: RegionPack = PACK): boolean {
  return pack.msisdnPattern ? new RegExp(pack.msisdnPattern).test(e164) : /^\+[1-9]\d{7,14}$/.test(e164);
}
