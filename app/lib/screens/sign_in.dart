import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../auth/auth.dart';
import '../auth/session.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/widgets.dart';

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
    return Scaffold(
      body: PageBackground(
        child: SafeArea(
          child: AutofillGroup(
            child: LayoutBuilder(
              builder: (context, box) => SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(26, 42, 26, 26),
                child: ConstrainedBox(
                  constraints: BoxConstraints(minHeight: box.maxHeight - 68),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Rise(child: BrandMark()),
                          const SizedBox(height: 18),
                          Rise(
                            index: 1,
                            child: Text(
                              'Welcome back.',
                              style: AtriaType.display(size: 30).copyWith(height: 33 / 30, letterSpacing: -0.75),
                            ),
                          ),
                          const SizedBox(height: 8),
                          Rise(
                            index: 2,
                            child: SizedBox(
                              width: 280,
                              child: Text(
                                staff
                                    ? 'Use the credentials your practice administrator issued you.'
                                    : 'Pick up where you left off, or create an account in under a minute.',
                                style: AtriaType.body(color: const Color(0xFF54658A), height: 20.3 / 14),
                              ),
                            ),
                          ),
                          const SizedBox(height: 20),
                          Rise(
                            index: 3,
                            child: Segmented(
                              labels: const ['Patient', 'Clinic staff'],
                              selected: staff ? 1 : 0,
                              onChanged: (i) => context.go(i == 1 ? '/staff/sign-in' : '/sign-in'),
                            ),
                          ),
                          const SizedBox(height: 14),
                          Rise(index: 4, child: _form(ready)),
                        ],
                      ),
                      const SizedBox(height: 24),
                      Rise(index: 5, child: _foot()),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _form(bool ready) {
    return FormCard(
      children: [
        if (error != null) ...[Notice(error!, tone: NoticeTone.error), const SizedBox(height: 14)],
        AtriaField(
          label: staff ? 'Work email' : 'Email address',
          icon: 'mail',
          controller: email,
          hint: staff ? 'you@hospital.cm' : 'you@example.com',
          keyboard: TextInputType.emailAddress,
          autofill: const [AutofillHints.username, AutofillHints.email],
          action: TextInputAction.next,
        ),
        const SizedBox(height: 13),
        AtriaField(
          label: 'Password',
          icon: 'lock',
          controller: password,
          hint: 'Your password',
          obscure: true,
          autofill: const [AutofillHints.password],
          action: TextInputAction.done,
          onSubmitted: (_) => submit(),
        ),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(
            onPressed: () => context.push(staff ? '/staff/forgot-password' : '/forgot-password'),
            child: Text(
              'Forgot password?',
              style: AtriaType.body(size: 12.5, weight: FontWeight.w700, color: AtriaColors.blue600),
            ),
          ),
        ),
        const SizedBox(height: 6),
        PrimaryButton(label: 'Sign in', busy: busy, onPressed: ready && !googleBusy ? submit : null),
        if (!staff) ...[
          const SizedBox(height: 18),
          Row(
            children: [
              const Expanded(child: Divider(color: AtriaColors.lineHairline, height: 1)),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Text(
                  'OR',
                  style: AtriaType.body(
                    size: 11.5,
                    weight: FontWeight.w600,
                    color: AtriaColors.inkSoft,
                  ).copyWith(letterSpacing: 0.69),
                ),
              ),
              const Expanded(child: Divider(color: AtriaColors.lineHairline, height: 1)),
            ],
          ),
          const SizedBox(height: 18),
          SecondaryButton(
            label: googleBusy ? 'Opening Google' : 'Continue with Google',
            onPressed: busy || googleBusy ? null : google,
            leading: Container(
              width: 26,
              height: 26,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AtriaColors.surfaceField,
                borderRadius: BorderRadius.circular(9),
                border: Border.all(color: AtriaColors.lineHairline),
              ),
              child: Text('G', style: AtriaType.display(size: 13, color: AtriaColors.inkMuted)),
            ),
          ),
        ],
      ],
    );
  }

  Widget _foot() {
    final small = AtriaType.body(size: 11, color: AtriaColors.inkSoft, height: 16.5 / 11);
    return Column(
      children: [
        if (staff)
          Text(
            'Staff accounts are issued by your practice administrator.',
            textAlign: TextAlign.center,
            style: AtriaType.body(size: 13.5, color: const Color(0xFF6B7C9C)),
          )
        else
          GestureDetector(
            onTap: () => context.push('/create-account'),
            child: Text.rich(
              TextSpan(
                text: 'New to Atria? ',
                children: [
                  TextSpan(
                    text: 'Create an account',
                    style: AtriaType.body(size: 13.5, weight: FontWeight.w700, color: AtriaColors.blue600),
                  ),
                ],
              ),
              textAlign: TextAlign.center,
              style: AtriaType.body(size: 13.5, color: const Color(0xFF6B7C9C)),
            ),
          ),
        const SizedBox(height: 14),
        Text(
          staff
              ? 'Access is logged for audit.'
              : "By continuing you agree to the Atria terms of use\nand the clinic's privacy notice.",
          textAlign: TextAlign.center,
          style: small,
        ),
      ],
    );
  }
}
