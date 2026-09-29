import '../ui/filters.dart';
import '../ui/search.dart';
import 'data.dart';

/// What a patient's search bar guesses from (web/src/patient/careSearch.ts):
/// clinicians, specialties, units and the languages clinicians consult in,
/// most popular first. Home and Find care search the same things; each says
/// what picking a suggestion does.
class CareChoices {
  const CareChoices({required this.specialties, required this.clinics, required this.languages});
  final List<FilterOption> specialties;
  final List<FilterOption> clinics;
  final List<FilterOption> languages;
}

/// The filter options, each with how many clinicians it leaves.
CareChoices careChoices(List<Clinician> clinicians, List<Clinic> clinics) => CareChoices(
  specialties: byPopularity(clinicians, (c) => c.specialty),
  clinics: [
    for (final o in byPopularity(clinicians, (c) => c.clinicId))
      o.relabel(clinics.where((c) => c.id == o.id).firstOrNull?.name ?? o.id),
  ],
  languages: [
    for (final o in byPopularity(clinicians.expand((c) => c.languages), (code) => code)) o.relabel(languageName(o.id)),
  ],
);

String _many(int? count) => count == 1 ? '1 clinician' : '${count ?? 0} clinicians';

List<SuggestionGroup> careSuggestions(
  List<Clinician> clinicians,
  List<Clinic> clinics,
  CareChoices choices, {
  required void Function(String id) clinician,
  required void Function(String name) specialty,
  required void Function(String id) clinic,
  required void Function(String code) language,
}) {
  Clinic? clinicOf(String? id) => clinics.where((k) => k.id == id).firstOrNull;
  return [
    SuggestionGroup(
      id: 'clinicians',
      label: 'Clinicians',
      icon: 'user',
      items: [
        for (final c in clinicians)
          Suggestion(
            id: c.id,
            label: c.name,
            match: [c.givenName, c.familyName].whereType<String>().join(' '),
            hint: [c.specialty, clinicOf(c.clinicId)?.name].whereType<String>().join(' · '),
            onPick: () => clinician(c.id),
          ),
      ],
    ),
    SuggestionGroup(
      id: 'specialties',
      label: 'Specialties',
      icon: 'stethoscope',
      items: [
        for (final o in choices.specialties)
          Suggestion(id: o.id, label: o.label, hint: _many(o.count), onPick: () => specialty(o.id)),
      ],
    ),
    SuggestionGroup(
      id: 'clinics',
      label: 'Units',
      icon: 'building',
      items: [
        for (final o in choices.clinics)
          Suggestion(
            id: o.id,
            label: o.label,
            hint: clinicOf(o.id)?.address,
            also: [?clinicOf(o.id)?.address],
            onPick: () => clinic(o.id),
          ),
      ],
    ),
    SuggestionGroup(
      id: 'languages',
      label: 'Consults in',
      icon: 'globe',
      items: [
        for (final o in choices.languages)
          Suggestion(id: o.id, label: o.label, hint: _many(o.count), onPick: () => language(o.id)),
      ],
    ),
  ];
}
