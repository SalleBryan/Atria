/// A stand-in for the Atria API in the demo build, ported from the web's
/// development preview (web/src/dev/mockApi.ts) so both clients show the same
/// invented hospital, the same people and the same behaviour.
///
/// It answers in the shapes of docs/openapi/atria.yaml and keeps bookings,
/// cancellations, queue tickets, time off and the rest in memory. Every name is
/// invented, and every phone number is a fictional 555-01xx or +237 6000 number.
/// Hospital time is UTC+1 all year (Africa/Douala has no daylight saving).
library;

import 'dart:convert';
import 'dart:math' as math;

import '../api/api.dart';
import '../generated/hospital.dart';

const _offset = Duration(hours: 1);
const _day = Duration(days: 1);
const _grid = 10;

List<Map<String, dynamic>> _list(Object? v) => (v as List? ?? const []).cast<Map<String, dynamic>>();

/// An instant as the API writes it: whole seconds, Z.
String iso(DateTime instant) {
  final u = instant.toUtc();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${u.year.toString().padLeft(4, '0')}-${two(u.month)}-${two(u.day)}T${two(u.hour)}:${two(u.minute)}:${two(u.second)}Z';
}

/// yyyy-mm-dd of an instant on the clinic's calendar.
String clinicDate(Object instant) {
  final at = instant is DateTime ? instant : DateTime.parse('$instant');
  return iso(at.toUtc().add(_offset)).substring(0, 10);
}

String _shiftDate(String date, int days) => clinicDate(DateTime.parse('${date}T12:00:00Z').add(_day * days));

/// 0 for Monday, as opening hours are keyed.
int _weekday(String date) => DateTime.parse('${date}T12:00:00Z').weekday - 1;

/// A clinic-local wall time, days from today, as a UTC instant.
DateTime _local(num daysFromToday, int hour, [int minute = 0]) {
  final now = DateTime.now().toUtc().add(_offset);
  return DateTime.utc(now.year, now.month, now.day + daysFromToday.toInt(), hour, minute).subtract(_offset);
}

String _fold(String text) => text.toLowerCase().replaceAll(RegExp('[^a-z0-9 ]'), '').trim();

class MockHospital {
  MockHospital() {
    _build();
  }

  final _random = math.Random();

  late final List<Map<String, dynamic>> clinics;
  late final List<Map<String, dynamic>> clinicians;
  late final List<Map<String, dynamic>> types;

  /// Intake forms (atria.data.intake), each at version 1, and the care
  /// context patients have given (services/booking/care.py), in memory.
  late final List<Map<String, dynamic>> intakeForms = [
    for (final f in _list(hospitalSpec['intakeForms']))
      {
        'intakeFormId': f['intakeFormId'],
        'name': f['name'],
        'version': 1,
        'fields': jsonDecode(jsonEncode(f['fields'])),
      },
  ];
  final careContexts = <String, Map<String, dynamic>>{};

  Map<String, dynamic>? formOf(Object? typeId) {
    final id = types.where((t) => t['appointmentTypeId'] == typeId).firstOrNull?['intakeFormId'];
    return intakeForms.where((f) => f['intakeFormId'] == id).firstOrNull;
  }

  late final Map<String, dynamic> tenant;
  late final List<Map<String, dynamic>> feeBands;
  final regionPack = {
    'code': 'CM',
    'currency': 'XAF',
    'dialCode': '+237',
    'languages': ['fr', 'en'],
    'timezone': 'Africa/Douala',
    'allowsRatingFeeLink': false,
  };

  /// The people on the staff side's lists. Invented, like everything here.
  final Map<String, Map<String, String?>> patients = {
    'pp-preview': {'givenName': 'Amina', 'familyName': 'Ngo'},
    'pp-tagne': {'givenName': 'Brice', 'familyName': 'Tagne'},
    'pp-ekambi': {'givenName': 'Chantal', 'familyName': 'Ekambi'},
    'pp-foka': {'givenName': 'Didier', 'familyName': 'Foka'},
    'pp-nana': {'givenName': 'Estelle', 'familyName': 'Nana'},
    'pp-mvondo': {'givenName': 'Fabrice', 'familyName': 'Mvondo'},
    'pp-atangana': {'givenName': 'Gisele', 'familyName': 'Atangana'},
    'pp-kamga': {'givenName': 'Herve', 'familyName': 'Kamga'},
    'pp-beyala': {'givenName': 'Ines', 'familyName': 'Beyala'},
    'pp-essomba': {'givenName': 'Joel', 'familyName': 'Essomba'},
  };

  late final List<Map<String, dynamic>> register;
  var _registerNext = 300;
  final List<Map<String, dynamic>> sessions = [];
  final List<Map<String, dynamic>> _todayQueue = [];
  late final List<Map<String, dynamic>> requests;
  final List<Map<String, dynamic>> appointments = [];
  final Map<String, Map<String, dynamic>> _availability = {};
  var _sequence = 4821;
  var _conflictShown = false;
  late final List<Map<String, dynamic>> _audit;

  void _build() {
    final spec = hospitalSpec;
    final hospital = spec['hospital'] as Map<String, dynamic>;
    final units = _list(spec['units']);
    const blocks = 'ABCD';
    const lines = ['blue', 'green', 'yellow', 'red'];
    clinics = [
      for (var i = 0; i < units.length; i++)
        {
          'clinicId': units[i]['clinicId'],
          'name': units[i]['name'],
          'address': hospital['address'],
          'phone': '+1 202 555 01${(47 + i).toString().padLeft(2, '0')}',
          'description': units[i]['description'],
          'services': [...units[i]['services'] as List],
          'openingHours': Map<String, dynamic>.of(units[i]['openingHours'] as Map<String, dynamic>),
          // An invented site plan: blocks A to D around the main gate, three
          // units a block, so the hospital map has something to draw.
          'location': {
            'building': 'Block ${blocks[(i ~/ 3) % 4]}',
            'floor': i % 3 == 0 ? 'Ground floor' : (i % 3 == 1 ? 'First floor' : 'Ground floor, east wing'),
            'directions':
                'From the main gate, follow the ${lines[(i ~/ 3) % 4]} line to Block ${blocks[(i ~/ 3) % 4]}.',
            'lat': (4.1532 + ((i ~/ 3) % 2) * 0.0011 - (i % 3) * 0.00022).toStringAsFixed(6),
            'lng': (9.2406 + (i ~/ 6) * 0.0014 + (i % 3) * 0.00035).toStringAsFixed(6),
          },
        },
    ];
    String band(int year) {
      final years = DateTime.now().toUtc().year - year;
      return years >= 20 ? 'SENIOR' : (years >= 10 ? 'EXPERIENCED' : (years >= 3 ? 'ESTABLISHED' : 'RECENT'));
    }

    clinicians = [
      for (final c in _list(spec['clinicians']))
        {
          'clinicianProfileId': 's-${(c['familyName'] as String).toLowerCase()}',
          'clinicId': c['clinicId'],
          'givenName': c['givenName'],
          'familyName': c['familyName'],
          'specialty': c['specialty'],
          'qualifications': <String>[],
          'registrationYear': c['registrationYear'],
          'seniorityBand': band(c['registrationYear'] as int),
          'languages': [...c['languages'] as List],
        },
    ];
    types = [
      for (final t in _list(spec['appointmentTypes']))
        {
          'appointmentTypeId': t['appointmentTypeId'],
          'code': t['code'],
          'name': t['name'],
          'serviceLine': t['serviceLine'],
          'durationUnits': t['durationUnits'],
          'bufferUnits': t['bufferUnits'],
          'bookableBy': t['bookableBy'],
          'patientRequestable': t['patientRequestable'] ?? false,
          'clinicIds': t['clinicIds'] == null ? null : [...t['clinicIds'] as List],
          'feeBandId': t['feeBandId'],
          'intakeFormId': t['intakeFormId'],
          'minNoticeMinutes': 30,
          'maxAdvanceDays': 60,
          'cancellationWindowMinutes': 1440,
          'active': true,
        },
    ];
    final settings = spec['tenantSettings'] as Map<String, dynamic>;
    tenant = {
      'tenantId': 't-cm-001',
      'name': hospital['name'],
      'regionPackCode': 'CM',
      ...settings,
      'languages': [...settings['languages'] as List],
      'firstAppointmentAt': '2026-09-19T08:12:40Z',
    };
    feeBands = [
      for (final b in _list(spec['feeBands']))
        {...b, 'scheduleReference': 'Atria fair rates, 2026-09-26', 'effectiveFrom': '2026-09-26'},
    ];

    final ids = patients.keys.toList();
    register = [
      for (var i = 0; i < ids.length; i++)
        {
          'patientProfileId': ids[i],
          ...patients[ids[i]]!,
          'phoneE164': '+1202555${1100 + i * 7}',
          'patientNumber': 'RHB-${(120 + i * 13).toString().padLeft(6, '0')}',
          'dateOfBirth':
              '${1958 + ((i * 7) % 60)}-${(1 + (i % 12)).toString().padLeft(2, '0')}-${(3 + i).toString().padLeft(2, '0')}',
          'email': i == 0 ? 'amina.ngo@example.com' : null,
          'preferredLanguage': i % 3 == 0 ? 'fr' : 'en',
          'hasAccount': i.isEven,
          'phoneVerified': i.isEven,
          'emailVerified': i == 0,
          'source': i.isEven ? 'SELF' : 'DESK',
          'createdAt': '2026-09-19T08:12:40Z',
        },
    ];

    // Sessions and the outpatient queue: this morning and afternoon, and the week ahead.
    for (var d = 0; d < 7; d++) {
      final date = clinicDate(DateTime.now().toUtc().add(_day * d));
      final weekday = _weekday(date);
      // Sundays are closed, except today, so the demo always has a queue to show.
      if (weekday == 6 && d > 0) continue;
      final spans = weekday == 5 ? [('08:00', '12:00', 2)] : [('07:30', '12:00', 3), ('13:00', '16:30', 2)];
      for (final (start, end, rostered) in spans) {
        final hours = (_minutes(end) - _minutes(start)) / 60;
        sessions.add({
          'sessionId': 'se-$date-${start.replaceAll(':', '')}',
          'clinicId': 'u-rhb-opd',
          'sessionDate': date,
          'startTime': start,
          'endTime': end,
          'rosteredClinicianCount': rostered,
          'expectedThroughputPerHour': '4.5',
          'actualThroughputPerHour': null,
          'capacity': (hours * rostered * 4.5).floor(),
          'issuedTickets': d == 0 ? 14 : math.max(0, 9 - d * 2),
          'status': d == 0 && start == '07:30' ? 'RUNNING' : 'OPEN',
        });
      }
    }
    final names = patients.keys.toList();
    final first = sessions.firstOrNull;
    if (first != null) {
      for (var n = 1; n <= (first['issuedTickets'] as int); n++) {
        final window = _sessionStart(first).add(Duration(minutes: (n - 1) * 13 - 10));
        _todayQueue.add({
          'appointmentId': 'a-q$n',
          'reference': 'APT-Q${1000 + n}',
          'tenantId': 't-cm-001',
          'clinicId': 'u-rhb-opd',
          'patientProfileId': names[n % names.length],
          'appointmentTypeId': 'at-gen-consult',
          'clinicianProfileId': n <= 3 ? ['s-mbua', 's-nkwelle', 's-fomum'][n - 1] : null,
          'sessionId': first['sessionId'],
          'position': n,
          'startAt': iso(window),
          'endAt': iso(window.add(const Duration(minutes: 30))),
          'arrivalWindowStart': iso(window),
          'arrivalWindowEnd': iso(window.add(const Duration(minutes: 30))),
          'state': n <= 2 ? 'COMPLETED' : (n == 3 ? 'IN_CONSULTATION' : (n <= 5 ? 'ARRIVED' : 'BOOKED')),
          'channel': n % 3 == 0 ? 'WALK_IN' : 'ONLINE',
          'bookedByRole': n % 3 == 0 ? 'RECEPTIONIST' : null,
          'version': 1,
          'createdAt': iso(DateTime.now().toUtc().subtract(Duration(hours: n))),
        });
      }
    }

    // Procedure requests waiting in the surgical unit's inbox.
    final asked = [
      ('pp-kamga', 'at-minor-proc', 'A cyst on my left wrist, getting bigger'),
      ('pp-beyala', 'at-minor-proc', 'Ingrown toenail, referred by Muea health centre'),
      ('pp-essomba', 'at-major-proc', 'Hernia review the GP asked for'),
    ];
    requests = [
      for (var i = 0; i < asked.length; i++)
        {
          'appointmentId': 'a-r$i',
          'reference': 'APT-R${2000 + i}',
          'tenantId': 't-cm-001',
          'clinicId': 'u-rhb-surgery',
          'patientProfileId': asked[i].$1,
          'appointmentTypeId': asked[i].$2,
          'clinicianProfileId': null,
          'sessionId': null,
          'startAt': iso(DateTime.now().toUtc().subtract(_day * (i + 1))),
          'endAt': iso(DateTime.now().toUtc().subtract(_day * (i + 1))),
          'state': 'REQUESTED',
          'channel': 'ONLINE',
          'requestNote': asked[i].$3,
          'version': 1,
          'createdAt': iso(DateTime.now().toUtc().subtract(_day * (i + 1))),
        },
    ];

    const desk = (role: 'RECEPTIONIST', channel: 'WALK_IN');
    void add(
      String clinician,
      String type,
      DateTime start,
      String state,
      num createdDaysAgo, {
      String? patient,
      ({String role, String channel})? by,
      String? channel,
    }) => appointments.add(
      _appointment(
        clinician,
        type,
        start,
        state,
        createdDaysAgo,
        patient: patient,
        bookedByRole: by?.role,
        channel: channel ?? by?.channel,
      ),
    );
    // The patient demo's own visits.
    add('s-mbarga', 'at-spec-first', _local(2, 10), 'BOOKED', 1);
    add('s-bello', 'at-spec-follow', _local(8, 14, 20), 'BOOKED', 3);
    // Leave took this one away, so the patient is asked to choose again.
    add('s-tchoupo', 'at-spec-first', _local(4, 9), 'DISRUPTED', 6);
    add('s-nkoulou', 'at-spec-first', _local(-20, 9), 'COMPLETED', 27);
    add('s-fonkou', 'at-spec-first', _local(-5, 11, 30), 'PATIENT_CANCELLED', 12);
    // A day at the Medical Unit, for the staff side.
    add('s-tabi', 'at-spec-follow', _local(0, 8, 30), 'BOOKED', 3, patient: 'pp-tagne');
    add('s-nkoulou', 'at-spec-first', _local(0, 9), 'BOOKED', 10, patient: 'pp-ekambi');
    add('s-bello', 'at-spec-follow', _local(0, 9, 40), 'PATIENT_CANCELLED', 5, patient: 'pp-foka');
    add('s-tabi', 'at-spec-first', _local(0, 10, 30), 'BOOKED', 2, patient: 'pp-nana', by: desk);
    add(
      's-nkoulou',
      'at-spec-follow',
      _local(0, 11, 20),
      'BOOKED',
      .5,
      patient: 'pp-mvondo',
      by: desk,
      channel: 'PHONE',
    );
    add('s-bello', 'at-spec-first', _local(0, 13, 30), 'BOOKED', 6, patient: 'pp-atangana');
    add('s-tabi', 'at-spec-follow', _local(0, 14, 20), 'CLINIC_CANCELLED', 4, patient: 'pp-kamga');
    add('s-nkoulou', 'at-spec-first', _local(0, 15), 'BOOKED', 1, patient: 'pp-beyala');
    add('s-bello', 'at-spec-follow', _local(0, 16, 10), 'BOOKED', 2, patient: 'pp-essomba', by: desk);
    add('s-tabi', 'at-spec-follow', _local(1, 9, 20), 'BOOKED', 4, patient: 'pp-ekambi');
    add('s-nkoulou', 'at-spec-first', _local(1, 11), 'BOOKED', 2, patient: 'pp-foka');
    add('s-bello', 'at-spec-first', _local(1, 14), 'BOOKED', 3, patient: 'pp-nana', by: desk);
    add('s-tabi', 'at-spec-first', _local(-1, 10), 'BOOKED', 6, patient: 'pp-beyala');
    add('s-nkoulou', 'at-spec-follow', _local(-1, 15, 30), 'BOOKED', 3, patient: 'pp-tagne');
    add('s-tabi', 'at-spec-follow', _local(3, 8, 40), 'BOOKED', 2, patient: 'pp-atangana');
    add('s-bello', 'at-spec-first', _local(4, 10, 20), 'BOOKED', 1, patient: 'pp-kamga', by: desk);

    _audit = _auditEntries();
  }

  static int _minutes(String clock) => int.parse(clock.substring(0, 2)) * 60 + int.parse(clock.substring(3, 5));

  static DateTime _sessionStart(Map<String, dynamic> s) =>
      DateTime.parse('${s['sessionDate']}T${s['startTime']}:00Z').subtract(_offset);

  Map<String, dynamic> _appointment(
    String clinician,
    String type,
    DateTime start,
    String state,
    num createdDaysAgo, {
    String? patient,
    String? bookedByRole,
    String? channel,
  }) {
    final clinic = clinicians.where((c) => c['clinicianProfileId'] == clinician).firstOrNull?['clinicId'];
    final units = types.where((t) => t['appointmentTypeId'] == type).firstOrNull?['durationUnits'] as int? ?? 3;
    _sequence += 137;
    return {
      'appointmentId': 'a-$_sequence',
      'reference': 'APT-$_sequence',
      'tenantId': 't-cm-001',
      'clinicId': clinic,
      'patientProfileId': patient ?? 'pp-preview',
      'appointmentTypeId': type,
      'clinicianProfileId': clinician,
      'sessionId': null,
      'startAt': iso(start),
      'endAt': iso(start.add(Duration(minutes: units * _grid))),
      'state': state,
      'channel': channel ?? 'WEB',
      'bookedByPersonId': 'p-preview',
      'bookedByRole': bookedByRole ?? 'PATIENT',
      'referralId': null,
      'careContextId': null,
      'version': 1,
      'createdAt': iso(DateTime.now().toUtc().subtract(Duration(minutes: (createdDaysAgo * 24 * 60).round()))),
    };
  }

  Map<String, dynamic> _named(Iterable<Map<String, dynamic>> found) => {
    for (final a in found)
      '${a['patientProfileId']}': patients['${a['patientProfileId']}'] ?? {'givenName': null, 'familyName': null},
  };

  static int _byStart(Map<String, dynamic> a, Map<String, dynamic> b) => '${a['startAt']}'.compareTo('${b['startAt']}');

  /// A few starts each day look taken, the same ones every time.
  static bool _looksTaken(String clinician, DateTime start) {
    var hash = 0;
    for (final unit in '$clinician${start.millisecondsSinceEpoch}'.codeUnits) {
      hash = (hash * 31 + unit).toSigned(32);
    }
    return hash.abs() % 5 == 0;
  }

  List<Map<String, String>> freeStarts(String clinicianId, String date, String typeId) {
    final clinician = clinicians.where((c) => c['clinicianProfileId'] == clinicianId).firstOrNull;
    final clinic = clinics.where((c) => c['clinicId'] == clinician?['clinicId']).firstOrNull;
    final type = types.where((t) => t['appointmentTypeId'] == typeId).firstOrNull;
    if (clinician == null || clinic == null || type == null) return [];
    final hours = (clinic['openingHours'] as Map)['${_weekday(date)}'] as Map?;
    if (hours == null) return [];
    DateTime at(String clock) =>
        DateTime.parse('${date}T00:00:00Z').add(Duration(minutes: _minutes(clock))).subtract(_offset);
    final units = type['durationUnits'] as int? ?? 0;
    if (units == 0) return [];
    final held = Duration(minutes: (units + (type['bufferUnits'] as int? ?? 0)) * _grid);
    final slots = <Map<String, String>>[];
    final notice = DateTime.now().toUtc().add(Duration(minutes: type['minNoticeMinutes'] as int? ?? 0));
    for (
      var start = at(hours['start'] as String);
      !start.add(held).isAfter(at(hours['end'] as String));
      start = start.add(const Duration(minutes: _grid * 3))
    ) {
      if (start.isBefore(notice)) continue;
      if (_looksTaken(clinicianId, start)) continue;
      final clash = appointments.any(
        (a) =>
            a['clinicianProfileId'] == clinicianId &&
            a['state'] == 'BOOKED' &&
            DateTime.parse('${a['startAt']}').difference(start).abs() < held,
      );
      if (clash) continue;
      slots.add({'startAt': iso(start), 'endAt': iso(start.add(Duration(minutes: units * _grid)))});
    }
    return slots;
  }

  Map<String, dynamic> _sessionView(Map<String, dynamic> s) => {
    ...s,
    'remaining': math.max(0, (s['capacity'] as int) - (s['issuedTickets'] as int)),
    'partOfDay': int.parse((s['startTime'] as String).substring(0, 2)) < 12 ? 'MORNING' : 'AFTERNOON',
  };

  Map<String, dynamic> _settingsOverview() => {
    'tenant': {
      ...tenant,
      'regionPackLocked': tenant['firstAppointmentAt'] != null,
      'lockReason': tenant['firstAppointmentAt'] != null
          ? 'Locked since the first appointment on 19 September 2026. Bookings were made against this pack\'s currency, phone rules and clock.'
          : null,
    },
    'regionPack': regionPack,
    'clinics': clinics,
    'appointmentTypes': types,
    'feeBands': feeBands,
  };

  String _hex(int length) => List.generate(length, (_) => _random.nextInt(16).toRadixString(16)).join();

  Never _fail(int status, String code, String message, [Map<String, dynamic>? detail]) =>
      throw ApiError(status, sentence(message), code, detail);

  /// Answers one call. [patientSide] mirrors the web preview's check of its own
  /// path: a patient is not offered a session whose hours are over.
  Map<String, dynamic> answer(
    String method,
    String path,
    Object? body, {
    required bool patientSide,
    List<String> staffRoles = const [],
  }) {
    final url = Uri.parse(path);
    final p = url.path;
    final q = url.queryParameters;
    final b = body is Map ? body.cast<String, dynamic>() : const <String, dynamic>{};
    RegExpMatch? match(String pattern) => RegExp(pattern).firstMatch(p);

    if (method == 'GET' && p == '/clinicians') return {'clinicians': clinicians, 'count': clinicians.length};
    if (method == 'GET' && p == '/clinics') return {'clinics': clinics, 'count': clinics.length};
    if (method == 'GET' && p == '/appointment-types') {
      final withForms = [
        for (final t in types) {...t, 'intakeForm': formOf(t['appointmentTypeId'])},
      ];
      return {'gridUnitMinutes': _grid, 'appointmentTypes': withForms, 'count': types.length};
    }
    if (method == 'GET' && p == '/patients/me/appointments') {
      final mine = appointments.where((a) => a['patientProfileId'] == 'pp-preview').toList();
      return {'when': 'all', 'count': mine.length, 'appointments': mine};
    }

    final day = match(r'^/clinics/([^/]+)/day$');
    if (method == 'GET' && day != null) {
      final unit = day.group(1);
      if (q['from'] != null) {
        final from = q['from']!, to = q['to'] ?? from;
        final found = appointments.where((a) {
          final d = clinicDate(a['startAt'] as String);
          return a['clinicId'] == unit && d.compareTo(from) >= 0 && d.compareTo(to) <= 0;
        }).toList()..sort(_byStart);
        return {
          'clinicId': unit,
          'from': from,
          'to': to,
          'timezone': 'Africa/Douala',
          'count': found.length,
          'appointments': found,
          'patients': _named(found),
        };
      }
      final date = q['date'] ?? clinicDate(DateTime.now());
      final found =
          appointments.where((a) => a['clinicId'] == unit && clinicDate(a['startAt'] as String) == date).toList()
            ..sort(_byStart);
      return {
        'clinicId': unit,
        'date': date,
        'timezone': 'Africa/Douala',
        'count': found.length,
        'appointments': found,
        'patients': _named(found),
      };
    }

    final calendar = match(r'^/clinicians/([^/]+)/calendar$');
    if (method == 'GET' && calendar != null) {
      final id = calendar.group(1);
      final from = q['from'] ?? clinicDate(DateTime.now()), to = q['to'] ?? from;
      final found = appointments.where((a) {
        final d = clinicDate(a['startAt'] as String);
        return a['clinicianProfileId'] == id && d.compareTo(from) >= 0 && d.compareTo(to) <= 0;
      }).toList()..sort(_byStart);
      return {
        'clinicianProfileId': id,
        'clinicId': clinicians.where((c) => c['clinicianProfileId'] == id).firstOrNull?['clinicId'],
        'from': from,
        'to': to,
        'timezone': 'Africa/Douala',
        'count': found.length,
        'appointments': found,
        'patients': _named(found),
      };
    }

    final slots = match(r'^/clinicians/([^/]+)/slots$');
    if (method == 'GET' && slots != null) {
      final id = slots.group(1)!, typeId = q['typeId'] ?? '';
      if (q['from'] != null) {
        final from = q['from']!, to = q['to'] ?? from;
        final days = <String, dynamic>{};
        for (var date = from; date.compareTo(to) <= 0; date = _shiftDate(date, 1)) {
          days[date] = freeStarts(id, date, typeId);
        }
        return {
          'clinicianProfileId': id,
          'from': from,
          'to': to,
          'appointmentTypeId': typeId,
          'gridUnitMinutes': _grid,
          'days': days,
        };
      }
      final date = q['date'] ?? '';
      return {
        'clinicianProfileId': id,
        'date': date,
        'appointmentTypeId': typeId,
        'gridUnitMinutes': _grid,
        'slots': freeStarts(id, date, typeId),
      };
    }

    // Care context (services/booking/care.py): the patient and the assigned
    // clinician read it; the desk, managers and administrators are refused;
    // only the patient changes it, while the visit is still ahead.
    final care = match(r'^/appointments/([^/]+)/care-context$');
    if (care != null) {
      final id = care.group(1)!;
      final found = appointments.where((a) => a['appointmentId'] == id).firstOrNull;
      if (found == null) _fail(404, 'not_found', 'no such appointment');
      if (!patientSide && !staffRoles.contains('CLINICIAN')) {
        _fail(403, 'forbidden', 'that action is not permitted for this account');
      }
      final form = formOf(found['appointmentTypeId']);
      final open =
          const ['BOOKED', 'CONFIRMED', 'RESCHEDULED', 'DISRUPTED'].contains(found['state']) &&
          DateTime.parse(found['startAt'] as String).isAfter(DateTime.now());
      if (method == 'PUT') {
        if (!patientSide) _fail(403, 'forbidden', 'only the patient changes their answers');
        if (form == null) _fail(400, 'invalid_request', 'this visit asks no questions');
        if (b['consent'] != true) _fail(400, 'invalid_request', 'sharing answers needs your consent');
        final answers = (b['answers'] as Map? ?? const {}).cast<String, dynamic>();
        for (final f in _list(form['fields'])) {
          final given = answers[f['id']];
          if (f['required'] == true && (given == null || given == '')) {
            _fail(400, 'invalid_request', 'please answer: ${f['label']}');
          }
        }
        careContexts[id] = {
          'answers': answers,
          'submittedAt': DateTime.now().toUtc().toIso8601String(),
          'formVersion': form['version'],
        };
      }
      final held = careContexts[id];
      return {
        'appointmentId': id,
        'patientProfileId': found['patientProfileId'],
        'form': form,
        'answers': held?['answers'],
        'submittedAt': held?['submittedAt'],
        'editable': patientSide && open && form != null,
      };
    }

    final one = match(r'^/appointments/([^/]+)$');
    if (one != null) {
      final found = [...appointments, ..._todayQueue].where((a) => a['appointmentId'] == one.group(1)).firstOrNull;
      if (found == null) _fail(404, 'not_found', 'no such appointment');
      if (method == 'GET') {
        // The ledger entry once closed, and what cancelling now would record.
        final type = types.where((t) => t['appointmentTypeId'] == found['appointmentTypeId']).firstOrNull;
        final band = feeBands.where((b) => b['feeBandId'] == type?['feeBandId']).firstOrNull;
        const closed = ['COMPLETED', 'NO_SHOW', 'PATIENT_CANCELLED', 'CLINIC_CANCELLED'];
        final start = DateTime.parse(found['startAt'] as String);
        final late = start.difference(DateTime.now()).inMinutes / 60 < 24;
        final state = found['state'];
        return {
          ...found,
          'ledger': closed.contains(state)
              ? {
                  'feeBandId': band?['feeBandId'],
                  'practice': band?['practice'],
                  'amountMinor': band?['baseAmountMinor'],
                  'currency': 'XAF',
                  'outcome': state == 'COMPLETED'
                      ? 'ATTENDED'
                      : state == 'NO_SHOW'
                      ? 'NO_SHOW'
                      : state == 'CLINIC_CANCELLED'
                      ? 'CLINIC_CANCELLED'
                      : 'CANCELLED_IN_WINDOW',
                  'entitlement': state == 'COMPLETED' || state == 'NO_SHOW' ? 'NONE' : 'FULL',
                  'settledAt': null,
                }
              : null,
          'cancellationPreview': const ['BOOKED', 'CONFIRMED', 'RESCHEDULED', 'DISRUPTED'].contains(state)
              ? {
                  'outcome': late ? 'CANCELLED_LATE' : 'CANCELLED_IN_WINDOW',
                  'entitlement': late ? 'PARTIAL' : 'FULL',
                  'amountMinor': band?['baseAmountMinor'],
                  'currency': 'XAF',
                  'freeUntil': iso(start.subtract(const Duration(hours: 24))),
                }
              : null,
        };
      }
      if (method == 'DELETE') {
        final late = DateTime.parse(found['startAt'] as String).difference(DateTime.now()) < _day;
        final byClinic = '${b['cancelledBy'] ?? ''}'.toUpperCase() == 'CLINIC';
        found['state'] = byClinic ? 'CLINIC_CANCELLED' : 'PATIENT_CANCELLED';
        found['version'] = (found['version'] as int? ?? 1) + 1;
        if (found['sessionId'] != null) {
          final session = sessions.where((s) => s['sessionId'] == found['sessionId']).firstOrNull;
          if (session != null) session['issuedTickets'] = math.max(0, (session['issuedTickets'] as int) - 1);
        }
        return {
          ...found,
          'outcome': byClinic ? 'CLINIC_CANCELLED' : (late ? 'CANCELLED_LATE' : 'CANCELLED_IN_WINDOW'),
          'entitlement': byClinic || !late ? 'FULL' : 'PARTIAL',
          'note': 'The time is free again. Nothing is settled; the entitlement is a record.',
        };
      }
    }

    // A clinician's hours and time off, kept in memory.
    final avail = match(r'^/clinicians/([^/]+)/(availability|hours|time-off)(?:/([^/]+))?$');
    if (avail != null) {
      final id = avail.group(1)!;
      final held = _availability.putIfAbsent(
        id,
        () => {'hours': <String, dynamic>{}, 'timeOff': <Map<String, dynamic>>[]},
      );
      final hours = held['hours'] as Map<String, dynamic>;
      final timeOff = held['timeOff'] as List<Map<String, dynamic>>;
      if (method == 'GET' && avail.group(2) == 'availability') {
        return {
          'clinicianProfileId': id,
          'usesUnitHours': hours.isEmpty,
          'hours': hours,
          'unitHours': {
            for (var d = 0; d < 5; d++) '$d': {'start': '08:00', 'end': '16:00'},
          },
          'timeOff': timeOff,
        };
      }
      if (method == 'PUT' && avail.group(2) == 'hours') {
        final days = (b['days'] as Map? ?? const {}).cast<String, dynamic>();
        hours
          ..clear()
          ..addAll({
            for (final e in days.entries)
              if (e.value != null) e.key: e.value,
          });
        return {'clinicianProfileId': id, 'usesUnitHours': false, 'hours': hours};
      }
      if (method == 'POST' && avail.group(2) == 'time-off') {
        final item = {
          'groupId': 'x-${DateTime.now().millisecondsSinceEpoch}',
          'kind': b['kind'],
          'from': b['from'] ?? b['date'],
          'to': b['to'] ?? b['date'],
          'startTime': b['startTime'],
          'endTime': b['endTime'],
          'reason': b['reason'],
        };
        timeOff.add(item);
        return {...item, 'disrupted': <Object>[]};
      }
      if (method == 'DELETE' && avail.group(2) == 'time-off') {
        timeOff.removeWhere((t) => t['groupId'] == avail.group(3));
        return {'groupId': avail.group(3)};
      }
    }

    // What happens after booking, without the rules' fine print.
    final acted = match(r'^/appointments/([^/]+)/(reschedule|confirm|arrive|start|complete|no-show)$');
    if (method == 'POST' && acted != null) {
      final found = [...appointments, ..._todayQueue].where((a) => a['appointmentId'] == acted.group(1)).firstOrNull;
      if (found == null) _fail(404, 'not_found', 'no such appointment');
      const next = {
        'reschedule': 'RESCHEDULED',
        'confirm': 'CONFIRMED',
        'arrive': 'ARRIVED',
        'start': 'IN_CONSULTATION',
        'complete': 'COMPLETED',
        'no-show': 'NO_SHOW',
      };
      if (acted.group(2) == 'reschedule') {
        final startAt = '${b['startAt'] ?? ''}';
        final length = DateTime.parse(found['endAt'] as String).difference(DateTime.parse(found['startAt'] as String));
        found['startAt'] = startAt;
        found['endAt'] = iso(DateTime.parse(startAt).add(length));
      }
      found['state'] = next[acted.group(2)];
      found['version'] = (found['version'] as int? ?? 1) + 1;
      return found;
    }

    final unitSessions = match(r'^/clinics/([^/]+)/sessions$');
    if (unitSessions != null && method == 'GET') {
      final hospitalNow = iso(DateTime.now().toUtc().add(_offset)).substring(0, 16);
      bool open(Map<String, dynamic> s) =>
          !patientSide || '${s['sessionDate']}T${s['endTime']}'.compareTo(hospitalNow) > 0;
      return {
        'clinicId': unitSessions.group(1),
        'sessions': sessions.where((s) => s['clinicId'] == unitSessions.group(1) && open(s)).map(_sessionView).toList(),
      };
    }
    if (unitSessions != null && method == 'POST') {
      final start = b['startTime'] as String, end = b['endTime'] as String;
      final rostered = b['rosteredClinicianCount'] as int;
      final hours = (_minutes(end) - _minutes(start)) / 60;
      final created = {
        'sessionId': 'se-${b['date']}-${start.replaceAll(':', '')}-${_hex(4)}',
        'clinicId': unitSessions.group(1),
        'sessionDate': b['date'],
        'startTime': start,
        'endTime': end,
        'rosteredClinicianCount': rostered,
        'expectedThroughputPerHour': '4.5',
        'actualThroughputPerHour': null,
        'capacity': (hours * rostered * 4.5).floor(),
        'issuedTickets': 0,
        'status': 'OPEN',
      };
      sessions
        ..add(created)
        ..sort((a, b) => '${a['sessionDate']}${a['startTime']}'.compareTo('${b['sessionDate']}${b['startTime']}'));
      return _sessionView(created);
    }

    final oneSession = match(r'^/sessions/([^/]+)(?:/(tickets|queue|next|close))?$');
    if (oneSession != null) {
      final session = sessions.where((s) => s['sessionId'] == oneSession.group(1)).firstOrNull;
      if (session == null) _fail(404, 'not_found', 'no such session');
      final tickets = [..._todayQueue, ...appointments].where((a) => a['sessionId'] == session['sessionId']).toList();
      final part = oneSession.group(2);
      if (method == 'GET' && part == null) return _sessionView(session);
      if (method == 'GET' && part == 'queue') {
        int count(List<String> states) => tickets.where((t) => states.contains(t['state'])).length;
        return {
          ..._sessionView(session),
          'appointments': tickets,
          'patients': patients,
          'waiting': count(['BOOKED', 'CONFIRMED']),
          'arrived': count(['ARRIVED']),
          'inConsultation': count(['IN_CONSULTATION']),
          'seen': count(['COMPLETED']),
          'plannedPerHour': 4.5 * (session['rosteredClinicianCount'] as int),
          'actualPerHour': 11.2,
        };
      }
      if (method == 'POST' && part == 'tickets') {
        session['issuedTickets'] = (session['issuedTickets'] as int) + 1;
        final n = session['issuedTickets'] as int;
        final desk = b['patientProfileId'] != null;
        final window = _arrival(session, n);
        final made = {
          'appointmentId': 'a-t${_hex(6)}',
          'reference': 'APT-T${3000 + n}',
          'tenantId': 't-cm-001',
          'clinicId': session['clinicId'],
          'patientProfileId': b['patientProfileId'] ?? 'pp-preview',
          'appointmentTypeId': 'at-gen-consult',
          'clinicianProfileId': null,
          'sessionId': session['sessionId'],
          'position': n,
          'startAt': iso(window),
          'endAt': iso(window.add(const Duration(minutes: 30))),
          'arrivalWindowStart': iso(window),
          'arrivalWindowEnd': iso(window.add(const Duration(minutes: 30))),
          'state': 'BOOKED',
          'channel': desk ? (b['channel'] ?? 'WALK_IN') : 'ONLINE',
          'bookedByRole': desk ? 'RECEPTIONIST' : null,
          'version': 1,
          'createdAt': iso(DateTime.now()),
        };
        appointments.add(made);
        return {...made, 'of': n};
      }
      if (method == 'POST' && part == 'next') {
        final next = tickets.where((t) => t['state'] == 'ARRIVED').firstOrNull;
        if (next == null) _fail(409, 'conflict', 'nobody who has arrived is waiting');
        next['state'] = 'IN_CONSULTATION';
        next['clinicianProfileId'] = b['clinicianProfileId'] ?? 's-mbua';
        return next;
      }
      if (method == 'POST' && part == 'close') {
        session['status'] = 'CLOSED';
        session['actualThroughputPerHour'] = '3.8';
        return _sessionView(session);
      }
    }

    final inbox = match(r'^/clinics/([^/]+)/requests$');
    if (method == 'GET' && inbox != null) {
      final waiting = requests.where((r) => r['clinicId'] == inbox.group(1) && r['state'] == 'REQUESTED').toList();
      return {'clinicId': inbox.group(1), 'count': waiting.length, 'appointments': waiting, 'patients': patients};
    }
    if (method == 'POST' && p == '/procedure-requests') {
      final now = iso(DateTime.now());
      final note = '${b['note'] ?? ''}';
      final made = {
        'appointmentId': 'a-r${_hex(6)}',
        'reference': 'APT-R${_random.nextInt(9000) + 1000}',
        'tenantId': 't-cm-001',
        'clinicId': b['clinicId'],
        'patientProfileId': 'pp-preview',
        'appointmentTypeId': b['appointmentTypeId'],
        'clinicianProfileId': null,
        'sessionId': null,
        'startAt': now,
        'endAt': now,
        'state': 'REQUESTED',
        'channel': 'ONLINE',
        'requestNote': note.isEmpty ? null : note,
        'version': 1,
        'createdAt': now,
      };
      appointments.add(made);
      requests.add(made);
      return made;
    }
    final decided = match(r'^/appointments/([^/]+)/(place|decline)$');
    if (method == 'POST' && decided != null) {
      final found = requests.where((r) => r['appointmentId'] == decided.group(1)).firstOrNull;
      if (found == null) _fail(404, 'not_found', 'no such request');
      if (decided.group(2) == 'decline') {
        final reason = b['reason'] as String?;
        if (reason == null || reason.isEmpty) _fail(400, 'invalid_request', 'a reason is required to decline');
        found
          ..['state'] = 'DECLINED'
          ..['declineReason'] = reason;
      } else {
        found
          ..['state'] = 'BOOKED'
          ..['clinicianProfileId'] = b['clinicianProfileId']
          ..['startAt'] = b['startAt']
          ..['endAt'] = b['startAt'];
      }
      return found;
    }

    // The unit's message log, failures first. Fictional numbers only.
    final unitMessages = match(r'^/clinics/([^/]+)/messages$');
    if (method == 'GET' && unitMessages != null) {
      final day = q['day'] ?? clinicDate(DateTime.now());
      const kinds = [
        'APPOINTMENT_REMINDER',
        'BOOKING_CONFIRMATION',
        'APPOINTMENT_REMINDER',
        'BOOKING_RESCHEDULED',
        'BOOKING_CANCELLATION',
      ];
      final seed = int.parse(day.substring(day.length - 2));
      final unit = appointments.where((a) => a['clinicId'] == unitMessages.group(1)).take(14).toList();
      final rows = [
        for (var i = 0; i < unit.length; i++)
          () {
            final a = unit[i];
            final channel = i % 3 == 1 ? 'EMAIL' : 'SMS';
            final failed = (i + seed) % 5 == 0;
            final bounced = channel == 'EMAIL' && (i + seed) % 7 == 3;
            final state = failed || bounced ? 'FAILED' : (i % 4 == 2 ? 'SENT' : 'DELIVERED');
            final name = patients['${a['patientProfileId']}'] ?? {'givenName': null, 'familyName': null};
            final phone = '+2376000001${i.toString().padLeft(2, '0')}';
            final named = [name['givenName'], name['familyName']].whereType<String>().join(' ');
            return <String, dynamic>{
              'messageLogId': 'ml-$day-$i',
              'appointmentId': a['appointmentId'],
              'kind': kinds[i % kinds.length],
              'channel': channel,
              'recipient': channel == 'SMS' ? phone : 'patient@atria.invalid',
              'deliveryState': state,
              'feedback': bounced ? 'BOUNCE' : null,
              'failureReason': failed ? (channel == 'SMS' ? 'Phone is unreachable' : 'Mailbox full') : null,
              'settledAt':
                  '${day}T${(7 + (i % 10)).toString().padLeft(2, '0')}:${((i * 7) % 60).toString().padLeft(2, '0')}:00Z',
              'reportedAt': null,
              'person': {'name': named.isEmpty ? null : named, 'phoneE164': phone},
              'visit': {'startAt': a['startAt'], 'state': a['state'], 'patientProfileId': a['patientProfileId']},
            };
          }(),
      ];
      rows.sort((x, y) {
        final failed = (y['deliveryState'] == 'FAILED' ? 1 : 0) - (x['deliveryState'] == 'FAILED' ? 1 : 0);
        return failed != 0 ? failed : '${y['settledAt']}'.compareTo('${x['settledAt']}');
      });
      final counts = <String, int>{};
      for (final r in rows) {
        counts.update(r['deliveryState'] as String, (n) => n + 1, ifAbsent: () => 1);
      }
      return {
        'clinicId': unitMessages.group(1),
        'clinicName': clinics.where((c) => c['clinicId'] == unitMessages.group(1)).firstOrNull?['name'],
        'day': day,
        'counts': counts,
        'messages': rows,
      };
    }

    final unitReport = match(r'^/clinics/([^/]+)/report$');
    if (method == 'GET' && (unitReport != null || p == '/reports')) {
      final week = q['week'] ?? clinicDate(DateTime.now());
      if (unitReport != null) {
        final index = clinics.indexWhere((c) => c['clinicId'] == unitReport.group(1));
        return {
          'clinicId': unitReport.group(1),
          'clinicName': index < 0 ? null : clinics[index]['name'],
          'week': week,
          'to': week,
          'firstDay': '2026-09-19',
          ..._figures(math.max(0, index)),
        };
      }
      final units = [
        for (var i = 0; i < clinics.length; i++)
          {
            'clinicId': clinics[i]['clinicId'],
            'clinicName': clinics[i]['name'],
            'week': week,
            'to': week,
            'firstDay': '2026-09-19',
            ..._figures(i),
          },
      ];
      int sum(String key) => units.fold(0, (n, u) => n + (u[key] as int));
      return {
        'week': week,
        'to': week,
        'firstDay': '2026-09-19',
        'units': units,
        'booked': sum('booked'),
        'attended': sum('attended'),
        'noShow': sum('noShow'),
        'cancelled': sum('cancelled'),
        'lateCancelled': sum('lateCancelled'),
      };
    }

    if (method == 'GET' && p == '/patients') {
      final text = (q['q'] ?? '').trim();
      if (text.isEmpty) {
        return {'q': text, 'count': register.length, 'nextCursor': null, 'results': register.reversed.toList()};
      }
      final digits = text.replaceAll(RegExp(r'[\s().-]'), '');
      final found = register.where((r) {
        if (RegExp(r'^\+?\d{4,}$').hasMatch(digits)) {
          return '${r['phoneE164']}'.contains(digits.replaceFirst('+', ''));
        }
        if (RegExp(r'^[a-z]{1,4}-?\d{2,}$', caseSensitive: false).hasMatch(text)) {
          return '${r['patientNumber']}'
              .replaceAll('-', '')
              .toLowerCase()
              .startsWith(text.replaceAll('-', '').toLowerCase());
        }
        return _fold('${r['familyName']} ${r['givenName']}').startsWith(_fold(text)) ||
            _fold('${r['givenName']} ${r['familyName']}').startsWith(_fold(text));
      }).toList();
      return {'q': text, 'count': found.length, 'results': found.take(20).toList()};
    }
    if (method == 'POST' && p == '/patients') {
      final phone = b['phoneE164'] as String;
      final shared = register.where((r) => r['phoneE164'] == phone).toList();
      if (shared.isNotEmpty && b['sameNumberConfirmed'] != true) {
        _fail(409, 'conflict', 'a patient already has that number', {'patients': shared});
      }
      _registerNext++;
      final entry = {
        'patientProfileId': 'pp-desk-$_registerNext',
        'givenName': b['givenName'],
        'familyName': b['familyName'],
        'phoneE164': phone,
        'patientNumber': 'RHB-${_registerNext.toString().padLeft(6, '0')}',
        'dateOfBirth': b['dateOfBirth'],
        'email': null,
        'preferredLanguage': 'en',
        'hasAccount': false,
        'phoneVerified': false,
        'emailVerified': false,
        'source': 'DESK',
        'createdAt': iso(DateTime.now()),
      };
      register.add(entry);
      patients[entry['patientProfileId'] as String] = {
        'givenName': b['givenName'] as String?,
        'familyName': b['familyName'] as String?,
      };
      return entry;
    }
    final record = match(r'^/patients/([^/]+)$');
    if (method == 'GET' && record != null && record.group(1) != 'me') {
      final found = register.where((r) => r['patientProfileId'] == record.group(1)).firstOrNull;
      if (found == null) _fail(404, 'not_found', 'no such patient');
      final visits = appointments.where((a) => a['patientProfileId'] == found['patientProfileId']).toList()
        ..sort((a, b) => '${b['startAt']}'.compareTo('${a['startAt']}'));
      return {...found, 'visitScope': 'clinic', 'appointments': visits};
    }

    final roster = match(r'^/clinics/([^/]+)/roster$');
    if (method == 'GET' && roster != null) {
      final date = q['date'] ?? clinicDate(DateTime.now());
      final unit = clinics.where((c) => c['clinicId'] == roster.group(1)).firstOrNull;
      final hours = (unit?['openingHours'] as Map?)?['${_weekday(date)}'] as Map?;
      final now = iso(DateTime.now().toUtc().add(_offset)).substring(11, 16);
      final today = date == clinicDate(DateTime.now());
      final mine = clinicians.where((c) => c['clinicId'] == roster.group(1)).toList();
      final rows = [
        for (var i = 0; i < mine.length; i++)
          () {
            final c = mine[i];
            final visits =
                appointments
                    .where(
                      (a) =>
                          a['clinicianProfileId'] == c['clinicianProfileId'] &&
                          clinicDate(a['startAt'] as String) == date &&
                          a['state'] != 'PATIENT_CANCELLED',
                    )
                    .length +
                (i * 3) % 7;
            final leave = hours != null && i == 2;
            final start = hours?['start'] as String?, end = hours?['end'] as String?;
            final status = hours == null
                ? 'OFF'
                : leave
                ? 'LEAVE'
                : !today
                ? 'SCHEDULED'
                : now.compareTo(start!) < 0
                ? 'LATER'
                : now.compareTo(end!) < 0
                ? 'ON_SHIFT'
                : 'FINISHED';
            final working = hours == null ? 0 : (_minutes(end!) - _minutes(start!)) ~/ 60 * 60;
            return <String, dynamic>{
              'clinicianProfileId': c['clinicianProfileId'],
              'givenName': c['givenName'],
              'familyName': c['familyName'],
              'specialty': c['specialty'],
              'status': status,
              'startsAt': start,
              'endsAt': end,
              'timeOff': hours == null
                  ? <Object>[]
                  : leave
                  ? [
                      {'kind': 'LEAVE', 'startTime': null, 'endTime': null},
                    ]
                  : i == 1
                  ? [
                      {'kind': 'BLOCK', 'startTime': '12:00', 'endTime': '13:00'},
                    ]
                  : <Object>[],
              'visits': leave || hours == null ? 0 : visits,
              'bookedMinutes': leave || hours == null ? 0 : visits * 30,
              'workingMinutes': leave ? 0 : working,
              'load': leave || working == 0 ? null : math.min(1, visits * 30 / working),
            };
          }(),
      ];
      return {
        'clinicId': roster.group(1),
        'date': date,
        'clinicians': rows,
        'onShift': rows.where((r) => r['status'] == 'ON_SHIFT').length,
      };
    }

    if (method == 'GET' && p == '/audit/changes') {
      final week = q['week'] ?? clinicDate(DateTime.now());
      final inWeek = _audit
          .where(
            (e) =>
                (e['action'] == 'appointment.cancel' || e['action'] == 'appointment.reschedule') &&
                (e['occurredAt'] as String).substring(0, 10).compareTo(week) >= 0,
          )
          .toList();
      final groups = <String, Map<String, dynamic>>{};
      for (final e in inWeek) {
        final g = groups.putIfAbsent(
          e['actorPersonId'] as String,
          () => {
            'actorPersonId': e['actorPersonId'],
            'actorName': e['actorName'],
            'actorRole': e['actorRole'],
            'cancellations': 0,
            'reschedules': 0,
            'flagged': 0,
            'changes': <Map<String, dynamic>>[],
          },
        );
        if (e['action'] == 'appointment.cancel') {
          g['cancellations'] = (g['cancellations'] as int) + 1;
        } else {
          g['reschedules'] = (g['reschedules'] as int) + 1;
        }
        if ((e['flags'] as List).isNotEmpty) g['flagged'] = (g['flagged'] as int) + 1;
        (g['changes'] as List).add({
          'auditEntryId': e['auditEntryId'],
          'occurredAt': e['occurredAt'],
          'action': e['action'],
          'appointmentId': 'a-4958',
          'reason': e['reason'],
          'flags': e['flags'],
        });
      }
      final actors = groups.values.toList()..sort((a, b) => (b['flagged'] as int) - (a['flagged'] as int));
      return {
        'week': week,
        'to': week,
        'actors': actors,
        'total': inWeek.length,
        'flagged': inWeek.where((e) => (e['flags'] as List).isNotEmpty).length,
      };
    }

    if (method == 'GET' && p == '/audit') {
      final (reachable, chosen) = _auditSelection(q);
      final limit = int.tryParse(q['limit'] ?? '') ?? 50;
      final offset = int.tryParse(q['cursor'] ?? '') ?? 0;
      final actors = <String, Map<String, dynamic>>{
        for (final e in reachable)
          e['actorPersonId'] as String: {
            'personId': e['actorPersonId'],
            'name': e['actorName'],
            'role': e['actorRole'],
          },
      }.values.toList()..sort((a, b) => '${a['name']}'.compareTo('${b['name']}'));
      return {
        'from': q['from'],
        'to': q['to'],
        'count': chosen.length,
        'nextCursor': offset + limit < chosen.length ? '${offset + limit}' : null,
        'entries': chosen.skip(offset).take(limit).toList(),
        'actors': actors,
        'actions': {for (final e in reachable) e['action'] as String}.toList()..sort(),
      };
    }

    if (method == 'POST' && p == '/appointments') return book(b);
    if (p == '/admin/settings' && method == 'GET') return _settingsOverview();

    _fail(404, 'not_found', 'the demo has no $method $p');
  }

  /// The audit log as CSV (GET /audit/export), for saving to a file.
  String auditCsv(String path) {
    final (_, chosen) = _auditSelection(Uri.parse(path).queryParameters);
    String cell(Object? v) => '"${'${v ?? ''}'.replaceAll('"', '""')}"';
    return [
      'occurredAt,actor,actorRole,action,kind,subjectType,subjectId,clinicId,patientProfileIds,reason,flags,ip',
      for (final e in chosen)
        [
          e['occurredAt'],
          e['actorName'],
          e['actorRole'],
          e['action'],
          e['kind'],
          e['subjectType'],
          e['subjectId'],
          e['clinicId'],
          '',
          e['reason'],
          (e['flags'] as List).join(' '),
          (e['source'] as Map)['ip'],
        ].map(cell).join(','),
    ].join('\r\n');
  }

  /// When a numbered ticket's arrival window opens, as core/queue.py works it
  /// out: after those still waiting, counted from now once the session has
  /// begun, ten minutes early on a round five minutes.
  DateTime _arrival(Map<String, dynamic> session, int position) {
    final open = _sessionStart(session);
    final rate = 4.5 * (session['rosteredClinicianCount'] as int);
    final now = DateTime.now().toUtc();
    final begin = now.isAfter(open) ? now : open;
    final seen = now.isAfter(open) ? (now.difference(open).inMinutes / 60 * rate).floor() : 0;
    final ahead = math.max(0, position - 1 - seen);
    final turn = begin.add(Duration(minutes: (ahead * 60 / rate).round())).subtract(const Duration(minutes: 10));
    return DateTime.utc(turn.year, turn.month, turn.day, turn.hour, turn.minute - turn.minute % 5);
  }

  Map<String, dynamic> _figures(int seed) {
    final booked = 40 + ((seed * 17) % 60);
    final attended = (booked * .71).round();
    final noShow = (booked * .09).round();
    final cancelled = (booked * .08).round();
    final late = (booked * .04).round();
    int r(num v) => v.round();
    return {
      'booked': booked,
      'attended': attended,
      'noShow': noShow,
      'cancelled': cancelled,
      'lateCancelled': late,
      'open': booked - attended - noShow - cancelled - late,
      'attendance': (attended / (attended + noShow) * 1000).round() / 1000,
      'byChannel': [
        {
          'channel': 'ONLINE',
          'booked': r(booked * .55),
          'attended': r(attended * .56),
          'noShow': r(noShow * .6),
          'attendance': .87,
        },
        {'channel': 'WALK_IN', 'booked': r(booked * .25), 'attended': r(attended * .27), 'noShow': 0, 'attendance': 1},
        {
          'channel': 'PHONE',
          'booked': r(booked * .15),
          'attended': r(attended * .13),
          'noShow': r(noShow * .3),
          'attendance': .8,
        },
        {
          'channel': 'REFERRAL',
          'booked': r(booked * .05),
          'attended': r(attended * .04),
          'noShow': r(noShow * .1),
          'attendance': .75,
        },
      ],
      'byReminder': [
        {
          'reminder': 'SENT',
          'booked': r(booked * .7),
          'attended': r(attended * .76),
          'noShow': r(noShow * .4),
          'attendance': .94,
        },
        {
          'reminder': 'FAILED',
          'booked': r(booked * .05),
          'attended': r(attended * .04),
          'noShow': r(noShow * .2),
          'attendance': .6,
        },
        {
          'reminder': 'NOT_SENT',
          'booked': r(booked * .25),
          'attended': r(attended * .2),
          'noShow': r(noShow * .4),
          'attendance': .78,
        },
      ],
      'ledger': {
        'entries': attended + noShow + cancelled + late,
        'currency': 'XAF',
        'byEntitlement': [
          {'entitlement': 'FULL', 'entries': cancelled, 'amountMinor': cancelled * 5000},
          {'entitlement': 'NONE', 'entries': attended + noShow, 'amountMinor': (attended + noShow) * 3500},
          {'entitlement': 'PARTIAL', 'entries': late, 'amountMinor': late * 5000},
        ],
        'byBand': [
          {'practice': 'Specialist, first visit', 'entries': r(attended * .5), 'amountMinor': r(attended * .5) * 5000},
          {'practice': 'Specialist, follow-up', 'entries': r(attended * .35), 'amountMinor': r(attended * .35) * 3000},
          {'practice': 'General consultation', 'entries': r(attended * .15), 'amountMinor': r(attended * .15) * 1500},
        ],
      },
    };
  }

  // The audit log: a spread of the last ten days, by the demo's own staff.
  List<Map<String, dynamic>> _auditEntries() {
    const actors = [
      ('p-desk', 'Nadine Fotso', 'RECEPTIONIST', 'u-rhb-medicine'),
      ('p-nkoulou', 'Jean-Paul Nkoulou', 'CLINICIAN', 'u-rhb-medicine'),
      ('p-manager', 'Rodrigue Owona', 'CLINIC_MANAGER', 'u-rhb-medicine'),
      ('p-admin', 'Sandrine Eyenga', 'TENANT_ADMIN', null),
    ];
    const kinds = [
      ('schedule.day', 'READ', 'CLINIC', 9, null),
      ('appointment.read', 'READ', 'APPOINTMENT', 1, null),
      ('appointment.arrive', 'WRITE', 'APPOINTMENT', 1, null),
      ('appointment.reschedule', 'WRITE', 'APPOINTMENT', 1, 'Patient asked for the afternoon'),
      ('appointment.cancel', 'WRITE', 'APPOINTMENT', 1, 'Clinician called away'),
      ('schedule.calendar', 'READ', 'CLINICIAN', 6, null),
      ('availability.time_off', 'WRITE', 'CLINICIAN', 0, 'Conference in Douala'),
      ('staff.update_roles', 'WRITE', 'STAFF', 0, null),
    ];
    final now = DateTime.now().toUtc();
    return [
      for (var i = 0; i < 64; i++)
        () {
          final actor = actors[i % 3 == 2 && i % 9 == 8 ? 3 : i % 3];
          final kind = kinds[(i * 5) % kinds.length];
          return <String, dynamic>{
            'auditEntryId': 'au-$i',
            'occurredAt': iso(now.subtract(Duration(minutes: (i * 3.6 * 60).round() + 7))),
            'actorPersonId': actor.$1,
            'actorName': actor.$2,
            'actorRole': actor.$3,
            'action': kind.$1,
            'kind': kind.$2,
            'subjectType': kind.$3,
            'subjectId': '${kind.$3.toLowerCase()}-$i',
            'clinicId': actor.$4 ?? 'u-rhb-opd',
            'patientCount': kind.$4,
            'reason': kind.$5,
            'flags': i == 4 ? ['POTENTIAL_SELF_BENEFIT'] : <String>[],
            'source': {'ip': '196.202.${10 + (i % 4)}.${20 + (i % 7)}'},
          };
        }(),
    ];
  }

  (List<Map<String, dynamic>>, List<Map<String, dynamic>>) _auditSelection(Map<String, String> q) {
    final from = q['from'] ?? '0000';
    final to = '${q['to'] ?? '9999'}T23:59:59Z';
    final actor = q['actor'], action = q['action'], kind = q['kind'];
    final reachable = _audit.where((e) {
      final at = e['occurredAt'] as String;
      return at.compareTo(from) >= 0 && at.compareTo(to) <= 0;
    }).toList();
    final chosen = reachable
        .where(
          (e) =>
              (actor == null || e['actorPersonId'] == actor) &&
              (action == null || e['action'] == action) &&
              (kind == null || e['kind'] == kind),
        )
        .toList();
    return (reachable, chosen);
  }

  /// What deleting the account does to the visits (services/booking/
  /// appointments.py cancel_ahead): every visit still ahead is called off, and
  /// a queue place until its window closes. Returns how many.
  int cancelAhead(String patientProfileId) {
    final now = DateTime.now().toUtc();
    var done = 0;
    for (final v in appointments.where((a) => a['patientProfileId'] == patientProfileId)) {
      if (!const ['BOOKED', 'CONFIRMED', 'RESCHEDULED', 'DISRUPTED', 'REQUESTED'].contains(v['state'])) continue;
      final ticket = v['sessionId'] != null;
      final ends = DateTime.parse(v['endAt'] as String), starts = DateTime.parse(v['startAt'] as String);
      if ((ticket && ends.isBefore(now)) || (!ticket && !starts.isAfter(now))) continue;
      v['state'] = 'PATIENT_CANCELLED';
      done++;
    }
    return done;
  }

  /// A booking, as POST /appointments makes it: refused when the time is not
  /// free, and once, for a nine o'clock start, as if just taken, so the
  /// conflict screen can be seen.
  Map<String, dynamic> book(Map<String, dynamic> b) {
    final startAt = b['startAt'] as String;
    final date = clinicDate(startAt);
    final free = freeStarts(
      b['clinicianProfileId'] as String,
      date,
      b['appointmentTypeId'] as String,
    ).any((s) => s['startAt'] == startAt);
    if (!free || (startAt.endsWith('09:00:00Z') && !_conflictShown)) {
      _conflictShown = true;
      _fail(409, 'conflict', 'that time has just been taken');
    }
    final patient = b['patientProfileId'] as String?;
    final made = _appointment(
      b['clinicianProfileId'] as String,
      b['appointmentTypeId'] as String,
      DateTime.parse(startAt),
      'BOOKED',
      0,
      patient: patient,
      bookedByRole: patient == null ? null : 'RECEPTIONIST',
      channel: patient == null ? null : b['channel'] as String?,
    );
    appointments.add(made);
    final intake = (b['intake'] as Map?)?.cast<String, dynamic>();
    if (intake?['consent'] == true) {
      careContexts[made['appointmentId'] as String] = {
        'answers': (intake!['answers'] as Map? ?? const {}).cast<String, dynamic>(),
        'submittedAt': DateTime.now().toUtc().toIso8601String(),
        'formVersion': 1,
      };
      return {...made, 'careContext': 'SAVED'};
    }
    return made;
  }

  /// Pretty JSON, for debugging a demo answer.
  static String show(Object value) => const JsonEncoder.withIndent('  ').convert(value);
}
