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
  String get name => 'Dr ${[givenName, familyName].whereType<String>().join(' ')}';
}

class Clinic {
  Clinic(this.raw);
  final Map<String, dynamic> raw;
  String get id => raw['clinicId'] as String;
  String get name => raw['name'] as String? ?? '';
  String? get address => raw['address'] as String?;
}

class AppointmentType {
  AppointmentType(this.raw);
  final Map<String, dynamic> raw;
  String get id => raw['appointmentTypeId'] as String;
  String? get code => raw['code'] as String?;
  String get name => raw['name'] as String? ?? '';
  String get serviceLine => raw['serviceLine'] as String? ?? '';
  int? get durationUnits => raw['durationUnits'] as int?;
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
  PatientData({required this.appointments, required this.clinicians, required this.clinics, required this.types})
    : bookable = clinicians.where((c) => specialistTypes(types, c.clinicId).isNotEmpty).toList();

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
      ]);
      state = DataReady(
        PatientData(
          appointments: results[0].map(Appointment.new).toList(),
          clinicians: results[1].map(Clinician.new).toList(),
          clinics: results[2].map(Clinic.new).toList(),
          types: results[3].map(AppointmentType.new).toList(),
        ),
      );
    } on ApiError catch (e) {
      state = DataFailed(e.message);
    }
    notifyListeners();
  }
}

const activeStates = ['BOOKED', 'CONFIRMED', 'RESCHEDULED', 'DISRUPTED'];

/// Booked and still ahead, soonest first; a request is ahead until placed.
List<Appointment> upcoming(List<Appointment> all, [DateTime? now]) {
  final at = now ?? DateTime.now();
  return all.where((a) => a.state == 'REQUESTED' || (activeStates.contains(a.state) && a.startAt.isAfter(at))).toList()
    ..sort((a, b) => a.startAt.compareTo(b.startAt));
}

/// Everything already behind, most recent first.
List<Appointment> past(List<Appointment> all, [DateTime? now]) {
  final at = now ?? DateTime.now();
  return all.where((a) => a.state != 'REQUESTED' && !a.startAt.isAfter(at)).toList()
    ..sort((a, b) => b.startAt.compareTo(a.startAt));
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

  static String greeting([DateTime? now]) {
    final hour = local(now ?? DateTime.now()).hour;
    return hour < 12 ? 'Good morning' : (hour < 18 ? 'Good afternoon' : 'Good evening');
  }
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
