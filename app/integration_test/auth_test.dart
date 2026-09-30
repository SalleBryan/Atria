import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'tour.dart';

/// Every account screen, signed out; then a staff member's first sign-in.
void main() {
  Tour.init();

  testWidgets('account screens', (tester) async {
    final tour = await Tour.boot(tester, email: null);
    await tour.shot('auth-1-sign-in');
    await tour.tap('Clinic staff');
    await tour.shot('auth-2-staff');
    await tour.go('/create-account');
    await tour.shot('auth-3-create');
    await tour.go('/forgot-password');
    await tour.shot('auth-4-forgot');
    await tour.go('/verify-email?email=amina%40example.com');
    await tour.shot('auth-5-verify');
    await tour.go('/staff/sign-in');
    await tour.type(find.byType(TextField).at(0), 'new.desk@example.com');
    await tour.type(find.byType(TextField).at(1), 'demo-pass');
    await tour.tap('Sign in');
    await tour.shot('auth-6-new-password');
  });
}
