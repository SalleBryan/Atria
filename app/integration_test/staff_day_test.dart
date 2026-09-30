import 'package:atria/auth/auth.dart';
import 'package:atria/staff/parts.dart';
import 'package:flutter_test/flutter_test.dart';

import 'tour.dart';

/// The front desk's day, week and one visit; then a clinician's own day.
void main() {
  Tour.init();

  testWidgets('staff schedule', (tester) async {
    final tour = await Tour.boot(tester, email: 'n.fotso@example.com', audience: Audience.staff);
    await tour.shot('staff-1-day');
    await tour.scroll(500);
    await tour.shot('staff-2-day-list');
    await tour.tap('', finder: find.byType(VisitLine).first);
    await tour.shot('staff-3-visit');
    await tour.scroll(600);
    await tour.shot('staff-4-visit-foot');
    await tour.back();
    await tour.go('/console/week');
    await tour.shot('staff-5-week');
    await tour.tap('More');
    await tour.shot('staff-6-more');
  });
}
