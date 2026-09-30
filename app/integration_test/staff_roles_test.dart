import 'package:atria/auth/auth.dart';
import 'package:atria/ui/filters.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'tour.dart';

/// Every staff place, as the role that uses it.
void main() {
  Tour.init();

  testWidgets('outpatient desk runs the queue', (tester) async {
    final tour = await Tour.boot(tester, email: 'k.ngassa@example.com', audience: Audience.staff);
    await tour.go('/console/queue');
    await tour.until(find.text('Call next patient'));
    await tour.shot('roles-1-queue');
    await tour.tap('', finder: find.text('Arrived').first);
    await tour.shot('roles-2-arrived');
    await tour.tap('', finder: find.byType(FilterChipButton).first);
    await tour.tap('Call next patient');
    await tour.shot('roles-3-called');
    await tour.scroll(-2000);
    await tour.tap('Add a walk-in');
    await tour.shot('roles-4-walkin');
  });

  testWidgets('a surgeon places a procedure request', (tester) async {
    final tour = await Tour.boot(tester, email: 'e.ekane@example.com', audience: Audience.staff);
    await tour.go('/console/requests');
    await tour.shot('roles-5-requests');
  });

  testWidgets('the unit manager', (tester) async {
    final tour = await Tour.boot(tester, email: 'r.owona@example.com', audience: Audience.staff);
    for (final place in ['roster', 'availability', 'messages', 'reports', 'audit']) {
      await tour.go('/console/$place');
      await tour.settle(const Duration(seconds: 4));
      await tour.shot('roles-6-$place');
    }
    await tour.tap('More');
    await tour.shot('roles-7-more');
  });

  testWidgets('a clinician reads their own day', (tester) async {
    final tour = await Tour.boot(tester, email: 'j.nkoulou@example.com', audience: Audience.staff);
    await tour.shot('roles-8-clinician-day');
    await tour.go('/console/availability');
    await tour.settle(const Duration(seconds: 4));
    await tour.shot('roles-9-clinician-availability');
  });
}
