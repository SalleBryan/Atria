import 'package:atria/auth/auth.dart';
import 'package:atria/ui/filters.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'tour.dart';

/// The register, a record, booking for the patient, and a new patient.
void main() {
  Tour.init();

  testWidgets('staff patients', (tester) async {
    final tour = await Tour.boot(tester, email: 'n.fotso@example.com', audience: Audience.staff);
    await tour.go('/console/patients');
    await tour.shot('pat-1-list');
    await tour.tap('', finder: find.textContaining('RHB-').first);
    await tour.until(find.text('Contact'));
    await tour.shot('pat-2-record');
    await tour.tap('Book a visit');
    await tour.tap('', finder: find.byType(FilterChipButton).first);
    await tour.settle();
    await tour.shot('pat-3-book');
    await tour.scroll(500);
    await tour.tap('', finder: find.textContaining(RegExp(r'^\d\d:\d\d$')).first);
    await tour.shot('pat-4-picked');
    await tour.tap('', finder: find.textContaining(RegExp(r'^Book ')).last);
    await tour.until(find.text('Appointment'));
    await tour.shot('pat-5-booked');
    await tour.go('/console/patients');
    await tour.tap('New patient');
    await tour.type(find.byType(TextField).at(1), 'Paul');
    await tour.type(find.byType(TextField).at(2), 'Essomba');
    await tour.type(find.byType(TextField).at(3), '670112233');
    await tour.shot('pat-6-new');
  });
}
