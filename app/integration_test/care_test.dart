import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:atria/ui/form_parts.dart';

import 'tour.dart';

/// Booking a specialist asks the visit's questions first; the answers are
/// then read and changed from the visit.
void main() {
  Tour.init();

  testWidgets('care context at booking and from the visit', (tester) async {
    final tour = await Tour.boot(tester);
    await tour.go('/find-care/s-mbarga');
    await tour.shot('care-1-clinician');
    // The first free time on the day shown.
    await tour.tap('', finder: find.textContaining(RegExp(r'^\d\d:\d\d$')));
    await tour.tap('Book');
    await tour.shot('care-2-questions');
    await tour.type(find.byType(TextField).first, 'A rash on my arm for two weeks.');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tour.settle();
    await tour.tap('A few weeks');
    await tester.drag(find.byType(ListView).last, const Offset(0, -600));
    await tour.settle();
    await tour.tap('', finder: find.byType(AtriaCheckbox));
    await tour.shot('care-3-answered');
    await tour.tap('Share and book');
    await tour.shot('care-3b-after-share');
    await tour.shot('care-4-booked');
    await tour.scroll(900);
    await tour.shot('care-5-booked-foot');
    await tour.go('/visits');
    await tour.tap('Details');
    await tour.shot('care-6-visit');
    await tour.scroll(700);
    await tour.shot('care-7-answers');
  });
}
