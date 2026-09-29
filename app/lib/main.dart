import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'api/api.dart';
import 'auth/auth.dart';
import 'auth/session.dart';
import 'config.dart';
import 'demo/demo.dart';
import 'patient/data.dart';
import 'patient/shell.dart';
import 'prefs.dart';
import 'screens/account_flows.dart';
import 'screens/find_care.dart';
import 'screens/onboarding.dart';
import 'screens/home.dart';
import 'screens/sign_in.dart';
import 'screens/visits.dart';
import 'theme/theme.dart';
import 'ui/loading.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await AppPrefs.load();
  final Session session;
  if (AtriaConfig.demo) {
    final auth = DemoAuth();
    session = Session(auth, DemoApi(auth));
  } else {
    final auth = CognitoAuth();
    session = Session(auth, HttpApi(auth));
  }
  runApp(AtriaApp(session: session, prefs: prefs));
  session.refresh();
}

/// Where a signed-in person must go before anything else, if anywhere.
String? _gate(Me me, Audience audience) {
  if (audience != Audience.patient) return null;
  if (me.deletion != null) return '/restore-account';
  if (me.missing.isNotEmpty) return '/finish-account';
  return null;
}

GoRouter routerFor(Session session, AppPrefs prefs) {
  PatientStore? store;
  PatientStore storeFor() => store ??= (PatientStore(session.api)..reload());
  session.addListener(() {
    if (session.state is! SignedIn) store = null;
  });

  return GoRouter(
    refreshListenable: session,
    initialLocation: '/',
    redirect: (context, state) {
      final at = state.matchedLocation;
      const open = {
        '/welcome',
        '/sign-in',
        '/staff/sign-in',
        '/create-account',
        '/verify-email',
        '/forgot-password',
        '/staff/forgot-password',
      };
      return switch (session.state) {
        Loading() => at == '/' ? null : '/',
        SignedIn(:final me, :final audience) => switch (_gate(me, audience)) {
          final String gate => at == gate ? null : gate,
          null =>
            open.contains(at) || at == '/' || at == '/finish-account' || at == '/restore-account' ? '/home' : null,
        },
        _ => open.contains(at) ? null : (prefs.onboarded ? '/sign-in' : '/welcome'),
      };
    },
    routes: [
      GoRoute(
        path: '/',
        builder: (_, _) => const Scaffold(body: Center(child: LoadingIndicator())),
      ),
      GoRoute(
        path: '/welcome',
        builder: (_, _) => OnboardingScreen(onSeen: prefs.markOnboarded),
      ),
      GoRoute(
        path: '/sign-in',
        builder: (_, _) => SignInScreen(session: session),
      ),
      GoRoute(
        path: '/create-account',
        builder: (_, _) => SignUpScreen(session: session),
      ),
      GoRoute(
        path: '/verify-email',
        builder: (_, state) {
          final (email, password) = switch (state.extra) {
            (String e, String p) => (e, p as String?),
            _ => (state.uri.queryParameters['email'] ?? '', null),
          };
          return VerifyEmailScreen(session: session, email: email, password: password);
        },
      ),
      GoRoute(
        path: '/forgot-password',
        builder: (_, _) => ForgotPasswordScreen(session: session),
      ),
      GoRoute(
        path: '/staff/forgot-password',
        builder: (_, _) => ForgotPasswordScreen(session: session, audience: Audience.staff),
      ),
      GoRoute(
        path: '/finish-account',
        builder: (_, _) => switch (session.state) {
          SignedIn(:final me) => CompleteProfileScreen(session: session, me: me),
          _ => const SizedBox.shrink(),
        },
      ),
      GoRoute(
        path: '/restore-account',
        builder: (_, _) => switch (session.state) {
          SignedIn(:final me) => RestoreAccountScreen(session: session, me: me),
          _ => const SizedBox.shrink(),
        },
      ),
      GoRoute(
        path: '/staff/sign-in',
        builder: (_, _) => SignInScreen(session: session, audience: Audience.staff),
      ),
      GoRoute(
        path: '/find-care/:id',
        builder: (_, state) => ClinicianScreen(id: state.pathParameters['id']!, store: storeFor()),
      ),
      GoRoute(
        path: '/find-care/:id/taken',
        builder: (_, state) => TakenScreen(
          clinicianId: state.pathParameters['id']!,
          at: DateTime.parse(state.uri.queryParameters['at']!),
          store: storeFor(),
        ),
      ),
      GoRoute(
        path: '/booked/:id',
        builder: (_, state) => BookedScreen(
          id: state.pathParameters['id']!,
          store: storeFor(),
          email: switch (session.state) {
            SignedIn(:final me) => me.email,
            _ => null,
          },
        ),
      ),
      GoRoute(
        path: '/visits/:id',
        builder: (_, state) => VisitDetailScreen(
          id: state.pathParameters['id']!,
          store: storeFor(),
          cancel: state.uri.queryParameters['cancel'] == '1',
        ),
      ),
      ShellRoute(
        builder: (context, state, child) =>
            PatientShell(store: storeFor(), location: state.matchedLocation, child: child),
        routes: [
          GoRoute(
            path: '/home',
            builder: (_, _) => switch (session.state) {
              SignedIn(:final me) => HomeScreen(me: me, store: storeFor()),
              _ => const SizedBox.shrink(),
            },
          ),
          GoRoute(
            path: '/find-care',
            builder: (_, state) => FindCareScreen(
              store: storeFor(),
              query: state.uri.queryParameters['q'] ?? '',
              clinician: state.uri.queryParameters['clinician'],
            ),
          ),
          GoRoute(
            path: '/visits',
            builder: (_, state) => VisitsScreen(store: storeFor(), past: state.uri.queryParameters['show'] == 'past'),
          ),
        ],
      ),
    ],
  );
}

class AtriaApp extends StatefulWidget {
  AtriaApp({super.key, required this.session, AppPrefs? prefs}) : prefs = prefs ?? AppPrefs(onboarded: true);
  final Session session;
  final AppPrefs prefs;

  @override
  State<AtriaApp> createState() => _AtriaAppState();
}

class _AtriaAppState extends State<AtriaApp> {
  late final GoRouter router = routerFor(widget.session, widget.prefs);

  @override
  Widget build(BuildContext context) =>
      MaterialApp.router(title: 'Atria', theme: atriaTheme(), routerConfig: router, debugShowCheckedModeBanner: false);
}
