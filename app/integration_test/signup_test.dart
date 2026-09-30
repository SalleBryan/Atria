import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'tour.dart';

/// Sign-up's mobile number (fixed +237) and date of birth (typed mask).
void main() {
  Tour.init();

  testWidgets('sign-up fields', (tester) async {
    final tour = await Tour.boot(tester, email: null);
    await tour.go('/create-account');
    await tour.type(find.byType(TextField).at(1), '02041990');
    await tour.type(find.byType(TextField).at(3), '670000000');
    await tour.shot('signup-1-fields');
  });
}
