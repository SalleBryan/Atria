import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'tour.dart';

/// Patient Home, top to bottom, then search as you type.
void main() {
  Tour.init();

  testWidgets('home', (tester) async {
    final tour = await Tour.boot(tester);
    expect(tour.shows('Next appointment'), isTrue);
    await tour.shot('home-1-top');
    await tour.scroll(600);
    await tour.shot('home-2');
    await tour.scroll(600);
    await tour.shot('home-3');
    await tour.scroll(600);
    await tour.shot('home-4');
    await tour.scroll(-3000);
    await tour.type(find.byType(TextField).first, 'paed');
    await tour.shot('home-5-suggest');
  });
}
