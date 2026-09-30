import 'package:flutter_test/flutter_test.dart';

import 'tour.dart';

/// The onboarding tour, every step, then the way to create an account.
void main() {
  Tour.init();

  testWidgets('onboarding', (tester) async {
    final tour = await Tour.boot(tester, email: null, onboarded: false);
    for (var i = 0; i < 5; i++) {
      await tour.shot('onboarding-$i');
      await tour.tap('Next');
    }
    await tour.shot('onboarding-5');
  });
}
