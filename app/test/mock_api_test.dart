import 'package:atria/api/api.dart';
import 'package:atria/demo/mock_api.dart';
import 'package:flutter_test/flutter_test.dart';

/// The demo's stand-in API answers every call the screens make, in the
/// shapes the real one does, so a workflow in the demo never stops on a cast.
void main() {
  late MockHospital h;
  Map<String, dynamic> get(String path, {bool patient = false}) => h.answer('GET', path, null, patientSide: patient);
  Map<String, dynamic> post(String path, Object body) => h.answer('POST', path, body, patientSide: false);
  final today = clinicDate(DateTime.now());

  setUp(() => h = MockHospital());

  test('the directory, units and types', () {
    expect((get('/clinicians')['clinicians'] as List), isNotEmpty);
    expect((get('/clinics')['clinics'] as List), hasLength(11));
    expect(get('/appointment-types')['gridUnitMinutes'], 10);
    expect((get('/patients/me/appointments')['appointments'] as List), hasLength(5));
  });

  test('a unit day, a range, and a clinician calendar', () {
    expect((get('/clinics/u-rhb-medicine/day?date=$today')['appointments'] as List), isNotEmpty);
    expect(get('/clinics/u-rhb-medicine/day?from=$today&to=$today')['patients'], isA<Map<String, dynamic>>());
    expect(get('/clinicians/s-nkoulou/calendar?from=$today&to=$today')['clinicId'], 'u-rhb-medicine');
  });

  test('free times, a booking and the conflict once', () {
    final week = get(
      '/clinicians/s-mbarga/slots?from=$today&to=${clinicDate(DateTime.now().add(const Duration(days: 6)))}&typeId=at-spec-first',
    );
    final days = (week['days'] as Map).values.expand((d) => d as List).cast<Map>().toList();
    expect(days, isNotEmpty);
    final slot = days.firstWhere((s) => !(s['startAt'] as String).endsWith('09:00:00Z'));
    final made = post('/appointments', {
      'clinicianProfileId': 's-mbarga',
      'appointmentTypeId': 'at-spec-first',
      'startAt': slot['startAt'],
    });
    expect(made['state'], 'BOOKED');
    expect(
      () => post('/appointments', {
        'clinicianProfileId': 's-mbarga',
        'appointmentTypeId': 'at-spec-first',
        'startAt': slot['startAt'],
      }),
      throwsA(isA<ApiError>().having((e) => e.status, 'status', 409)),
    );
  });

  test('a visit read, moved and cancelled', () {
    final id = (get('/patients/me/appointments')['appointments'] as List).first['appointmentId'];
    expect(get('/appointments/$id')['cancellationPreview'], isNotNull);
    expect(
      h.answer('DELETE', '/appointments/$id', {'reason': 'Other: travel'}, patientSide: true)['state'],
      'PATIENT_CANCELLED',
    );
    expect(get('/appointments/$id')['ledger'], isNotNull);
  });

  test('sessions, a ticket, the queue, next and close', () {
    final sessions = get('/clinics/u-rhb-opd/sessions')['sessions'] as List;
    final id = sessions.first['sessionId'];
    final ticket = post('/sessions/$id/tickets', {'patientProfileId': 'pp-tagne', 'channel': 'WALK_IN'});
    expect(ticket['of'], 15);
    final queue = get('/sessions/$id/queue');
    expect(queue['arrived'], 2);
    expect(post('/sessions/$id/next', {'clinicianProfileId': 's-mbua'})['state'], 'IN_CONSULTATION');
    expect(post('/sessions/$id/close', {})['status'], 'CLOSED');
    expect(
      post('/clinics/u-rhb-opd/sessions', {
        'date': today,
        'startTime': '17:00',
        'endTime': '19:00',
        'rosteredClinicianCount': 2,
      })['capacity'],
      18,
    );
  });

  test('procedure requests asked for, placed and declined', () {
    expect((get('/clinics/u-rhb-surgery/requests')['appointments'] as List), hasLength(3));
    final made = post('/procedure-requests', {
      'appointmentTypeId': 'at-minor-proc',
      'clinicId': 'u-rhb-surgery',
      'note': 'A lump',
    });
    expect(made['state'], 'REQUESTED');
    expect(post('/appointments/a-r0/decline', {'reason': 'Seen elsewhere'})['state'], 'DECLINED');
    expect(
      post('/appointments/a-r1/place', {'clinicianProfileId': 's-ekane', 'startAt': '2026-10-02T09:00:00Z'})['state'],
      'BOOKED',
    );
  });

  test('messages, reports, roster, register and audit', () {
    expect(get('/clinics/u-rhb-medicine/messages?day=$today')['counts'], isA<Map>());
    expect(get('/clinics/u-rhb-medicine/report?week=$today')['byChannel'], hasLength(4));
    expect((get('/reports?week=$today')['units'] as List), hasLength(11));
    expect((get('/clinics/u-rhb-medicine/roster?date=$today')['clinicians'] as List), isNotEmpty);
    expect(get('/patients?q=tag')['count'], 1);
    expect(get('/patients?q=RHB-000120')['count'], 1);
    expect(
      () => post('/patients', {'givenName': 'A', 'familyName': 'B', 'phoneE164': '+12025551100'}),
      throwsA(isA<ApiError>().having((e) => e.detail, 'detail', isNotNull)),
    );
    expect(post('/patients', {'givenName': 'A', 'familyName': 'B', 'phoneE164': '+12025559999'})['source'], 'DESK');
    expect(get('/patients/pp-tagne')['appointments'], isNotEmpty);
    expect(get('/audit?limit=20')['entries'], hasLength(20));
    expect(get('/audit/changes?week=2026-01-01')['actors'], isNotEmpty);
    expect(h.auditCsv('/audit/export'), startsWith('occurredAt,'));
  });

  test('availability, hours and time off', () {
    expect(get('/clinicians/s-nkoulou/availability')['usesUnitHours'], isTrue);
    h.answer('PUT', '/clinicians/s-nkoulou/hours', {
      'days': {
        '0': {'start': '09:00', 'end': '13:00'},
        '1': null,
      },
    }, patientSide: false);
    final off = post('/clinicians/s-nkoulou/time-off', {
      'kind': 'LEAVE',
      'from': today,
      'to': today,
      'reason': 'Course',
    });
    expect((get('/clinicians/s-nkoulou/availability')['timeOff'] as List), hasLength(1));
    h.answer('DELETE', '/clinicians/s-nkoulou/time-off/${off['groupId']}', null, patientSide: false);
    expect((get('/clinicians/s-nkoulou/availability')['timeOff'] as List), isEmpty);
  });

  test('deleting an account calls off what is ahead', () {
    expect(h.cancelAhead('pp-preview'), 3);
  });
}
