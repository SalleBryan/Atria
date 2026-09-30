/// Tours: the real app, in demo mode, driven on a phone or tablet from inside.
///
/// A tour signs a persona in through the demo auth, moves by route or by
/// tapping what a person would tap, waits for frames to settle rather than
/// for a clock, and sends screenshots back to the computer
/// (test_driver/integration_test.dart saves them). Run one with:
///
///   flutter drive -d DEVICE --driver=test_driver/integration_test.dart \
///     --target=integration_test/`name`_test.dart
library;

import 'package:atria/auth/auth.dart';
import 'package:atria/auth/session.dart';
import 'package:atria/demo/demo.dart';
import 'package:atria/main.dart';
import 'package:atria/prefs.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:integration_test/integration_test.dart';

class Tour {
  Tour._(this.binding, this.tester, this.auth);
  final IntegrationTestWidgetsFlutterBinding binding;
  final WidgetTester tester;
  final DemoAuth auth;
  bool _surface = false;

  static IntegrationTestWidgetsFlutterBinding init() => IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  /// Opens the app signed in as [email] (see lib/demo/demo.dart for who is
  /// who), or signed out when it is null; [onboarded] false shows onboarding.
  static Future<Tour> boot(
    WidgetTester tester, {
    String? email = 'amina@example.com',
    Audience audience = Audience.patient,
    bool onboarded = true,
  }) async {
    final binding = IntegrationTestWidgetsFlutterBinding.instance;
    final auth = DemoAuth();
    final session = Session(auth, DemoApi(auth));
    if (email != null) await auth.signIn(audience, email, 'demo-pass');
    await tester.pumpWidget(
      AtriaApp(
        session: session,
        prefs: AppPrefs(onboarded: onboarded),
      ),
    );
    await session.refresh();
    final tour = Tour._(binding, tester, auth);
    await tour.settle();
    return tour;
  }

  /// Lets animations and loads finish; entrance motion runs about a second.
  Future<void> settle([Duration most = const Duration(milliseconds: 2500)]) async {
    try {
      await tester.pumpAndSettle(const Duration(milliseconds: 100), EnginePhase.sendSemanticsUpdate, most);
    } on FlutterError {
      // Something loops for ever (a floating card, a drifting light): enough.
    }
  }

  // A widget inside the current page: the router is published below Router.
  BuildContext get _context => tester.element(find.byType(Scaffold).last);

  /// Waits, a frame at a time, until [finder] shows something (at most [most]).
  Future<void> until(Finder finder, {Duration most = const Duration(seconds: 15)}) async {
    final end = DateTime.now().add(most);
    while (DateTime.now().isBefore(end) && finder.evaluate().isEmpty) {
      await tester.pump(const Duration(milliseconds: 200));
    }
    await settle();
  }

  /// Goes to a route as a link would.
  Future<void> go(String path) async {
    debugPrint('TOUR go $path');
    GoRouter.of(_context).go(path);
    await settle();
  }

  /// Taps the first widget showing [text] (or matching [finder]).
  Future<void> tap(String text, {Finder? finder}) async {
    debugPrint('TOUR tap ${finder ?? text}');
    final target = finder ?? find.text(text, findRichText: true);
    await tester.ensureVisible(target.first);
    await tester.tap(target.first);
    await settle();
  }

  /// The system Back button: closes a sheet or menu, or leaves the page.
  Future<void> back() async {
    debugPrint('TOUR back');
    await tester.binding.handlePopRoute();
    await settle();
  }

  Future<void> type(Finder field, String text) async {
    await tester.enterText(field, text);
    await settle();
  }

  /// Scrolls the main list by [pixels] (down is positive).
  Future<void> scroll(double pixels) async {
    await tester.drag(find.byType(Scrollable).first, Offset(0, -pixels));
    await settle();
  }

  /// Scrolls until [text] is on screen.
  Future<void> reveal(String text) async {
    await tester.scrollUntilVisible(find.text(text).first, 300, scrollable: find.byType(Scrollable).first);
    await settle();
  }

  bool shows(String text) => find.textContaining(text).evaluate().isNotEmpty;

  /// A screenshot, saved on the computer as `name.png`.
  Future<void> shot(String name) async {
    debugPrint('TOUR shot $name');
    if (!_surface) {
      await binding.convertFlutterSurfaceToImage();
      _surface = true;
    }
    await settle();
    await binding.takeScreenshot(name);
  }
}
