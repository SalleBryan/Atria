import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../auth/auth.dart';
import '../auth/session.dart';
import '../config.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/widgets.dart';

/// "Mobile · Sign in", the web's patient sign-in at phone width
/// (web/src/pages/PatientSignIn.tsx). Staff sign in from the same app through
/// the staff client, which offers no Google and no sign-up (FR-ACC-03).
///
/// Continue with Google and Create account arrive as their own screens; they
/// are not shown until they work.
class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key, required this.session, this.audience = Audience.patient});
  final Session session;
  final Audience audience;

  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  final email = TextEditingController();
  final password = TextEditingController();
  bool busy = false;
  String? error;

  bool get staff => widget.audience == Audience.staff;

  @override
  void initState() {
    super.initState();
    email.addListener(_changed);
    password.addListener(_changed);
  }

  void _changed() => setState(() {});

  @override
  void dispose() {
    email.dispose();
    password.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    if (email.text.trim().isEmpty || password.text.isEmpty || busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final step = await widget.session.auth.signIn(widget.audience, email.text, password.text);
      if (!mounted) return;
      switch (step) {
        case SignInStep.authenticatorCode:
          // Only an administrator has an authenticator, and administration
          // is the web console's alone.
          await widget.session.auth.signOut();
          setState(() => error = 'Administrators use the Atria console on the web.');
        case SignInStep.newPassword:
          setState(() => error = 'Set your own password in the Atria console on the web first, then sign in here.');
        case SignInStep.confirmEmail:
          setState(() => error = 'Confirm your email first: use the code we sent you.');
        case SignInStep.done:
          final state = await widget.session.refresh();
          if (!mounted) return;
          if (state is Unresolved) setState(() => error = state.message);
      }
    } on AuthFailure catch (e) {
      setState(() => error = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ready = email.text.trim().isNotEmpty && password.text.isNotEmpty;
    return Scaffold(
      body: DecoratedBox(
        decoration: BoxDecoration(gradient: AtriaGradients.page),
        child: SafeArea(
          child: AutofillGroup(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(AtriaSpace.s5, AtriaSpace.s6, AtriaSpace.s5, AtriaSpace.s6),
              children: [
                const Rise(
                  child: Align(alignment: Alignment.centerLeft, child: BrandMark()),
                ),
                const SizedBox(height: 22),
                Rise(index: 1, child: Text(staff ? 'Sign in to work.' : 'Welcome back.', style: AtriaType.display())),
                const SizedBox(height: 10),
                Rise(
                  index: 2,
                  child: Text(
                    staff ? 'Use the credentials your practice administrator issued you.' : 'Pick up where you left off. Your visits, reminders and records follow you across every device.',
                    style: AtriaType.body(),
                  ),
                ),
                const SizedBox(height: 22),
                Rise(
                  index: 3,
                  child: FormCard(
                    children: [
                      if (error != null) ...[Notice(error!, tone: NoticeTone.error), const SizedBox(height: 14)],
                      AtriaField(
                        label: staff ? 'Work email' : 'Email address',
                        icon: Icons.mail_outline,
                        controller: email,
                        hint: staff ? 'you@hospital.cm' : 'you@example.com',
                        keyboard: TextInputType.emailAddress,
                        autofill: const [AutofillHints.username, AutofillHints.email],
                        action: TextInputAction.next,
                      ),
                      const SizedBox(height: 14),
                      AtriaField(
                        label: 'Password',
                        icon: Icons.lock_outline,
                        controller: password,
                        hint: 'Your password',
                        obscure: true,
                        autofill: const [AutofillHints.password],
                        action: TextInputAction.done,
                        onSubmitted: (_) => submit(),
                      ),
                      const SizedBox(height: 18),
                      PrimaryButton(label: 'Sign in', busy: busy, onPressed: ready ? submit : null),
                    ],
                  ),
                ),
                const SizedBox(height: 18),
                Rise(
                  index: 4,
                  child: Text(
                    staff
                        ? 'Staff accounts are issued by your practice administrator. Access is logged for audit.'
                        : 'Trouble signing in? The front desk at ${AtriaConfig.hospital} can confirm the email on your record.',
                    textAlign: TextAlign.center,
                    style: AtriaType.body(size: 12, color: AtriaColors.inkMuted),
                  ),
                ),
                const SizedBox(height: 6),
                Rise(
                  index: 5,
                  child: Center(
                    child: TextButton(
                      onPressed: () => context.go(staff ? '/sign-in' : '/staff/sign-in'),
                      child: Text(
                        staff ? 'A patient? Sign in here' : 'Hospital staff? Sign in to work',
                        style: AtriaType.body(size: 13, weight: FontWeight.w700, color: AtriaColors.blue600),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
