/// The demo's invented hospital: a few of the Regional Hospital of Buea's
/// units and fictional clinicians (spec/atria_spec/hospital.py), and one
/// patient's visits placed relative to today so every screen has something to
/// show. Nothing here is a real person.
library;

DateTime _at(int days, int hour, [int minute = 0]) {
  final now = DateTime.now().toUtc();
  // Hours are the clinic's (UTC+1).
  return DateTime.utc(now.year, now.month, now.day + days, hour - 1, minute);
}

String _iso(DateTime d) => d.toIso8601String().replaceFirst('.000', '');

final clinics = [
  {'clinicId': 'u-paed', 'name': 'Paediatrics Unit', 'address': 'Regional Hospital Buea, Buea'},
  {'clinicId': 'u-med', 'name': 'Medical Unit', 'address': 'Regional Hospital Buea, Buea'},
  {'clinicId': 'u-mat', 'name': 'Maternity Unit', 'address': 'Regional Hospital Buea, Buea'},
  {'clinicId': 'u-opd', 'name': 'General Outpatient Department', 'address': 'Regional Hospital Buea, Buea'},
];

Map<String, dynamic> _doctor(String id, String given, String family, String specialty, String clinic, String band) => {
  'clinicianProfileId': id,
  'clinicId': clinic,
  'givenName': given,
  'familyName': family,
  'specialty': specialty,
  'qualifications': <String>[],
  'registrationYear': 2012,
  'seniorityBand': band,
  'languages': ['en', 'fr'],
};

final clinicians = [
  _doctor('c-mbarga', 'Esther', 'Mbarga', 'Paediatrics', 'u-paed', 'SENIOR'),
  _doctor('c-nkeng', 'Rene', 'Nkeng', 'Paediatrics', 'u-paed', 'EXPERIENCED'),
  _doctor('c-tchoupo', 'Samuel', 'Tchoupo', 'Gynaecology', 'u-mat', 'SENIOR'),
  _doctor('c-eyong', 'Lydia', 'Eyong', 'Internal medicine', 'u-med', 'ESTABLISHED'),
  _doctor('c-fon', 'Pius', 'Fon', 'General practice', 'u-opd', 'ESTABLISHED'),
];

final types = [
  {
    'appointmentTypeId': 'at-spec-first',
    'code': 'SPEC_FIRST',
    'name': 'First specialist consultation',
    'serviceLine': 'SPECIALIST',
    'durationUnits': 3,
    'clinicIds': ['u-paed', 'u-med', 'u-mat'],
  },
  {
    'appointmentTypeId': 'at-general',
    'code': 'GENERAL',
    'name': 'General consultation',
    'serviceLine': 'GENERAL',
    'durationUnits': null,
    'clinicIds': ['u-opd'],
  },
];

List<Map<String, dynamic>>? _visits;

/// The demo patient's visits, kept for the session so cancelling and moving show.
List<Map<String, dynamic>> appointments() => _visits ??= [
  _visit('a-next', 'APT-4958', 'c-mbarga', 'u-paed', _at(2, 10), 'CONFIRMED'),
  _visit('a-later', 'APT-5095', 'c-tchoupo', 'u-mat', _at(8, 14, 20), 'DISRUPTED'),
  _visit('a-past', 'APT-3310', 'c-eyong', 'u-med', _at(-20, 9), 'COMPLETED'),
];

Map<String, dynamic> _visit(String id, String ref, String clinician, String clinic, DateTime start, String state) => {
  'appointmentId': id,
  'reference': ref,
  'clinicId': clinic,
  'patientProfileId': 'pp-preview',
  'appointmentTypeId': 'at-spec-first',
  'clinicianProfileId': clinician,
  'startAt': _iso(start),
  'endAt': _iso(start.add(const Duration(minutes: 30))),
  'state': state,
  'channel': 'ONLINE',
  'createdAt': _iso(start.subtract(const Duration(days: 5))),
  'version': 1,
};

/// Today's free starts: two clinicians still have openings.
List<Map<String, String>> slotsFor(String clinician) {
  final now = DateTime.now().toUtc();
  final open = {'c-nkeng': 16, 'c-eyong': 15}[clinician];
  if (open == null) return [];
  final start = DateTime.utc(now.year, now.month, now.day, open - 1);
  return start.isAfter(now)
      ? [
          {'startAt': _iso(start)},
        ]
      : [];
}

/// The next week's free starts for a clinician, three a day on weekdays.
Map<String, List<Map<String, String>>> weekFor(String clinician) {
  final days = <String, List<Map<String, String>>>{};
  for (var d = 1; d <= 6; d++) {
    final day = _at(d, 9);
    if (day.weekday > 5) continue;
    final key = _iso(day).substring(0, 10);
    days[key] = [
      for (final h in [9, 11, 15]) {'startAt': _iso(_at(d, h))},
    ];
  }
  return days;
}
