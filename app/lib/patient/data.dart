import 'package:flutter/foundation.dart';

import '../api/api.dart';
import '../theme/tokens.dart';

import 'package:flutter/painting.dart';

/// What the patient screens read, loaded once and joined, as
/// web/src/patient/data.tsx does: the visits with the directory, the units and
/// the appointment types, so every screen shows names rather than ids.
class Appointment {
  Appointment(this.raw);
  final Map<String, dynamic> raw;
  String get id => raw['appointmentId'] as String;
  String get reference => raw['reference'] as String? ?? '';
  String get clinicId => raw['clinicId'] as String? ?? '';
  String get typeId => raw['appointmentTypeId'] as String? ?? '';
  String? get clinicianId => raw['clinicianProfileId'] as String?;
  DateTime get startAt => DateTime.parse(raw['startAt'] as String);
  DateTime get endAt => DateTime.parse(raw['endAt'] as String);
  DateTime get createdAt => DateTime.tryParse(raw['createdAt'] as String? ?? '') ?? startAt;
  String get state => raw['state'] as String? ?? '';
  String? get sessionId => raw['sessionId'] as String?;
  int? get position => raw['position'] as int?;
  String? get patientId => raw['patientProfileId'] as String?;
  String? get channel => raw['channel'] as String?;
  String? get bookedByRole => raw['bookedByRole'] as String?;
  int get version => raw['version'] as int? ?? 1;

  /// A queue ticket's arrival window (FR-BKG-11).
  DateTime? get arrivalWindowStart => DateTime.tryParse(raw['arrivalWindowStart'] as String? ?? '');
  DateTime? get arrivalWindowEnd => DateTime.tryParse(raw['arrivalWindowEnd'] as String? ?? '');

  /// A procedure request: what was asked, and why it was declined (FR-BKG-14).
  String? get requestNote => raw['requestNote'] as String?;
  String? get declineReason => raw['declineReason'] as String?;
}

class Clinician {
  Clinician(this.raw);
  final Map<String, dynamic> raw;
  String get id => raw['clinicianProfileId'] as String;
  String? get clinicId => raw['clinicId'] as String?;
  String? get givenName => raw['givenName'] as String?;
  String? get familyName => raw['familyName'] as String?;
  String? get specialty => raw['specialty'] as String?;
  String get seniority => raw['seniorityBand'] as String? ?? 'ESTABLISHED';
  int? get registrationYear => raw['registrationYear'] as int?;
  List<String> get languages => (raw['languages'] as List? ?? const []).cast<String>();
  String get name => 'Dr ${[givenName, familyName].whereType<String>().join(' ')}';

  /// Years on the Order's roll, as the directory frame shows it: "10y+".
  String? get experience {
    final year = registrationYear;
    if (year == null) return null;
    final years = DateTime.now().year - year;
    if (years < 1) return 'New';
    final fives = (years ~/ 5) * 5;
    return '${fives == 0 ? years : fives}y+';
  }
}

/// "Dr Esther Mbarga", or "Your clinician" when there is none yet.
String clinicianName(Clinician? c) => c?.name ?? 'Your clinician';

/// A language code, as a person reads it.
String languageName(String code) => const {'en': 'English', 'fr': 'French'}[code] ?? code.toUpperCase();

class Clinic {
  Clinic(this.raw);
  final Map<String, dynamic> raw;
  String get id => raw['clinicId'] as String;
  String get name => raw['name'] as String? ?? '';
  String? get address => raw['address'] as String?;
  String? get phone => raw['phone'] as String?;
  String? get description => raw['description'] as String?;
  List<String> get services => (raw['services'] as List? ?? const []).cast<String>();
  Map<String, dynamic>? get openingHours => raw['openingHours'] as Map<String, dynamic>?;

  /// The unit's hours on the weekday of an instant, in its own time, or null when closed.
  ({String start, String end})? hoursOn([DateTime? instant]) {
    final day = ClinicClock.local(instant ?? DateTime.now()).weekday - 1;
    final span = openingHours?['$day'] as Map?;
    return span == null ? null : (start: span['start'] as String, end: span['end'] as String);
  }

  /// Where the unit is inside its hospital (2026-09-28): building, floor,
  /// walking directions, and the entrance as decimal degrees in text.
  Map<String, dynamic>? get location => raw['location'] as Map<String, dynamic>?;
  String? get building => location?['building'] as String?;
  String? get floor => location?['floor'] as String?;
  String? get walkingDirections => location?['directions'] as String?;
  String get whereInside => [building, floor].whereType<String>().where((s) => s.isNotEmpty).join(' · ');

  /// The entrance on the map, when the hospital has placed it.
  ({double lat, double lng})? get entrance {
    final lat = double.tryParse('${location?['lat'] ?? ''}');
    final lng = double.tryParse('${location?['lng'] ?? ''}');
    return lat == null || lng == null ? null : (lat: lat, lng: lng);
  }

  /// Walking directions to the unit's own door when it is placed, so a patient
  /// is not left at the gate; otherwise a search for the unit at the hospital.
  Uri get directions {
    final door = entrance;
    if (door != null) {
      return Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${door.lat},${door.lng}&travelmode=walking');
    }
    final place = [name, address].whereType<String>().join(', ');
    return Uri.parse('https://www.google.com/maps/search/?api=1&query=${Uri.encodeQueryComponent(place)}');
  }
}

class AppointmentType {
  AppointmentType(this.raw);
  final Map<String, dynamic> raw;
  String get id => raw['appointmentTypeId'] as String;
  String? get code => raw['code'] as String?;
  String get name => raw['name'] as String? ?? '';
  String get serviceLine => raw['serviceLine'] as String? ?? '';
  int? get durationUnits => raw['durationUnits'] as int?;
  int get bufferUnits => raw['bufferUnits'] as int? ?? 0;
  String get bookableBy => raw['bookableBy'] as String? ?? 'BOTH';
  int? get minNoticeMinutes => raw['minNoticeMinutes'] as int?;
  int? get maxAdvanceDays => raw['maxAdvanceDays'] as int?;
  int? get cancellationWindowMinutes => raw['cancellationWindowMinutes'] as int?;
  bool get patientRequestable => raw['patientRequestable'] == true;
  String? get feeBandId => raw['feeBandId'] as String?;
  List<String> get clinicIds => (raw['clinicIds'] as List? ?? const []).cast<String>();

  /// Whether it can be booked at a unit (atria.core.settings.offered_at).
  bool offeredAt(String? clinicId) => clinicIds.isEmpty || (clinicId != null && clinicIds.contains(clinicId));
}

/// The specialist types a patient books at a unit, the first visit first.
List<AppointmentType> specialistTypes(List<AppointmentType> types, String? clinicId) {
  final found = types
      .where((t) => t.serviceLine == 'SPECIALIST' && t.durationUnits != null && t.offeredAt(clinicId))
      .toList();
  found.sort((a, b) => (b.code == 'SPEC_FIRST' ? 1 : 0) - (a.code == 'SPEC_FIRST' ? 1 : 0));
  return found;
}

class PatientData {
  PatientData({
    required this.appointments,
    required this.clinicians,
    required this.clinics,
    required this.types,
    this.gridUnitMinutes = 10,
  }) : bookable = clinicians.where((c) => specialistTypes(types, c.clinicId).isNotEmpty).toList();

  /// The tenant's booking grid; a type's length is its units times this.
  final int gridUnitMinutes;

  final List<Appointment> appointments;
  final List<Clinician> clinicians;

  /// Those a patient books by appointment; the outpatient doctors see the queue.
  final List<Clinician> bookable;
  final List<Clinic> clinics;
  final List<AppointmentType> types;

  Clinician? clinicianOf(Appointment a) => clinicians.where((c) => c.id == a.clinicianId).firstOrNull;
  Clinic? clinicOf(Appointment a) => clinics.where((c) => c.id == a.clinicId).firstOrNull;
  AppointmentType? typeOf(Appointment a) => types.where((t) => t.id == a.typeId).firstOrNull;
}

/// Every page of a list, joined, as the web's apiAll does.
Future<List<Map<String, dynamic>>> all(Api api, String path, String key) async {
  final items = <Map<String, dynamic>>[];
  String? cursor;
  for (var page = 0; page < 200; page++) {
    final join = path.contains('?') ? '&' : '?';
    final found = await api.get(cursor == null ? path : '$path${join}cursor=${Uri.encodeQueryComponent(cursor)}');
    items.addAll((found[key] as List? ?? const []).cast<Map<String, dynamic>>());
    cursor = found['nextCursor'] as String?;
    if (cursor == null) break;
  }
  return items;
}

sealed class DataState {
  const DataState();
}

class DataLoading extends DataState {
  const DataLoading();
}

class DataReady extends DataState {
  const DataReady(this.data);
  final PatientData data;
}

class DataFailed extends DataState {
  const DataFailed(this.message);
  final String message;
}

class PatientStore extends ChangeNotifier {
  PatientStore(this.api);
  final Api api;
  DataState state = const DataLoading();

  Future<void> reload() async {
    try {
      final results = await Future.wait([
        all(api, '/patients/me/appointments?when=all', 'appointments'),
        all(api, '/clinicians', 'clinicians'),
        all(api, '/clinics', 'clinics'),
        all(api, '/appointment-types', 'appointmentTypes'),
        api.get('/appointment-types').then((r) => [r]),
      ]);
      state = DataReady(
        PatientData(
          appointments: results[0].map(Appointment.new).toList(),
          clinicians: results[1].map(Clinician.new).toList(),
          clinics: results[2].map(Clinic.new).toList(),
          types: results[3].map(AppointmentType.new).toList(),
          gridUnitMinutes: results[4].first['gridUnitMinutes'] as int? ?? 10,
        ),
      );
    } on ApiError catch (e) {
      state = DataFailed(e.message);
    }
    notifyListeners();
  }
}

const activeStates = ['BOOKED', 'CONFIRMED', 'RESCHEDULED', 'DISRUPTED'];

/// Whether a visit is still ahead: a request holds no time yet, so it is
/// ahead until placed or declined, and a queue place stays ahead until its
/// arrival window closes, not only until it opens.
bool isAhead(Appointment a, DateTime at) =>
    a.state == 'REQUESTED' || (a.sessionId != null ? a.endAt : a.startAt).isAfter(at);

/// Booked and still ahead, soonest first.
List<Appointment> upcoming(List<Appointment> all, [DateTime? now]) {
  final at = now ?? DateTime.now();
  return all.where((a) => (a.state == 'REQUESTED' || activeStates.contains(a.state)) && isAhead(a, at)).toList()
    ..sort((a, b) => a.startAt.compareTo(b.startAt));
}

/// Everything already behind, most recent first.
List<Appointment> past(List<Appointment> all, [DateTime? now]) {
  final at = now ?? DateTime.now();
  return all.where((a) => !isAhead(a, at)).toList()..sort((a, b) => b.startAt.compareTo(a.startAt));
}

/// The clinic's clock: the region pack's timezone, Africa/Douala, which is
/// UTC+1 all year. A patient abroad still sees the time the clinic expects.
abstract final class ClinicClock {
  static const offset = Duration(hours: 1);
  static const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  static const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  static DateTime local(DateTime instant) => instant.toUtc().add(offset);
  static String two(int n) => n.toString().padLeft(2, '0');

  static String time(DateTime i) {
    final l = local(i);
    return '${two(l.hour)}:${two(l.minute)}';
  }

  /// "Tue 29 Sep", as the Rev A frames write it.
  static String day(DateTime i) {
    final l = local(i);
    return '${_weekdays[l.weekday - 1]} ${l.day} ${_months[l.month - 1]}';
  }

  static String month(DateTime i) => _months[local(i).month - 1].toUpperCase();
  static String date(DateTime i) => two(local(i).day);
  static String isoDate(DateTime i) {
    final l = local(i);
    return '${l.year}-${two(l.month)}-${two(l.day)}';
  }

  /// "Thursday 1 October 2026".
  static String long(DateTime i) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const months = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    final l = local(i);
    return '${days[l.weekday - 1]} ${l.day} ${months[l.month - 1]} ${l.year}';
  }

  static String weekday(DateTime i) => _weekdays[local(i).weekday - 1];

  /// "September 2026".
  static String monthYear(DateTime i) {
    final l = local(i);
    return '${long(i).split(' ')[2]} ${l.year}';
  }

  /// A clinic date (yyyy-mm-dd) as the instant of its local noon, for formatting.
  static DateTime onDate(String date) => DateTime.parse('${date}T11:00:00Z');

  static String shiftDate(String date, int days) => isoDate(onDate(date).add(Duration(days: days)));

  static String greeting([DateTime? now]) {
    final hour = local(now ?? DateTime.now()).hour;
    return hour < 12 ? 'Good morning' : (hour < 18 ? 'Good afternoon' : 'Good evening');
  }
}

/// "2 days", "Tomorrow", "3 h", "20 min", "Now": how long until an instant.
String until(DateTime instant, [DateTime? now]) {
  final at = now ?? DateTime.now();
  final minutes = (instant.difference(at).inSeconds / 60).round();
  final days = DateTime.parse(ClinicClock.isoDate(instant)).difference(DateTime.parse(ClinicClock.isoDate(at))).inDays;
  if (days >= 2) return '$days days';
  if (days == 1) return 'Tomorrow';
  if (minutes >= 60) return '${(minutes / 60).round()} h';
  return minutes > 0 ? '$minutes min' : 'Now';
}

String initials(String? a, String? b) =>
    [a, b].whereType<String>().where((s) => s.trim().isNotEmpty).map((s) => s.trim()[0].toUpperCase()).join();

enum Tone { confirmed, awaiting, cancelled, neutral }

/// What a patient reads for each state, as web/src/patient/data.tsx says it.
(String, Tone) stateLabel(String state) => switch (state) {
  'REQUESTED' => ('Requested', Tone.awaiting),
  'DECLINED' => ('Declined', Tone.cancelled),
  'BOOKED' || 'CONFIRMED' => ('Confirmed', Tone.confirmed),
  'RESCHEDULED' => ('Moved', Tone.confirmed),
  'DISRUPTED' => ('New time needed', Tone.awaiting),
  'ARRIVED' => ('Checked in', Tone.confirmed),
  'IN_CONSULTATION' => ('In consultation', Tone.confirmed),
  'COMPLETED' || 'AWAITING_FEEDBACK' => ('Attended', Tone.neutral),
  'CLINIC_CANCELLED' => ('Cancelled by the institution', Tone.cancelled),
  'PATIENT_CANCELLED' => ('Cancelled', Tone.cancelled),
  'NO_SHOW' => ('Missed', Tone.awaiting),
  _ => (state, Tone.neutral),
};

Color toneColour(Tone tone) => switch (tone) {
  Tone.confirmed => AtriaColors.confirmedInk,
  Tone.awaiting => AtriaColors.awaitingInk,
  Tone.cancelled => AtriaColors.cancelledInk,
  Tone.neutral => AtriaColors.ink700,
};

const seniorityLabel = {
  'SENIOR': 'Senior',
  'EXPERIENCED': 'Experienced',
  'ESTABLISHED': 'Established',
  'RECENT': 'Recently qualified',
};
