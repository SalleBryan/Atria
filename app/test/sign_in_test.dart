import 'package:atria/api/api.dart';
import 'package:atria/auth/auth.dart';
import 'package:atria/auth/forms.dart';
import 'package:atria/auth/session.dart';
import 'package:atria/main.dart';
import 'package:atria/prefs.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

class MockAuth extends Mock implements Auth {}

class MockApi extends Mock implements Api {}

Map<String, dynamic> me({
  List<String> roles = const ['PATIENT'],
  String? staffId,
  List<String> missing = const [],
  Map<String, dynamic>? deletion,
}) => {
  'personId': 'p-1',
  'givenName': 'Amina',
  'familyName': 'Ngo',
  'roles': roles,
  'staffId': staffId,
  'patientProfileId': staffId == null ? 'pp-1' : null,
  'missing': missing,
  'deletion': deletion,
};

/// What the patient screens read, empty: enough for Home to draw.
const empty = <String, dynamic>{
  'appointments': [],
  'clinicians': [],
  'clinics': [],
  'appointmentTypes': [],
  'gridUnitMinutes': 10,
  'nextCursor': null,
};

void main() {
  late MockAuth auth;
  late MockApi api;
  late Session session;

  setUpAll(() {
    registerFallbackValue(Audience.patient);
    registerFallbackValue(
      const NewAccount(email: '', password: '', givenName: '', familyName: '', phone: '', birthdate: ''),
    );
  });

  setUp(() {
    auth = MockAuth();
    api = MockApi();
    session = Session(auth, api);
    when(() => auth.accessToken()).thenAnswer((_) async => null);
    when(() => auth.audience).thenReturn(null);
    when(() => auth.signOut(everywhere: any(named: 'everywhere'))).thenAnswer((_) async {});
    when(() => api.get(any())).thenAnswer((_) async => empty);
  });

  Future<void> open(WidgetTester tester, {bool onboarded = true}) async {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    // The light behind the glass drifts forever; reduced motion stills it
    // so a test can wait for the screen to settle.
    tester.platformDispatcher.accessibilityFeaturesTestValue = FakeAccessibilityFeatures(disableAnimations: true);
    addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
    await tester.pumpWidget(
      AtriaApp(
        session: session,
        prefs: AppPrefs(onboarded: onboarded),
      ),
    );
    await session.refresh();
    await tester.pumpAndSettle();
  }

  void signedInAs(Map<String, dynamic> who, {Audience audience = Audience.patient}) {
    when(() => auth.accessToken()).thenAnswer((_) async => 'token');
    when(() => auth.audience).thenReturn(audience);
    when(() => api.get('/me')).thenAnswer((_) async => who);
  }

  Future<void> signIn(WidgetTester tester, {String password = 'Right-Password-1'}) async {
    await tester.enterText(find.byType(TextField).at(0), 'amina@example.com');
    await tester.enterText(find.byType(TextField).at(1), password);
    await tester.pump();
    await tester.tap(find.text('Sign in').last);
    await tester.pumpAndSettle();
  }

  testWidgets('the first launch opens on the onboarding, and Sign in leaves it', (tester) async {
    await open(tester, onboarded: false);
    expect(find.text('Care that keeps time with you.'), findsOneWidget);
    await tester.tap(find.bySemanticsLabel('Next'));
    await tester.pumpAndSettle();
    expect(find.text('Three ways to be seen.'), findsOneWidget);
    await tester.tap(find.textContaining('Sign in', findRichText: true).last);
    await tester.pumpAndSettle();
    expect(find.text('Welcome back.'), findsOneWidget);
  });

  testWidgets('a signed-out person lands on sign-in, and Sign in waits for both fields', (tester) async {
    await open(tester);
    expect(find.text('Welcome back.'), findsOneWidget);
    await tester.tap(find.text('Sign in').last);
    verifyNever(() => auth.signIn(any(), any(), any()));
  });

  testWidgets('a patient signs in and reaches Home', (tester) async {
    await open(tester);
    when(() => auth.signIn(Audience.patient, any(), any())).thenAnswer((_) async {
      signedInAs(me());
      return SignInStep.done;
    });
    await signIn(tester);
    expect(find.textContaining('Amina'), findsWidgets);
    expect(find.text('Welcome back.'), findsNothing);
  });

  testWidgets('a wrong password says so', (tester) async {
    await open(tester);
    when(() => auth.signIn(any(), any(), any())).thenThrow(AuthFailure('That email and password do not match.'));
    await signIn(tester, password: 'nope');
    expect(find.text('That email and password do not match.'), findsOneWidget);
  });

  testWidgets('staff sign in through the staff client', (tester) async {
    await open(tester);
    await tester.tap(find.text('Clinic staff'));
    await tester.pumpAndSettle();
    expect(find.text('Continue with Google'), findsNothing);
    when(() => auth.signIn(Audience.staff, any(), any())).thenAnswer((_) async => SignInStep.done);
    await signIn(tester);
    verify(() => auth.signIn(Audience.staff, 'amina@example.com', any())).called(1);
  });

  testWidgets('an administrator is sent to the web console', (tester) async {
    await open(tester);
    when(() => auth.signIn(any(), any(), any())).thenAnswer((_) async {
      signedInAs(
        me(roles: ['TENANT_ADMIN'], staffId: 's-a'),
        audience: Audience.staff,
      );
      return SignInStep.done;
    });
    await signIn(tester);
    expect(find.text('Administrators use the Atria console on the web.'), findsOneWidget);
  });

  testWidgets('Google for patients: a new account finishes its record first', (tester) async {
    await open(tester);
    when(() => auth.signInWithGoogle()).thenAnswer((_) async {
      signedInAs(me(missing: ['phone', 'dateOfBirth', 'terms']));
      return SignInStep.done;
    });
    await tester.tap(find.text('Continue with Google'));
    await tester.pumpAndSettle();
    expect(find.text('Finish your account, Amina.'), findsOneWidget);

    when(() => api.send('PATCH', '/me', any())).thenAnswer((_) async {
      when(() => api.get('/me')).thenAnswer((_) async => me());
      return <String, dynamic>{};
    });
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Enter a Cameroonian mobile'), findsOneWidget);

    await tester.enterText(find.byType(TextField).at(0), '6 70 00 01 42');
    await tester.enterText(find.byType(TextField).at(1), '14/03/1994');
    await tester.tap(find.textContaining('I agree'));
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    final sent = verify(() => api.send('PATCH', '/me', captureAny())).captured.single as Map;
    expect(sent, {'phoneE164': '+237670000142', 'dateOfBirth': '1994-03-14', 'acceptTerms': true});
    expect(find.text('Finish your account, Amina.'), findsNothing);
  });

  testWidgets('a deleted account signing in is offered it back', (tester) async {
    signedInAs(me(deletion: {'purgeAt': DateTime.now().add(const Duration(days: 12)).toIso8601String(), 'by': 'SELF'}));
    await open(tester);
    expect(find.text('Your account is deleted.'), findsOneWidget);
    when(() => api.send('POST', '/me/restore')).thenAnswer((_) async {
      when(() => api.get('/me')).thenAnswer((_) async => me());
      return <String, dynamic>{};
    });
    await tester.tap(find.text('Restore my account'));
    await tester.pumpAndSettle();
    expect(find.text('Your account is deleted.'), findsNothing);
  });

  testWidgets('sign-up sends the date of birth and moves on to the code', (tester) async {
    await open(tester);
    await tester.tap(find.textContaining('Create an account', findRichText: true));
    await tester.pumpAndSettle();
    when(() => auth.signUp(any())).thenAnswer((_) async {});
    final fields = find.byType(TextField);
    await tester.enterText(fields.at(0), 'Brice Tagne');
    await tester.enterText(fields.at(1), '02/04/1990');
    await tester.enterText(fields.at(2), 'brice@example.com');
    await tester.enterText(fields.at(3), '670000177');
    await tester.enterText(fields.at(4), 'Buea-Clinic-2026');
    await tester.ensureVisible(find.textContaining('I agree'));
    await tester.tap(find.textContaining('I agree'));
    await tester.ensureVisible(find.text('Create account'));
    await tester.tap(find.text('Create account'));
    await tester.pumpAndSettle();
    final account = verify(() => auth.signUp(captureAny())).captured.single as NewAccount;
    expect(
      (account.givenName, account.familyName, account.birthdate, account.phone),
      ('Brice', 'Tagne', '1990-04-02', '+237670000177'),
    );
    expect(find.text('Confirm your\nemail address.'), findsOneWidget);
  });

  group('the form rules match the web', () {
    test('dates of birth', () {
      expect(birthDate('02/04/1990'), '1990-04-02');
      expect(birthDate('31/02/1990'), isNull);
      expect(birthDate('01/01/2999'), isNull);
    });
    test('mobiles', () {
      expect(normalisePhone('6 70 00 00 00'), '+237670000000');
      expect(isMobile('+237670000000'), isTrue);
      expect(isMobile('+237220000000'), isFalse);
    });
    test('names', () {
      expect(splitName('Amina Ngo Mbe'), ('Amina', 'Ngo Mbe'));
      expect(splitName('Amina'), isNull);
    });
  });

  test('the API speaks in sentences', () {
    expect(sentence('that slot is taken'), 'That slot is taken.');
  });
}
