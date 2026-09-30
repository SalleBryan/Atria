import 'package:flutter/foundation.dart';

import '../api/api.dart';
import '../patient/data.dart';

/// What the staff screens read, as web/src/staff/data.tsx: the directory,
/// units and appointment types once for the console; a day or a week by the
/// screen that shows it. Who sees what is the API's decision (FR-STF-01).
class StaffDirectory {
  StaffDirectory({required this.clinicians, required this.clinics, required this.types});
  final List<Clinician> clinicians;
  final List<Clinic> clinics;
  final List<AppointmentType> types;

  Clinician? clinician(String? id) => clinicians.where((c) => c.id == id).firstOrNull;
  Clinic? clinic(String? id) => clinics.where((c) => c.id == id).firstOrNull;
  AppointmentType? type(String? id) => types.where((t) => t.id == id).firstOrNull;
}

class StaffStore extends ChangeNotifier {
  StaffStore(this.api, this.me);
  final Api api;
  final Me me;
  StaffDirectory? directory;
  String? failure;

  /// Bumped whenever a visit changes, so a list on screen loads again.
  int revision = 0;
  void changed() {
    revision++;
    notifyListeners();
  }

  Future<void> load() async {
    try {
      final r = await Future.wait([
        all(api, '/clinicians', 'clinicians'),
        all(api, '/clinics', 'clinics'),
        all(api, '/appointment-types', 'appointmentTypes'),
      ]);
      directory = StaffDirectory(
        clinicians: r[0].map(Clinician.new).toList(),
        clinics: r[1].map(Clinic.new).toList(),
        types: r[2].map(AppointmentType.new).toList(),
      );
      failure = null;
    } on ApiError catch (e) {
      failure = e.message;
    }
    notifyListeners();
  }

  StaffRole get role => roleOf(me);
  bool get ownCalendar => role == StaffRole.clinician;

  /// The unit the console works in: the staff member's own.
  String? get clinicId => me.clinicId ?? directory?.clinics.firstOrNull?.id;

  /// Whether the unit runs the outpatient queue (FR-BKG-13).
  bool get runsQueue => directory?.types.any((t) => t.serviceLine == 'GENERAL' && t.offeredAt(me.clinicId)) ?? false;

  /// Whether the unit takes procedure requests (FR-STF-15).
  bool get takesRequests =>
      (role == StaffRole.manager || role == StaffRole.clinician) &&
      (directory?.types.any((t) => t.serviceLine == 'PROCEDURE' && t.patientRequestable && t.offeredAt(me.clinicId)) ??
          false);

  /// Where the list for a span of dates comes from, for the caller's role.
  String? scheduleUrl(String from, [String? to]) {
    if (ownCalendar) return '/clinicians/${me.staffId}/calendar?from=$from&to=${to ?? from}';
    if (to == null || to == from) return '/clinics/$clinicId/day?date=$from';
    return null;
  }

  /// A schedule: one day, or several merged (a clinic's week is its days).
  Future<Schedule> schedule(String from, [String? to]) async {
    final url = scheduleUrl(from, to);
    final urls = url != null
        ? [url]
        : [for (var d = from; d.compareTo(to!) <= 0; d = ClinicClock.shiftDate(d, 1)) scheduleUrl(d)!];
    final parts = await Future.wait(urls.map((u) => _page(u)));
    final seen = <String>{};
    final appointments = [
      for (final p in parts)
        for (final a in p.appointments)
          if (seen.add(a.id)) a,
    ]..sort((a, b) => a.startAt.compareTo(b.startAt));
    return Schedule(appointments, {for (final p in parts) ...p.patients});
  }

  Future<Schedule> _page(String url) async {
    final appointments = <Appointment>[];
    final patients = <String, PatientName>{};
    String? cursor;
    for (var page = 0; page < 50; page++) {
      final join = url.contains('?') ? '&' : '?';
      final found = await api.get(cursor == null ? url : '$url${join}cursor=${Uri.encodeQueryComponent(cursor)}');
      appointments.addAll(
        (found['appointments'] as List? ?? const []).cast<Map<String, dynamic>>().map(Appointment.new),
      );
      (found['patients'] as Map? ?? const {}).forEach(
        (k, v) => patients['$k'] = PatientName((v as Map)['givenName'] as String?, v['familyName'] as String?),
      );
      cursor = found['nextCursor'] as String?;
      if (cursor == null) break;
    }
    return Schedule(appointments, patients);
  }
}

class PatientName {
  const PatientName(this.given, this.family);
  final String? given;
  final String? family;
  String get full => [given, family].whereType<String>().where((s) => s.isNotEmpty).join(' ');
  String get initials => [given, family].whereType<String>().where((s) => s.isNotEmpty).map((s) => s[0]).join();
}

class Schedule {
  const Schedule(this.appointments, this.patients);
  final List<Appointment> appointments;
  final Map<String, PatientName> patients;
  String nameOf(Appointment a) {
    final n = patients[a.patientId]?.full ?? '';
    return n.isEmpty ? 'Patient' : n;
  }
}

enum StaffRole { receptionist, clinician, manager, admin }

/// The widest view an account's roles give (web: roleOf).
StaffRole roleOf(Me me) {
  if (me.roles.contains('TENANT_ADMIN')) return StaffRole.admin;
  if (me.roles.contains('CLINIC_MANAGER')) return StaffRole.manager;
  if (me.roles.contains('RECEPTIONIST')) return StaffRole.receptionist;
  if (me.roles.contains('CLINICIAN')) return StaffRole.clinician;
  return StaffRole.receptionist;
}

const roleLabel = {
  StaffRole.receptionist: 'Front desk',
  StaffRole.clinician: 'Clinician',
  StaffRole.manager: 'Unit manager',
  StaffRole.admin: 'Administrator',
};

const cancelledStates = ['PATIENT_CANCELLED', 'CLINIC_CANCELLED', 'DECLINED'];
const scheduledStates = ['BOOKED', 'CONFIRMED', 'RESCHEDULED', 'DISRUPTED'];

enum StaffTone { booked, confirmed, awaiting, cancelled, neutral }

/// How the console words a state (web: labels.ts).
(String, StaffTone) staffState(String state) => switch (state) {
  'REQUESTED' => ('Requested', StaffTone.awaiting),
  'DECLINED' => ('Declined', StaffTone.cancelled),
  'BOOKED' => ('Confirmed', StaffTone.booked),
  'CONFIRMED' => ('Patient confirmed', StaffTone.booked),
  'RESCHEDULED' => ('Rescheduled', StaffTone.booked),
  'DISRUPTED' => ('Needs new time', StaffTone.awaiting),
  'ARRIVED' => ('Arrived', StaffTone.confirmed),
  'IN_CONSULTATION' => ('In consultation', StaffTone.confirmed),
  'COMPLETED' || 'AWAITING_FEEDBACK' => ('Attended', StaffTone.neutral),
  'CLINIC_CANCELLED' => ('Cancelled by the institution', StaffTone.cancelled),
  'PATIENT_CANCELLED' => ('Cancelled by patient', StaffTone.cancelled),
  'NO_SHOW' => ('No-show', StaffTone.awaiting),
  _ => (state, StaffTone.neutral),
};

const bookedBy = {
  'PATIENT': 'Booked by the patient',
  'RECEPTIONIST': 'Booked by the front desk',
  'CLINICIAN': 'Booked by a clinician',
  'CLINIC_MANAGER': 'Booked by the unit manager',
};

const channelLabel = {
  'ONLINE': 'Atria web',
  'WEB': 'Atria web',
  'APP': 'Atria app',
  'PHONE': 'By phone',
  'WALK_IN': 'At the desk',
  'REFERRAL': 'Referred',
};

/// Still holding its time 30 minutes after its end: was the patient there?
bool noShowDue(Appointment a, [DateTime? now]) =>
    scheduledStates.contains(a.state) && !(now ?? DateTime.now()).isBefore(a.endAt.add(const Duration(minutes: 30)));

/// When the reminder goes (24 hours ahead), if the booking left room for one.
DateTime? reminderAt(Appointment a) {
  final fires = a.startAt.subtract(const Duration(hours: 24));
  return a.createdAt.isAfter(fires) ? null : fires;
}

/// The four figures above the day.
({int booked, int ahead, int cancelled, int reminders}) tally(List<Appointment> list, [DateTime? now]) {
  final at = now ?? DateTime.now();
  final live = list.where((a) => !cancelledStates.contains(a.state)).toList();
  final active = list.where((a) => activeStates.contains(a.state));
  return (
    booked: live.length,
    ahead: active.where((a) => a.startAt.isAfter(at)).length,
    cancelled: list.length - live.length,
    reminders: active.where((a) => reminderAt(a)?.isAfter(at) ?? false).length,
  );
}

/// Monday of a clinic date's week.
String mondayOf(String date) {
  final d = DateTime.parse(date);
  return ClinicClock.shiftDate(date, -(d.weekday - 1));
}
