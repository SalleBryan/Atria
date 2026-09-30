import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../auth/auth.dart';
import '../auth/session.dart';
import '../ui/form_parts.dart';
import '../ds/kit.dart';
import '../ds/page.dart';
import '../ds/palette.dart';

/// "Mobile · Sign in" (Figma 32:2). The switch picks the Cognito client:
/// patients through theirs, clinic staff through the staff client, which
/// offers no Google and no sign-up (FR-ACC-03, ADR 0021).
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
  bool googleBusy = false;
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
    FocusScope.of(context).unfocus();
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final step = await widget.session.auth.signIn(widget.audience, email.text, password.text);
      if (!mounted) return;
      switch (step) {
        case SignInStep.authenticatorCode:
          // Only an administrator has an authenticator, and administration is
          // the web console's alone.
          await widget.session.auth.signOut();
          setState(() => error = 'Administrators use the Atria console on the web.');
        case SignInStep.newPassword:
          // First sign-in with the temporary password: choose your own.
          context.push('/staff/new-password');
        case SignInStep.confirmEmail:
          context.push('/verify-email?email=${Uri.encodeQueryComponent(email.text.trim())}');
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

  /// Continue with Google (FR-ACC-02): the hosted sign-in in the browser,
  /// then GET /me as any sign-in; a new account then finishes its record.
  Future<void> google() async {
    if (busy || googleBusy) return;
    setState(() {
      googleBusy = true;
      error = null;
    });
    try {
      await widget.session.auth.signInWithGoogle();
      final state = await widget.session.refresh();
      if (!mounted) return;
      if (state is Unresolved) setState(() => error = state.message);
    } on AuthFailure catch (e) {
      if (mounted) setState(() => error = e.message);
    } finally {
      if (mounted) setState(() => googleBusy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ready = email.text.trim().isNotEmpty && password.text.isNotEmpty;
    return AutofillGroup(
      child: AuthFrame(
        title: staff ? 'Staff sign in.' : 'Welcome back.',
        lede: staff
            ? 'Use the work email and password your hospital administrator gave you.'
            : 'Pick up where you left off, or create an account in under a minute.',
        back: false,
        top: _Audience(staff: staff),
        foot: _foot(),
        children: [
          if (error != null) ...[Note(error!, error: true), const SizedBox(height: 16)],
          Field(
            label: staff ? 'Work email or mobile' : 'Email address',
            controller: email,
            hint: staff ? 'you@hospital.cm' : 'you@example.com',
            keyboard: TextInputType.emailAddress,
            autofill: const [AutofillHints.username, AutofillHints.email],
            action: TextInputAction.next,
          ),
          const SizedBox(height: 16),
          Field(
            label: 'Password',
            controller: password,
            hint: 'Your password',
            obscure: true,
            autofill: const [AutofillHints.password],
            action: TextInputAction.done,
            onSubmitted: (_) => submit(),
          ),
          Align(
            alignment: Alignment.centerRight,
            child: Btn(
              'Forgot password?',
              kind: BtnKind.ghost,
              compact: true,
              expand: false,
              onPressed: () => context.push(staff ? '/staff/forgot-password' : '/forgot-password'),
            ),
          ),
          const SizedBox(height: 4),
          Btn('Sign in', busy: busy, onPressed: ready && !googleBusy ? submit : null),
          if (!staff) ...[
            const SizedBox(height: 18),
            Row(
              children: [
                const Expanded(child: Divider(color: P.line, height: 1)),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Text('OR', style: T.eyebrow(color: P.ink4)),
                ),
                const Expanded(child: Divider(color: P.line, height: 1)),
              ],
            ),
            const SizedBox(height: 18),
            Btn(
              googleBusy ? 'Opening Google' : 'Continue with Google',
              kind: BtnKind.outline,
              onPressed: busy || googleBusy ? null : google,
              leading: Text('G', style: T.heading(color: P.blue700, size: 17)),
            ),
          ],
        ],
      ),
    );
  }

  Widget _foot() => Column(
    children: [
      if (staff)
        Text(
          'Staff accounts are made by your hospital administrator. Access is logged for audit.',
          textAlign: TextAlign.center,
          style: T.small(),
        )
      else
        FootLink(lead: 'New to Atria?', action: 'Create an account', onTap: () => context.push('/create-account')),
    ],
  );
}

/// Patient or staff: two pills on the blue field.
class _Audience extends StatelessWidget {
  const _Audience({required this.staff});
  final bool staff;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 178,
    child: Choices<bool>(
    onDark: true,
    options: const [(false, 'Patient'), (true, 'Staff')],
    value: staff,
    onChanged: (v) => context.go(v ? '/staff/sign-in' : '/sign-in'),
  ),
  );
}
