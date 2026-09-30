import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'api/api.dart';
import 'auth/auth.dart';
import 'auth/session.dart';
import 'config.dart';
import 'demo/demo.dart';
import 'patient/data.dart';
import 'patient/shell.dart';
import 'staff/data.dart';
import 'staff/patients.dart';
import 'staff/schedule.dart';
import 'staff/shell.dart';
import 'staff/visit.dart';
import 'prefs.dart';
import 'screens/account.dart';
import 'screens/account_flows.dart';
import 'screens/find_care.dart';
import 'screens/onboarding.dart';
import 'screens/queue.dart';
import 'screens/request.dart';
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

/// Notifies when the session's place changes: loading, signed out, which
/// audience, or the gate (finish the record, restore the account).
class _Where extends ChangeNotifier {
  _Where(this.session) {
    session.addListener(_check);
  }
  final Session session;
  String _last = '';

  String get _now => switch (session.state) {
    SignedIn(:final me, :final audience) => 'in:${audience.name}:${_gate(me, audience) ?? ''}',
    final other => other.runtimeType.toString(),
  };

  void _check() {
    final now = _now;
    if (now != _last) {
      _last = now;
      notifyListeners();
    }
  }
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
  StaffStore? staff;
  StaffStore staffFor() {
    final me = (session.state as SignedIn).me;
    return staff ??= (StaffStore(session.api, me)..load());
  }

  session.addListener(() {
    if (session.state is! SignedIn) {
      store = null;
      staff = null;
    }
  });

  return GoRouter(
    // Only where a person belongs moves the router, not every change to who
    // they are: re-reading GET /me after a name or email change must not
    // rebuild the screens they are on.
    refreshListenable: _Where(session),
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
        '/staff/new-password',
      };
      return switch (session.state) {
        Loading() => at == '/' ? null : '/',
        SignedIn(:final me, :final audience) => switch (_gate(me, audience)) {
          final String gate => at == gate ? null : gate,
          null when audience == Audience.staff => at.startsWith('/console') ? null : '/console',
          null =>
            open.contains(at) ||
                    at == '/' ||
                    at == '/finish-account' ||
                    at == '/restore-account' ||
                    at.startsWith('/console')
                ? '/home'
                : null,
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
        path: '/staff/new-password',
        builder: (_, _) => NewStaffPasswordScreen(session: session),
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
        path: '/account/details',
        builder: (_, _) => EditDetailsScreen(session: session),
      ),
      GoRoute(
        path: '/account/email',
        builder: (_, _) => ChangeEmailScreen(session: session),
      ),
      GoRoute(
        path: '/account/units',
        builder: (_, _) => UnitsScreen(store: storeFor()),
      ),
      GoRoute(
        path: '/visits/:id',
        // A queue place opens as its ticket (Figma 310:2), a visit as its details.
        builder: (_, state) {
          final id = state.pathParameters['id']!;
          final store = storeFor();
          return ListenableBuilder(
            listenable: store,
            builder: (_, _) {
              final data = store.state;
              final ticket = data is DataReady && data.data.appointments.any((a) => a.id == id && a.sessionId != null);
              return ticket
                  ? QueueTicketScreen(id: id, store: store)
                  : VisitDetailScreen(id: id, store: store, cancel: state.uri.queryParameters['cancel'] == '1');
            },
          );
        },
      ),
      GoRoute(
        path: '/queue',
        builder: (_, _) => JoinQueueScreen(store: storeFor()),
      ),
      GoRoute(
        path: '/request',
        builder: (_, _) => RequestProcedureScreen(store: storeFor()),
      ),
      GoRoute(
        path: '/queue/:id',
        builder: (_, state) => QueueTicketScreen(id: state.pathParameters['id']!, store: storeFor()),
      ),
      GoRoute(
        path: '/console/patients/:id',
        builder: (_, state) => PatientRecordScreen(store: staffFor(), id: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/console/book',
        builder: (_, state) => ListenableBuilder(
          listenable: staffFor(),
          builder: (_, _) => BookForPatientScreen(
            store: staffFor(),
            patientId: state.uri.queryParameters['patient'],
            clinicianId: state.uri.queryParameters['clinician'],
          ),
        ),
      ),
      GoRoute(
        path: '/console/visits/:id',
        builder: (_, state) => StaffVisitScreen(store: staffFor(), id: state.pathParameters['id']!),
      ),
      ShellRoute(
        builder: (context, state, child) =>
            StaffShell(store: staffFor(), session: session, location: state.uri.toString(), child: child),
        routes: [
          GoRoute(
            path: '/console',
            builder: (_, state) => ListenableBuilder(
              listenable: staffFor(),
              builder: (_, _) => DayScheduleScreen(
                key: ValueKey(state.uri.toString()),
                store: staffFor(),
                date: state.uri.queryParameters['date'],
              ),
            ),
          ),
          GoRoute(
            path: '/console/patients',
            builder: (_, _) => PatientsScreen(store: staffFor()),
          ),
          GoRoute(
            path: '/console/week',
            builder: (_, state) => WeekScreen(
              key: ValueKey(state.uri.toString()),
              store: staffFor(),
              date: state.uri.queryParameters['date'],
            ),
          ),
        ],
      ),
      ShellRoute(
        builder: (context, state, child) => PatientShell(
          store: storeFor(),
          location: state.matchedLocation,
          initials: switch (session.state) {
            SignedIn(:final me) => initials(me.givenName, me.familyName),
            _ => '',
          },
          child: child,
        ),
        routes: [
          GoRoute(
            path: '/home',
            builder: (_, _) => ListenableBuilder(
              listenable: session,
              builder: (_, _) => switch (session.state) {
                SignedIn(:final me) => HomeScreen(me: me, store: storeFor()),
                _ => const SizedBox.shrink(),
              },
            ),
          ),
          GoRoute(
            path: '/find-care',
            builder: (_, state) => FindCareScreen(
              store: storeFor(),
              query: state.uri.queryParameters['q'] ?? '',
              clinician: state.uri.queryParameters['clinician'],
              specialty: state.uri.queryParameters['specialty'],
              clinic: state.uri.queryParameters['clinic'],
              language: state.uri.queryParameters['language'],
            ),
          ),
          GoRoute(
            path: '/account',
            builder: (_, _) => AccountScreen(session: session, store: storeFor()),
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
