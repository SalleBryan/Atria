import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'api/api.dart';
import 'auth/auth.dart';
import 'auth/session.dart';
import 'config.dart';
import 'demo/demo.dart';
import 'screens/home.dart';
import 'screens/sign_in.dart';
import 'theme/theme.dart';

void main() {
  final Session session;
  if (AtriaConfig.demo) {
    final auth = DemoAuth();
    session = Session(auth, DemoApi(auth));
  } else {
    final auth = CognitoAuth();
    session = Session(auth, HttpApi(auth));
  }
  runApp(AtriaApp(session: session));
  session.refresh();
}

GoRouter routerFor(Session session) => GoRouter(
  refreshListenable: session,
  initialLocation: '/',
  redirect: (context, state) {
    final at = state.matchedLocation;
    final signingIn = at == '/sign-in' || at == '/staff/sign-in';
    return switch (session.state) {
      Loading() => at == '/' ? null : '/',
      SignedIn() => signingIn || at == '/' ? '/home' : null,
      _ => signingIn ? null : '/sign-in',
    };
  },
  routes: [
    GoRoute(
      path: '/',
      builder: (_, _) => const Scaffold(body: Center(child: CircularProgressIndicator())),
    ),
    GoRoute(
      path: '/sign-in',
      builder: (_, _) => SignInScreen(session: session),
    ),
    GoRoute(
      path: '/staff/sign-in',
      builder: (_, _) => SignInScreen(session: session, audience: Audience.staff),
    ),
    GoRoute(
      path: '/home',
      builder: (_, _) => switch (session.state) {
        SignedIn(:final me) => HomeScreen(session: session, me: me),
        _ => const SizedBox.shrink(),
      },
    ),
  ],
);

class AtriaApp extends StatefulWidget {
  const AtriaApp({super.key, required this.session});
  final Session session;

  @override
  State<AtriaApp> createState() => _AtriaAppState();
}

class _AtriaAppState extends State<AtriaApp> {
  late final GoRouter router = routerFor(widget.session);

  @override
  Widget build(BuildContext context) =>
      MaterialApp.router(title: 'Atria', theme: atriaTheme(), routerConfig: router, debugShowCheckedModeBanner: false);
}
