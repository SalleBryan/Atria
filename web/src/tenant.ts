/**
 * The healthcare institution this deployment of Atria serves.
 *
 * Every tenant is a healthcare institution (a hospital, say), and the places
 * inside it where patients are seen are its units; the API calls them clinics.
 * Phase 1 and 2 serve one institution, the Regional Hospital Buea, so its
 * profile is fixed here, from the same definition the development tenant is
 * seeded with (atria_spec.hospital). Wherever a screen names the institution it reads it
 * from this profile, never from a literal, so that when each tenant has its
 * own site (Phase 3) the profile is the one thing that changes, loaded for the
 * address the site is served at. Per-tenant branding beyond the name is out of
 * scope until then (FR-TEN-03).
 */

import { HOSPITAL } from "./generated/hospital";

export const TENANT = {
  /** The institution's name, as patients know it. */
  name: HOSPITAL.name,
  /** Where it is, as a person would say it. */
  place: HOSPITAL.place,
  /** One line on what it is, for the places that introduce it. */
  profile: HOSPITAL.profile,
} as const;
