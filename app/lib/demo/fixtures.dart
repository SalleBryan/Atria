/// The demo's invented hospital: a few of the Regional Hospital of Buea's
/// units and fictional clinicians (spec/atria_spec/hospital.py), and one
/// patient's visits placed relative to today so every screen has something to
/// show. Nothing here is a real person.
library;

import 'dart:math' as math;

DateTime _at(int days, int hour, [int minute = 0]) {
  final now = DateTime.now().toUtc();
  // Hours are the clinic's (UTC+1).
  return DateTime.utc(now.year, now.month, now.day + days, hour - 1, minute);
}

String _iso(DateTime d) => d.toIso8601String().replaceFirst('.000', '');

// An invented site plan, as the web's development mock has: blocks around
// the main gate, so the hospital map has something to draw.
Map<String, dynamic> _unit(String id, String name, String block, String floor, String line, double lat, double lng) => {
  'clinicId': id,
  'name': name,
  'address': 'Regional Hospital Buea, Buea',
  'openingHours': {
    for (var d = 0; d < 5; d++) '$d': {'start': '07:30', 'end': '15:30'},
  },
  'location': {
    'building': block,
    'floor': floor,
    'directions': 'From the main gate, follow the $line line to $block.',
    'lat': lat.toStringAsFixed(6),
    'lng': lng.toStringAsFixed(6),
  },
};

final clinics = [
  _unit('u-paed', 'Paediatrics Unit', 'Block B', 'Ground floor', 'green', 4.15386, 9.2413),
  _unit('u-med', 'Medical Unit', 'Block A', 'First floor', 'blue', 4.15298, 9.24095),
  _unit('u-mat', 'Maternity Unit', 'Block C', 'Ground floor', 'yellow', 4.15342, 9.24235),
  _unit('u-opd', 'General Outpatient Department', 'Block A', 'Ground floor', 'blue', 4.1532, 9.2406),
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

/// The outpatient department's queue sessions for the coming week, as the
/// API lists them: none that have closed or whose hours are over today.
List<Map<String, dynamic>>? _sessions;
List<Map<String, dynamic>> sessions() {
  if (_sessions == null) {
    _sessions = [];
    for (var d = 0; d < 7; d++) {
      final day = _at(d, 12);
      if (day.weekday == DateTime.sunday) continue;
      final date = day.toIso8601String().substring(0, 10);
      for (final (start, end, part, cap, taken) in [
        ('07:30', '12:00', 'MORNING', 60, 14 + d * 3),
        ('13:00', '16:30', 'AFTERNOON', 31, 7 + d),
      ]) {
        _sessions!.add({
          'sessionId': 'se-$date-${start.replaceAll(':', '')}',
          'clinicId': 'u-opd',
          'sessionDate': date,
          'startTime': start,
          'endTime': end,
          'rosteredClinicianCount': part == 'MORNING' ? 3 : 2,
          'capacity': cap,
          'issuedTickets': taken,
          'remaining': cap - taken,
          'partOfDay': part,
          'status': 'OPEN',
        });
      }
    }
  }
  final now = DateTime.now().toUtc().add(const Duration(hours: 1)).toIso8601String().substring(0, 16);
  return _sessions!.where((s) => '${s['sessionDate']}T${s['endTime']}'.compareTo(now) > 0).toList();
}

/// A place in a session: the ticket, as POST /sessions/{id}/tickets returns it.
Map<String, dynamic> takePlace(String sessionId) {
  final session = _sessions!.firstWhere((s) => s['sessionId'] == sessionId);
  final position = (session['issuedTickets'] as int) + 1;
  session['issuedTickets'] = position;
  session['remaining'] = (session['capacity'] as int) - position;
  final open = DateTime.parse('${session['sessionDate']}T${session['startTime']}:00Z')
      .subtract(const Duration(hours: 1));
  // As core/queue.py works it out: the turn comes after those still waiting,
  // counted from now once the session has begun, and the window opens ten
  // minutes early on a round five minutes.
  final rate = 4.5 * (session['rosteredClinicianCount'] as int);
  final now = DateTime.now().toUtc();
  final begin = now.isAfter(open) ? now : open;
  final seen = now.isAfter(open) ? (now.difference(open).inMinutes / 60 * rate).floor() : 0;
  final ahead = math.max(0, position - 1 - seen);
  final turn = begin.add(Duration(minutes: (ahead * 60 / rate).round())).subtract(const Duration(minutes: 10));
  final arrive = DateTime.utc(turn.year, turn.month, turn.day, turn.hour, turn.minute - turn.minute % 5);
  final made = {
    'appointmentId': 'a-q$position-${sessionId.hashCode.abs() % 1000}',
    'reference': 'APT-${7000 + position}',
    'clinicId': 'u-opd',
    'patientProfileId': 'pp-preview',
    'appointmentTypeId': 'at-general',
    'sessionId': sessionId,
    'position': position,
    'startAt': _iso(arrive),
    'endAt': _iso(arrive.add(const Duration(minutes: 30))),
    'state': 'BOOKED',
    'channel': 'ONLINE',
    'createdAt': DateTime.now().toUtc().toIso8601String(),
    'version': 1,
  };
  appointments().add(made);
  return made;
}

Map<String, dynamic> sessionById(String id) => _sessions!.firstWhere((s) => s['sessionId'] == id);

/// What deleting the account does to the visits (services/booking/
/// appointments.py cancel_ahead): every visit still ahead is called off, and a
/// queue place until its window closes. Returns how many.
int cancelAhead() {
  final now = DateTime.now().toUtc();
  var done = 0;
  for (final v in appointments()) {
    if (!const ['BOOKED', 'CONFIRMED', 'RESCHEDULED', 'DISRUPTED', 'REQUESTED'].contains(v['state'])) continue;
    final ticket = v['sessionId'] != null;
    final ends = DateTime.parse(v['endAt'] as String), starts = DateTime.parse(v['startAt'] as String);
    if ((ticket && ends.isBefore(now)) || (!ticket && !starts.isAfter(now))) continue;
    v['state'] = 'PATIENT_CANCELLED';
    done++;
  }
  return done;
}
