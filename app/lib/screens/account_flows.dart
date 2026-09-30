import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../api/api.dart';
import '../auth/auth.dart';
import '../auth/forms.dart';
import '../auth/session.dart';
import '../config.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/form_parts.dart';
import '../ui/widgets.dart';
import '../ds/kit.dart';
import '../ds/page.dart';
import '../ds/palette.dart';
import '../ui/icons.dart';

/// The frame every account screen shares: the blue field, a scrolling column
/// with 24 at the sides, the back button, a heading and its line.
class _AuthPage extends StatelessWidget {
  const _AuthPage({
    required this.title,
    required this.lede,
    required this.children,
    this.icon,
    this.back = true,
    this.foot,
  });
  final String title;
  final Widget lede;
  final List<Widget> children;
  final String? icon;
  final bool back;
  final Widget? foot;

  @override
  Widget build(BuildContext context) => AuthFrame(
    title: title,
    ledeWidget: lede,
    icon: icon,
    back: back,
    foot: foot,
    children: children,
  );
}

TextStyle get _lede => T.body(color: const Color(0xDDFFFFFF), size: 14.5);

Widget _or() => Padding(
  padding: const EdgeInsets.symmetric(vertical: 16),
  child: Row(
    children: [
      const Expanded(child: Divider(color: AtriaColors.lineHairline, height: 1)),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12),
        child: Text(
          'OR',
          style: AtriaType.body(
            size: 11,
            weight: FontWeight.w600,
            color: AtriaColors.inkSoft,
          ).copyWith(letterSpacing: .66),
        ),
      ),
      const Expanded(child: Divider(color: AtriaColors.lineHairline, height: 1)),
    ],
  ),
);

Widget _googleMark() => Container(
  width: 25,
  height: 25,
  alignment: Alignment.center,
  decoration: BoxDecoration(
    color: AtriaColors.surfaceField,
    borderRadius: BorderRadius.circular(9),
    border: Border.all(color: AtriaColors.lineHairline),
  ),
  child: Text('G', style: AtriaType.display(size: 12.5, color: AtriaColors.inkMuted)),
);

// ------------------------------------------------------------------ sign up

/// "Mobile · Sign up" (Figma 32:61): name, date of birth, email, mobile and
/// password, the terms, then Create account or Sign up with Google. Cognito
/// then sends a code to the email (VerifyEmailScreen).
class SignUpScreen extends StatefulWidget {
  const SignUpScreen({super.key, required this.session});
  final Session session;

  @override
  State<SignUpScreen> createState() => _SignUpScreenState();
}

class _SignUpScreenState extends State<SignUpScreen> {
  final name = TextEditingController();
  final born = TextEditingController();
  final email = TextEditingController();
  final phone = TextEditingController();
  final password = TextEditingController();
  bool terms = false;
  bool busy = false;
  bool googleBusy = false;
  String? failure;
  Map<String, String> errors = {};

  @override
  void initState() {
    super.initState();
    // Editing a field takes its error away; the next submit checks again.
    for (final (key, c) in [
      ('name', name),
      ('born', born),
      ('email', email),
      ('phone', phone),
      ('password', password),
    ]) {
      c.addListener(() {
        if (errors.containsKey(key)) setState(() => errors = {...errors}..remove(key));
      });
    }
    password.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    for (final c in [name, born, email, phone, password]) {
      c.dispose();
    }
    super.dispose();
  }

  Map<String, String> validate() {
    final found = <String, String>{};
    if (splitName(name.text) == null) found['name'] = 'Enter your given and family names.';
    if (birthDate(born.text) == null) {
      found['born'] = 'Enter your date of birth as day, month and year, such as 02/04/1990.';
    }
    if (!isEmail(email.text)) found['email'] = 'Enter an email address like you@example.com.';
    if (!isMobile(normalisePhone(phone.text))) {
      found['phone'] = 'Enter a Cameroonian mobile number, such as 6 70 00 00 00.';
    }
    final unmet = passwordRules(password.text).where((r) => !r.met).map((r) => r.label.toLowerCase()).toList();
    if (password.text.isEmpty) {
      found['password'] = 'Choose a password.';
    } else if (unmet.isNotEmpty) {
      found['password'] = 'The password needs: ${unmet.join(', ')}.';
    }
    if (!terms) found['terms'] = 'Agree to the terms to create an account.';
    return found;
  }

  Future<void> submit() async {
    if (busy) return;
    FocusScope.of(context).unfocus();
    final found = validate();
    setState(() {
      errors = found;
      failure = null;
    });
    if (found.isNotEmpty) return;
    final (given, family) = splitName(name.text)!;
    setState(() => busy = true);
    try {
      await widget.session.auth.signUp(
        NewAccount(
          email: email.text.trim(),
          password: password.text,
          givenName: given,
          familyName: family,
          phone: normalisePhone(phone.text),
          birthdate: birthDate(born.text)!,
        ),
      );
      if (!mounted) return;
      // The password goes with the code screen so the account signs in once confirmed.
      context.push('/verify-email', extra: (email.text.trim(), password.text));
    } on AuthFailure catch (e) {
      setState(() => failure = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> google() async {
    setState(() {
      googleBusy = true;
      failure = null;
    });
    try {
      await widget.session.auth.signInWithGoogle();
      await widget.session.refresh();
    } on AuthFailure catch (e) {
      if (mounted) setState(() => failure = e.message);
    } finally {
      if (mounted) setState(() => googleBusy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rules = passwordRules(password.text);
    final met = rules.where((r) => r.met).length;
    return _AuthPage(
      title: 'Create your\nAtria account.',
      lede: SizedBox(
        width: 285,
        child: Text('We need a phone number so reminders can reach you before a visit.', style: _lede),
      ),
      foot: FootLink(lead: 'Already have an account?', action: 'Sign in', onTap: () => context.go('/sign-in')),
      children: [
        FormCard(
          children: [
            if (failure != null) ...[Notice(failure!, tone: NoticeTone.error), const SizedBox(height: 14)],
            AtriaField(
              label: 'Full name',
              icon: 'user',
              controller: name,
              hint: 'Amina Ngo',
              capitalization: TextCapitalization.words,
              autofill: const [AutofillHints.name],
              action: TextInputAction.next,
              error: errors['name'],
            ),
            const SizedBox(height: 12),
            AtriaField(
              label: 'Date of birth',
              icon: 'calendar',
              controller: born,
              hint: 'DD/MM/YYYY',
              keyboard: TextInputType.datetime,
              autofill: const [AutofillHints.birthday],
              action: TextInputAction.next,
              error: errors['born'],
            ),
            const SizedBox(height: 12),
            AtriaField(
              label: 'Email address',
              icon: 'mail',
              controller: email,
              hint: 'you@example.com',
              keyboard: TextInputType.emailAddress,
              autofill: const [AutofillHints.email],
              action: TextInputAction.next,
              error: errors['email'],
            ),
            const SizedBox(height: 12),
            AtriaField(
              label: 'Mobile number',
              icon: 'phone',
              controller: phone,
              hint: '6 70 00 00 00',
              keyboard: TextInputType.phone,
              autofill: const [AutofillHints.telephoneNumber],
              action: TextInputAction.next,
              error: errors['phone'],
              help: 'Used only for appointment reminders. Never shared with clinics.',
            ),
            const SizedBox(height: 12),
            AtriaField(
              label: 'Password',
              icon: 'lock',
              controller: password,
              hint: 'At least $minPasswordLength characters',
              obscure: true,
              autofill: const [AutofillHints.newPassword],
              action: TextInputAction.done,
              error: errors['password'],
            ),
            if (password.text.isNotEmpty && errors['password'] == null) ...[
              const SizedBox(height: 9),
              Row(
                children: [
                  for (var i = 0; i < 4; i++) ...[
                    if (i > 0) const SizedBox(width: 5),
                    Expanded(
                      child: AnimatedContainer(
                        duration: AtriaMotion.effectsDefaultDuration,
                        height: 5,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(99),
                          color: i < met + (met == rules.length ? 1 : 0)
                              ? AtriaColors.blue500
                              : AtriaColors.lineHairline,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 7),
              Text(
                met == rules.length ? 'Good password.' : rules.firstWhere((r) => !r.met).label,
                style: AtriaType.body(size: 11, weight: FontWeight.w700, color: AtriaColors.blue500),
              ),
            ],
            const SizedBox(height: 16),
            AtriaCheckbox(
              checked: terms,
              onChanged: (v) => setState(() {
                terms = v;
                errors = {...errors}..remove('terms');
              }),
              label: 'I agree to the Atria terms of use and understand my appointment details are shared with the clinic I book.',
              error: errors['terms'],
            ),
            const SizedBox(height: 16),
            PrimaryButton(label: 'Create account', busy: busy, onPressed: googleBusy ? null : submit),
            _or(),
            SecondaryButton(
              label: googleBusy ? 'Opening Google' : 'Sign up with Google',
              onPressed: busy || googleBusy ? null : google,
              leading: _googleMark(),
            ),
          ],
        ),
      ],
    );
  }
}

// ------------------------------------------------------------- verify email

/// "Mobile · Verify email" (Figma 33:2): the six digits Cognito sent, then
/// the account signs in, so the new patient lands on Home.
class VerifyEmailScreen extends StatefulWidget {
  const VerifyEmailScreen({super.key, required this.session, required this.email, this.password});
  final Session session;
  final String email;
  final String? password;

  @override
  State<VerifyEmailScreen> createState() => _VerifyEmailScreenState();
}

class _VerifyEmailScreenState extends State<VerifyEmailScreen> {
  final code = TextEditingController();
  bool busy = false;
  String? failure;
  String? said;
  int wait = 45;
  Timer? timer;

  @override
  void initState() {
    super.initState();
    code.addListener(() => setState(() {}));
    tick();
  }

  void tick() {
    timer?.cancel();
    wait = 45;
    timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() => wait = wait > 0 ? wait - 1 : 0);
      if (wait == 0) t.cancel();
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    code.dispose();
    super.dispose();
  }

  Future<void> verify() async {
    if (busy || code.text.length != 6) return;
    setState(() {
      busy = true;
      failure = null;
    });
    try {
      await widget.session.auth.confirmSignUp(widget.email, code.text);
      if (widget.password != null) {
        await widget.session.auth.signIn(Audience.patient, widget.email, widget.password!);
        await widget.session.refresh();
      } else if (mounted) {
        context.go('/sign-in');
      }
    } on AuthFailure catch (e) {
      if (mounted) setState(() => failure = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> resend() async {
    try {
      await widget.session.auth.resendSignUpCode(widget.email);
      setState(() {
        said = 'A new code is on its way to ${widget.email}.';
        failure = null;
      });
      tick();
    } on AuthFailure catch (e) {
      setState(() => failure = e.message);
    }
  }

  @override
  Widget build(BuildContext context) => _AuthPage(
    icon: 'mail',
    title: 'Confirm your\nemail address.',
    lede: Text.rich(
      TextSpan(
        style: _lede,
        children: [
          const TextSpan(text: 'We sent a six-digit code to '),
          TextSpan(
            text: widget.email,
            style: _lede.copyWith(fontWeight: FontWeight.w700, color: P.white),
          ),
          const TextSpan(text: '. It expires in 24 hours.'),
        ],
      ),
    ),
    foot: const Notice(
      'Codes sometimes land in spam or promotions. If it still hasn\'t arrived after a minute, resend it, then check the address is spelled right.',
    ),
    children: [
      if (failure != null) ...[Notice(failure!, tone: NoticeTone.error), const SizedBox(height: 14)],
      if (said != null && failure == null) ...[Notice(said!, tone: NoticeTone.success), const SizedBox(height: 14)],
      CodeBoxes(controller: code, invalid: failure != null, onComplete: (_) => verify()),
      const SizedBox(height: 22),
      PrimaryButton(label: 'Verify and continue', busy: busy, onPressed: code.text.length == 6 ? verify : null),
      const SizedBox(height: 10),
      FootLink(
        lead: "Didn't get it?",
        action: wait > 0 ? 'Resend in 0:${wait.toString().padLeft(2, '0')}' : 'Resend the code',
        onTap: wait > 0 ? null : resend,
      ),
    ],
  );
}

// ---------------------------------------------------------- forgot password

/// "Mobile · Forgot password" (Figma 33:44). Cognito sends a code rather than
/// a link, so the second step takes the code and the new password together.
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key, required this.session, this.audience = Audience.patient});
  final Session session;
  final Audience audience;

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final email = TextEditingController();
  final code = TextEditingController();
  final password = TextEditingController();
  bool sent = false;
  bool busy = false;
  String? failure;
  String? passwordError;

  @override
  void initState() {
    super.initState();
    for (final c in [email, code, password]) {
      c.addListener(() => setState(() {}));
    }
  }

  @override
  void dispose() {
    for (final c in [email, code, password]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> send() async {
    if (!isEmail(email.text) || busy) return;
    setState(() {
      busy = true;
      failure = null;
    });
    try {
      await widget.session.auth.forgotPassword(widget.audience, email.text);
      if (mounted) setState(() => sent = true);
    } on AuthFailure catch (e) {
      if (mounted) setState(() => failure = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> reset() async {
    final unmet = passwordRules(password.text).where((r) => !r.met).map((r) => r.label.toLowerCase()).toList();
    setState(() => passwordError = unmet.isEmpty ? null : 'The password needs: ${unmet.join(', ')}.');
    if (unmet.isNotEmpty || code.text.length != 6 || busy) return;
    setState(() {
      busy = true;
      failure = null;
    });
    try {
      await widget.session.auth.confirmNewPassword(widget.audience, email.text, code.text, password.text);
      await widget.session.auth.signIn(widget.audience, email.text, password.text);
      await widget.session.refresh();
    } on AuthFailure catch (e) {
      if (mounted) setState(() => failure = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => _AuthPage(
    icon: 'lock',
    title: 'Reset your password.',
    lede: Text(
      sent
          ? 'We sent a six-digit code to ${email.text.trim()}. Enter it with your new password.'
          : 'Enter the email on your Atria account and we will send a code to set a new password.',
      style: _lede,
    ),
    foot: FootLink(
      lead: 'Remembered it?',
      action: 'Back to sign in',
      onTap: () => context.go(widget.audience == Audience.staff ? '/staff/sign-in' : '/sign-in'),
    ),
    children: [
      FormCard(
        children: [
          if (failure != null) ...[Notice(failure!, tone: NoticeTone.error), const SizedBox(height: 14)],
          if (!sent) ...[
            AtriaField(
              label: 'Email address',
              icon: 'mail',
              controller: email,
              hint: 'you@example.com',
              keyboard: TextInputType.emailAddress,
              autofill: const [AutofillHints.email],
              onSubmitted: (_) => send(),
            ),
            const SizedBox(height: 16),
            PrimaryButton(label: 'Send the code', busy: busy, onPressed: isEmail(email.text) ? send : null),
          ] else ...[
            CodeBoxes(controller: code),
            const SizedBox(height: 14),
            AtriaField(
              label: 'New password',
              icon: 'lock',
              controller: password,
              hint: 'At least $minPasswordLength characters',
              obscure: true,
              autofill: const [AutofillHints.newPassword],
              error: passwordError,
            ),
            const SizedBox(height: 16),
            PrimaryButton(
              label: 'Set the new password',
              busy: busy,
              onPressed: code.text.length == 6 && password.text.isNotEmpty ? reset : null,
            ),
          ],
        ],
      ),
      if (widget.audience == Audience.patient) ...[
        const SizedBox(height: 16),
        const Notice(
          "Signed up with Google? You don't have an Atria password: use the Google button on the sign-in screen instead.",
        ),
      ],
    ],
  );
}

// --------------------------------------------------------- finish account

/// Finishing a patient account (2026-09-29), as on the web: Google gives a
/// name and an email only, so GET /me names what the record still lacks and
/// the app asks for it before anything else, at every sign-in until given.
class CompleteProfileScreen extends StatefulWidget {
  const CompleteProfileScreen({super.key, required this.session, required this.me});
  final Session session;
  final Me me;

  @override
  State<CompleteProfileScreen> createState() => _CompleteProfileScreenState();
}

class _CompleteProfileScreenState extends State<CompleteProfileScreen> {
  final phone = TextEditingController();
  final born = TextEditingController();
  bool terms = false;
  bool busy = false;
  String? failure;
  Map<String, String> errors = {};

  List<String> get missing => widget.me.missing;

  @override
  void dispose() {
    phone.dispose();
    born.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    final found = <String, String>{};
    if (missing.contains('phone') && !isMobile(normalisePhone(phone.text))) {
      found['phone'] = 'Enter a Cameroonian mobile number, such as 6 70 00 00 00.';
    }
    if (missing.contains('dateOfBirth') && birthDate(born.text) == null) {
      found['born'] = 'Enter your date of birth as day, month and year, such as 02/04/1990.';
    }
    if (missing.contains('terms') && !terms) found['terms'] = 'Agree to the terms to use Atria.';
    setState(() {
      errors = found;
      failure = null;
    });
    if (found.isNotEmpty || busy) return;
    setState(() => busy = true);
    try {
      await widget.session.api.send('PATCH', '/me', {
        if (missing.contains('phone')) 'phoneE164': normalisePhone(phone.text),
        if (missing.contains('dateOfBirth')) 'dateOfBirth': birthDate(born.text),
        if (missing.contains('terms')) 'acceptTerms': true,
      });
      await widget.session.refresh();
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final given = widget.me.givenName;
    return _AuthPage(
      back: false,
      title: 'Finish your account${given == null ? '' : ', $given'}.',
      lede: Text(
        [
          if (missing.contains('phone')) 'Your reminders come by text, so we need your mobile.',
          if (missing.contains('dateOfBirth')) 'Your date of birth decides which visits you can book for yourself.',
          if (!missing.contains('phone') && !missing.contains('dateOfBirth')) 'One last step before you book.',
        ].join(' '),
        style: _lede,
      ),
      foot: FootLink(lead: 'Not you?', action: 'Sign out', onTap: () => widget.session.signOut()),
      children: [
        FormCard(
          children: [
            if (failure != null) ...[Notice(failure!, tone: NoticeTone.error), const SizedBox(height: 14)],
            if (missing.contains('phone')) ...[
              AtriaField(
                label: 'Mobile number',
                icon: 'phone',
                controller: phone,
                hint: '6 70 00 00 00',
                keyboard: TextInputType.phone,
                autofill: const [AutofillHints.telephoneNumber],
                error: errors['phone'],
                help: 'Used only for appointment reminders.',
              ),
              const SizedBox(height: 12),
            ],
            if (missing.contains('dateOfBirth')) ...[
              AtriaField(
                label: 'Date of birth',
                icon: 'calendar',
                controller: born,
                hint: 'DD/MM/YYYY',
                keyboard: TextInputType.datetime,
                autofill: const [AutofillHints.birthday],
                error: errors['born'],
              ),
              const SizedBox(height: 12),
            ],
            if (missing.contains('terms')) ...[
              AtriaCheckbox(
                checked: terms,
                onChanged: (v) => setState(() => terms = v),
                label: 'I agree to the Atria terms of use and privacy notice.',
                error: errors['terms'],
              ),
              const SizedBox(height: 16),
            ],
            PrimaryButton(label: 'Continue', busy: busy, onPressed: submit),
          ],
        ),
      ],
    );
  }
}

// ---------------------------------------------------------- restore account

/// A patient who deleted their account signs in again inside the 30 days
/// (2026-09-29): the app offers to take it back before anything else.
class RestoreAccountScreen extends StatefulWidget {
  const RestoreAccountScreen({super.key, required this.session, required this.me});
  final Session session;
  final Me me;

  @override
  State<RestoreAccountScreen> createState() => _RestoreAccountScreenState();
}

class _RestoreAccountScreenState extends State<RestoreAccountScreen> {
  bool busy = false;
  String? failure;

  Future<void> restore() async {
    setState(() {
      busy = true;
      failure = null;
    });
    try {
      await widget.session.api.send('POST', '/me/restore');
      await widget.session.refresh();
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final purge = DateTime.tryParse(widget.me.deletion?['purgeAt'] as String? ?? '');
    final days = purge == null ? null : purge.difference(DateTime.now()).inHours ~/ 24 + 1;
    return _AuthPage(
      back: false,
      icon: 'repeat',
      title: 'Your account is deleted.',
      lede: Text(
        days == null
            ? 'You can still take it back as it was.'
            : 'It is erased in $days ${days == 1 ? 'day' : 'days'}. Until then you can take it back as it was.',
        style: _lede,
      ),
      children: [
        FormCard(
          children: [
            if (failure != null) ...[Notice(failure!, tone: NoticeTone.error), const SizedBox(height: 14)],
            const Notice('Visits cancelled when you deleted it stay cancelled; book again once it is restored.'),
            const SizedBox(height: 16),
            PrimaryButton(label: 'Restore my account', busy: busy, onPressed: restore),
            const SizedBox(height: 10),
            SecondaryButton(
              label: 'Keep it deleted and sign out',
              onPressed: busy ? null : () => widget.session.signOut(),
            ),
          ],
        ),
        const SizedBox(height: 14),
        Text(
          '${AtriaConfig.hospital} keeps your past visits without your name once the account is erased.',
          textAlign: TextAlign.center,
          style: AtriaType.body(size: 11.5, color: AtriaColors.inkSoft),
        ),
      ],
    );
  }
}

// ------------------------------------------------------ staff first sign-in

/// A staff member's first sign-in (FR-ACC-05, the web's FirstSignIn): the
/// temporary password the administrator issued is replaced by one of their
/// own before anything else opens.
class NewStaffPasswordScreen extends StatefulWidget {
  const NewStaffPasswordScreen({super.key, required this.session});
  final Session session;

  @override
  State<NewStaffPasswordScreen> createState() => _NewStaffPasswordScreenState();
}

class _NewStaffPasswordScreenState extends State<NewStaffPasswordScreen> {
  final password = TextEditingController();
  final again = TextEditingController();
  bool busy = false;
  String? failure;

  @override
  void initState() {
    super.initState();
    password.addListener(() => setState(() {}));
    again.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    password.dispose();
    again.dispose();
    super.dispose();
  }

  Future<void> save() async {
    setState(() {
      busy = true;
      failure = null;
    });
    try {
      final step = await widget.session.auth.setNewPassword(password.text);
      if (step == SignInStep.authenticatorCode) {
        await widget.session.auth.signOut();
        if (mounted) setState(() => failure = 'Administrators use the Atria console on the web.');
        return;
      }
      final state = await widget.session.refresh();
      if (mounted && state is Unresolved) setState(() => failure = state.message);
    } on AuthFailure catch (e) {
      if (mounted) setState(() => failure = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rules = passwordRules(password.text);
    final matches = again.text.isNotEmpty && again.text == password.text;
    final ready = rules.every((r) => r.met) && matches;
    return AuthFrame(
      icon: 'key',
      title: 'Choose your password.',
      lede: 'Your administrator gave you a temporary one. Set your own to open the console.',
      onBack: () async {
        await widget.session.auth.signOut();
        if (context.mounted) context.go('/staff/sign-in');
      },
      children: [
        if (failure != null) ...[Note(failure!, error: true), const SizedBox(height: 16)],
        Field(
          label: 'New password',
          controller: password,
          obscure: true,
          autofill: const [AutofillHints.newPassword],
          hint: 'At least $minPasswordLength characters',
        ),
        const SizedBox(height: 12),
        for (final r in rules)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              children: [
                AtriaIcon(r.met ? 'checkMark' : 'close', size: 14, color: r.met ? P.blue700 : P.ink4),
                const SizedBox(width: 8),
                Text(r.label, style: T.small(color: r.met ? P.ink : P.ink3)),
              ],
            ),
          ),
        const SizedBox(height: 10),
        Field(
          label: 'The same again',
          controller: again,
          obscure: true,
          error: again.text.isNotEmpty && !matches ? 'The two passwords differ.' : null,
          onSubmitted: (_) => ready ? save() : null,
        ),
        const SizedBox(height: 20),
        Btn('Save and continue', busy: busy, onPressed: ready ? save : null),
      ],
    );
  }
}
