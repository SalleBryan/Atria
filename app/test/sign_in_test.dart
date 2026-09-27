import 'package:atria/api/api.dart';
import 'package:atria/auth/auth.dart';
import 'package:atria/auth/session.dart';
import 'package:atria/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

class MockAuth extends Mock implements Auth {}

class MockApi extends Mock implements Api {}

Map<String, dynamic> me({List<String> roles = const ['PATIENT'], String? staffId}) => {
  'personId': 'p-1',
  'givenName': 'Amina',
  'familyName': 'Ngo',
  'roles': roles,
  'staffId': staffId,
};

void main() {
  late MockAuth auth;
  late MockApi api;
  late Session session;

  setUpAll(() => registerFallbackValue(Audience.patient));

  setUp(() {
    auth = MockAuth();
    api = MockApi();
    session = Session(auth, api);
    when(() => auth.accessToken()).thenAnswer((_) async => null);
    when(() => auth.audience).thenReturn(null);
    when(() => auth.signOut(everywhere: any(named: 'everywhere'))).thenAnswer((_) async {});
  });

  Future<void> open(WidgetTester tester) async {
    await tester.pumpWidget(AtriaApp(session: session));
    await session.refresh();
    await tester.pumpAndSettle();
  }

  Future<void> signIn(WidgetTester tester, {String password = 'Right-Password-1'}) async {
    await tester.enterText(find.byType(TextField).at(0), 'amina@example.com');
    await tester.enterText(find.byType(TextField).at(1), password);
    await tester.pump();
    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();
  }

  testWidgets('a signed-out person lands on sign-in, and Sign in waits for both fields', (tester) async {
    await open(tester);
    expect(find.text('Welcome back.'), findsOneWidget);
    await tester.tap(find.text('Sign in'));
    verifyNever(() => auth.signIn(any(), any(), any()));
  });

  testWidgets('a patient signs in and reaches Home', (tester) async {
    await open(tester);
    when(() => auth.signIn(Audience.patient, any(), any())).thenAnswer((_) async {
      when(() => auth.accessToken()).thenAnswer((_) async => 'token');
      when(() => auth.audience).thenReturn(Audience.patient);
      return SignInStep.done;
    });
    when(() => api.get('/me')).thenAnswer((_) async => me());
    await signIn(tester);
    expect(find.textContaining('Amina'), findsOneWidget);
  });

  testWidgets('a wrong password says so', (tester) async {
    await open(tester);
    when(() => auth.signIn(any(), any(), any())).thenThrow(AuthFailure('That email and password do not match.'));
    await signIn(tester, password: 'nope');
    expect(find.text('That email and password do not match.'), findsOneWidget);
  });

  testWidgets('staff sign in through the staff client', (tester) async {
    await open(tester);
    await tester.tap(find.text('Hospital staff? Sign in to work'));
    await tester.pumpAndSettle();
    expect(find.text('Sign in to work.'), findsOneWidget);
    when(() => auth.signIn(Audience.staff, any(), any())).thenAnswer((_) async => SignInStep.done);
    when(() => auth.accessToken()).thenAnswer((_) async => null);
    await signIn(tester);
    verify(() => auth.signIn(Audience.staff, 'amina@example.com', any())).called(1);
  });

  testWidgets('an administrator is sent to the web console', (tester) async {
    await open(tester);
    when(() => auth.signIn(any(), any(), any())).thenAnswer((_) async {
      when(() => auth.accessToken()).thenAnswer((_) async => 'token');
      when(() => auth.audience).thenReturn(Audience.staff);
      return SignInStep.done;
    });
    when(() => api.get('/me')).thenAnswer((_) async => me(roles: ['TENANT_ADMIN'], staffId: 's-a'));
    await signIn(tester);
    expect(find.text('Administrators use the Atria console on the web.'), findsOneWidget);
    verify(() => auth.signOut()).called(1);
  });

  test('the API speaks in sentences', () {
    expect(sentence('that slot is taken'), 'That slot is taken.');
  });
}
