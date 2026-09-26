/**
 * What a patient's search bar guesses from: clinicians, specialties, clinics
 * and the languages clinicians consult in, most popular first. Home and Find
 * care search the same things, so they share this; each says what picking a
 * suggestion does (Home goes to Find care, Find care narrows its list).
 */

import { byPopularity, type FilterOption } from "../components/FilterMenu";
import { Building, Globe, Stethoscope, User } from "../components/icons";
import type { SuggestionGroup } from "../components/SearchSuggest";
import { type Clinic, type Clinician, clinicianName, languageName } from "./data";

export interface CareChoices {
  specialties: FilterOption[];
  clinics: FilterOption[];
  languages: FilterOption[];
}

/** The filter options, each with how many clinicians it leaves. */
export function careChoices(clinicians: readonly Clinician[], clinics: readonly Clinic[]): CareChoices {
  return {
    specialties: byPopularity(clinicians, (c) => c.specialty),
    clinics: byPopularity(clinicians, (c) => c.clinicId).map((o) => ({
      ...o,
      label: clinics.find((c) => c.clinicId === o.id)?.name ?? o.id,
    })),
    languages: byPopularity(
      clinicians.flatMap((c) => c.languages),
      (code) => code,
    ).map((o) => ({ ...o, label: languageName(o.id) })),
  };
}

const many = (count: number | undefined) => (count === 1 ? "1 clinician" : `${count ?? 0} clinicians`);

export function careSuggestions(
  clinicians: readonly Clinician[],
  clinics: readonly Clinic[],
  choices: CareChoices,
  pick: {
    clinician: (id: string) => void;
    specialty: (name: string) => void;
    clinic: (id: string) => void;
    language: (code: string) => void;
  },
): SuggestionGroup[] {
  const clinicOf = (id: string | null) => clinics.find((k) => k.clinicId === id);
  return [
    {
      id: "clinicians",
      label: "Clinicians",
      icon: User,
      items: clinicians.map((c) => ({
        id: c.clinicianProfileId,
        label: clinicianName(c),
        match: [c.givenName, c.familyName].filter(Boolean).join(" "),
        hint: [c.specialty, clinicOf(c.clinicId)?.name].filter(Boolean).join(" · "),
        onPick: () => pick.clinician(c.clinicianProfileId),
      })),
    },
    {
      id: "specialties",
      label: "Specialties",
      icon: Stethoscope,
      items: choices.specialties.map((o) => ({
        id: o.id,
        label: o.label,
        hint: many(o.count),
        onPick: () => pick.specialty(o.id),
      })),
    },
    {
      id: "clinics",
      label: "Units",
      icon: Building,
      items: choices.clinics.map((o) => {
        const address = clinicOf(o.id)?.address ?? undefined;
        return {
          id: o.id,
          label: o.label,
          hint: address,
          also: address ? [address] : [],
          onPick: () => pick.clinic(o.id),
        };
      }),
    },
    {
      id: "languages",
      label: "Consults in",
      icon: Globe,
      items: choices.languages.map((o) => ({
        id: o.id,
        label: o.label,
        hint: many(o.count),
        onPick: () => pick.language(o.id),
      })),
    },
  ];
}
