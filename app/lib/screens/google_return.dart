import 'package:flutter/material.dart';

import '../auth/auth.dart';
import '../auth/session.dart';
import '../theme/theme.dart';
import '../ui/loading.dart';
import '../ui/widgets.dart';

/// Continue with Google from sign-in or sign-up: the browser, then the
/// tokens, then GET /me. [returned] fires as the browser hands back, so the
/// screen can say it is signing in. Returns what to tell the patient when it
/// did not finish, or null once they are signed in; nothing fails silently.
Future<String?> continueWithGoogle(Session session, {required void Function() returned}) async {
  try {
    await session.auth.signInWithGoogle(returned: returned);
    final state = await session.refresh();
    return switch (state) {
      SignedIn() => null,
      Unresolved(:final message) => message,
      _ => 'Google sign-in did not complete. Try again.',
    };
  } on AuthFailure catch (e) {
    return e.message;
  } on Object catch (e) {
    debugPrint('Google sign-in failed: $e');
    return 'Google sign-in did not complete. Try again.';
  }
}

/// While Atria finishes with Google (the web's AuthCallback screen): the
/// brand, "Signing you in.", and the loader, centred.
class SigningIn extends StatelessWidget {
  const SigningIn({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
    body: PageBackground(
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(26, 42, 26, 26),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Rise(child: BrandMark()),
              const SizedBox(height: 18),
              Rise(
                index: 1,
                child: Text(
                  'Signing you in.',
                  style: AtriaType.display(size: 30).copyWith(height: 33 / 30, letterSpacing: -0.75),
                ),
              ),
              const SizedBox(height: 8),
              Rise(
                index: 2,
                child: Text(
                  'One moment while Atria finishes with Google.',
                  style: AtriaType.body(color: const Color(0xFF54658A), height: 20.3 / 14),
                ),
              ),
              const Expanded(
                child: Center(child: LoadingIndicator(size: 52, label: 'Signing you in')),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
