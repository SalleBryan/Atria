import 'package:atria/patient/data.dart';
import 'package:flutter_test/flutter_test.dart';

Appointment visit(String id, {String? sessionId, String state = 'BOOKED'}) => Appointment({
  'appointmentId': id,
  'clinicId': 'u-opd',
  'startAt': '2026-09-24T11:50:00Z',
  'endAt': '2026-09-24T12:20:00Z',
  'state': state,
  'sessionId': ?sessionId,
});

void main() {
  final now = DateTime.utc(2026, 9, 24, 12);

  test('a queue place stays ahead until its arrival window closes', () {
    final list = [visit('place', sessionId: 'se-1'), visit('visit')];
    expect(upcoming(list, now).map((a) => a.id), ['place']);
    expect(past(list, now).map((a) => a.id), ['visit']);
  });

  test('a place given up is not ahead', () {
    final list = [visit('place', sessionId: 'se-1', state: 'PATIENT_CANCELLED')];
    expect(upcoming(list, now), isEmpty);
  });
}
