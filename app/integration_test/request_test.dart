import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'tour.dart';

/// Find care's filters, then requesting a procedure through to the request
/// in My visits.
void main() {
  Tour.init();

  testWidgets('find care filters and a procedure request', (tester) async {
    final tour = await Tour.boot(tester);
    await tour.go('/find-care');
    await tour.shot('request-1-find-care');

    await tour.tap('', finder: find.bySemanticsLabel(RegExp('^Filter')));
    await tour.shot('request-2-filters');
    // The option in the menu, which is drawn over the page (last in the tree).
    await tour.tap('', finder: find.text('Paediatrics').last);
    await tour.shot('request-3-filtered');
    await tour.back();

    await tour.go('/find-care?specialty=Cardiology');
    expect(tour.shows('Cardiology'), isTrue);
    await tour.shot('request-4-linked-specialty');

    await tour.tap('Request a procedure');
    await tour.shot('request-5-form');
    await tour.type(find.byType(TextField).last, 'My GP asked for a small cyst to be removed.');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tour.settle();
    await tour.tap('Send the request');
    await tour.until(find.text('Your request'));
    expect(tour.shows('Your request'), isTrue);
    await tour.shot('request-6-sent');
  });
}
