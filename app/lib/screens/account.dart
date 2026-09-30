import 'dart:math' as math;
import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api.dart';
import '../auth/auth.dart';
import '../auth/forms.dart';
import '../auth/session.dart';
import '../config.dart';
import '../patient/data.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/expressive.dart';
import '../ui/form_parts.dart';
import '../ui/glass.dart';
import '../ui/icons.dart';
import '../ui/loading.dart';
import '../ui/sheets.dart';
import '../ui/widgets.dart';

const _months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

String languageName(String? code) => code == 'fr' ? 'Français' : 'English';

/// "+237 6 70 •• •• 42": the mobile with its middle hidden, as the web shows it.
String maskedPhone(String? e164) {
  if (e164 == null || e164.length < 8) return 'Not given';
  final last = e164.substring(e164.length - 2);
  // A Cameroonian mobile as the desk reads it: +237 6 70 •• •• 42.
  final cm = RegExp(r'^\+237(\d)(\d{2})\d{4}(\d{2})$').firstMatch(e164);
  if (cm != null) return '+237 ${cm[1]} ${cm[2]} •• •• ${cm[3]}';
  return '${e164.substring(0, e164.length - 6)} •• •• $last';
}

/// "14 March 1994 · 32 years".
String bornLine(String? iso) {
  final born = DateTime.tryParse(iso ?? '');
  if (born == null) return 'Not given';
  final now = DateTime.now();
  var years = now.year - born.year;
  if (now.month < born.month || (now.month == born.month && now.day < born.day)) years--;
  return '${born.day} ${_months[born.month - 1]} ${born.year} · $years years';
}

// ------------------------------------------------------------------ account

/// "Mobile · Account" (Figma 41:2), with what the web's Account does
/// (2026-09-28/29): the name, email and language changed here, the units on
/// the hospital's map, the account deleted with 30 days to take it back.
class AccountScreen extends StatelessWidget {
  const AccountScreen({super.key, required this.session, required this.store});
  final Session session;
  final PatientStore store;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      // The session too: a changed name or email shows at once.
      listenable: Listenable.merge([session, store]),
      builder: (context, _) {
        final state = session.state;
        if (state is! SignedIn) return const SizedBox.shrink();
        final me = state.me;
        final data = store.state is DataReady ? (store.state as DataReady).data : null;
        final ahead = data == null ? null : upcoming(data.appointments).length;
        final done = data?.appointments.where((a) => a.state == 'COMPLETED').length;
        final units = data?.clinics.length;
        return ListView(
          padding: const EdgeInsets.fromLTRB(20, 18, 20, 124),
          children: [
            Rise(
              child: Row(
                children: [
                  Expanded(child: Text('Account', style: AtriaType.display(size: 27).copyWith(letterSpacing: -.675))),
                  PressableSurface(
                    semanticLabel: 'Change your details',
                    radius: 15,
                    width: 44,
                    height: 44,
                    border: Border.all(color: Colors.white),
                    gradient: cssGradient(140, const [Color(0xF0FFFFFF), Color(0xA8FFFFFF)], [.145, .855]),
                    shadow: const BoxShadow(offset: Offset(0, 2), blurRadius: 8, color: Color(0x140F295E)),
                    ink: AtriaColors.blue700,
                    onTap: () => context.go('/account/details'),
                    child: const AtriaIcon('pencil', size: 18, color: AtriaColors.ink900),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Rise(
              index: 1,
              child: _Hero(me: me, upcoming: ahead, completed: done, units: units),
            ),
            const SizedBox(height: 16),
            Rise(
              index: 2,
              child: _Section(
                title: 'PERSONAL',
                rows: [
                  _RowData(
                    'user',
                    AtriaColors.blue600,
                    'Personal details',
                    '${me.name} · ${languageName(me.preferredLanguage ?? (me.languages.isEmpty ? null : me.languages.first))}',
                    onTap: () => context.go('/account/details'),
                  ),
                  _RowData(
                    'mail',
                    AtriaColors.blue600,
                    'Email',
                    me.email ?? 'Not given',
                    onTap: () => context.go('/account/email'),
                  ),
                  _RowData(
                    'phone',
                    AtriaColors.confirmed,
                    'Contact',
                    '${maskedPhone(me.phoneE164)} · ${me.phoneVerified ? 'verified' : 'not verified yet'}',
                  ),
                  _RowData('calendar', AtriaColors.confirmed, 'Date of birth', bornLine(me.dateOfBirth)),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Rise(
              index: 3,
              child: _Section(
                title: 'PREFERENCES',
                rows: [
                  const _RowData(
                    'bell',
                    AtriaColors.awaiting,
                    'Notifications',
                    'Reminders, confirmations',
                    end: 'SMS + email',
                  ),
                  const _RowData(
                    'clock',
                    AtriaColors.blue600,
                    'Reminder timing',
                    'How far ahead we text you',
                    end: '24 hours',
                  ),
                  _RowData(
                    'pin',
                    AtriaColors.blue600,
                    'Units',
                    'Where each one is, and the way to its door',
                    end: units == null ? null : '$units',
                    onTap: () => context.go('/account/units'),
                  ),
                  _RowData(
                    'shield',
                    AtriaColors.inkSoft,
                    'Privacy and data',
                    'Who can see your records',
                    onTap: () => _privacy(context),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Rise(
              index: 4,
              child: _Section(
                title: 'ACCOUNT',
                rows: [
                  _RowData(
                    'close',
                    AtriaColors.cancelled,
                    'Delete your account',
                    'Upcoming visits are cancelled. You have 30 days to change your mind.',
                    danger: true,
                    onTap: () => _delete(context),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Rise(
              index: 5,
              child: PressableSurface(
                color: Colors.white,
                border: Border.all(color: const Color(0xFFC33C4E), width: 1.5),
                radius: 18,
                height: 54,
                ink: AtriaColors.cancelled,
                onTap: () => _signOut(context),
                child: Text(
                  'Sign out',
                  style: AtriaType.body(size: 13.5, weight: FontWeight.w600, color: const Color(0xFFC33C4E)),
                ),
              ),
            ),
            const SizedBox(height: 14),
            Text(
              'Atria 1.0.0 · ${AtriaConfig.hospital}',
              textAlign: TextAlign.center,
              style: AtriaType.body(size: 11, weight: FontWeight.w600, color: AtriaColors.inkSoft),
            ),
          ],
        );
      },
    );
  }

  void _privacy(BuildContext context) => showGlassSheet(
    context,
    title: 'Who can see your record',
    children: [
      Text(
        'Only ${AtriaConfig.hospital} and you. The staff who book and see you read what they need for your visit, '
        'and every time someone opens your record it is written in the hospital\'s audit log. '
        'Atria never shares your details with anyone else.',
        style: AtriaType.body(size: 13.5, color: AtriaColors.ink700),
      ),
    ],
  );

  void _signOut(BuildContext context) => showGlassSheet(
    context,
    title: 'Sign out',
    children: [
      SheetChoice(
        icon: 'signOut',
        title: 'This device',
        sub: 'Your other devices stay signed in',
        onTap: () {
          Navigator.of(context, rootNavigator: true).pop();
          session.signOut();
        },
      ),
      const SizedBox(height: 10),
      SheetChoice(
        icon: 'globe',
        title: 'All devices',
        sub: 'Others lose access within the hour',
        onTap: () {
          Navigator.of(context, rootNavigator: true).pop();
          session.signOut(everywhere: true);
        },
      ),
    ],
  );

  void _delete(BuildContext context) => showModalBottomSheet<void>(
    useRootNavigator: true,
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    barrierColor: const Color(0x660B1B3A),
    builder: (_) => _DeleteSheet(session: session),
  );
}

class _Hero extends StatelessWidget {
  const _Hero({required this.me, required this.upcoming, required this.completed, required this.units});
  final Me me;
  final int? upcoming;
  final int? completed;
  final int? units;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(22),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(30),
        gradient: cssGradient(
          155,
          const [AtriaColors.blue500, AtriaColors.blue600, Color(0xFF1E52C4)],
          [.144, .486, .856],
        ),
        boxShadow: const [BoxShadow(offset: Offset(0, 14), blurRadius: 32, color: Color(0x521E52C4))],
      ),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          // The specular light at the card's top right (41:12).
          Positioned(
            right: -80,
            top: -92,
            child: ImageFiltered(
              imageFilter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
              child: Container(
                width: 220,
                height: 220,
                decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white.withValues(alpha: .16)),
              ),
            ),
          ),
          Column(
            children: [
              Row(
                children: [
                  Container(
                    width: 70,
                    height: 70,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(24),
                      gradient: cssGradient(150, const [Color(0xF2FFFFFF), Color(0xBDFFFFFF)], [.134, .866]),
                      boxShadow: const [BoxShadow(offset: Offset(0, 8), blurRadius: 18, color: Color(0x380A2460))],
                    ),
                    child: Text(
                      initials(me.givenName, me.familyName),
                      style: AtriaType.display(size: 22, color: const Color(0xFF1E52C4)),
                    ),
                  ),
                  const SizedBox(width: 15),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          me.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AtriaType.display(size: 20, weight: FontWeight.w600, color: Colors.white),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          me.email ?? '',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AtriaType.body(size: 12.5, color: Colors.white),
                        ),
                        const SizedBox(height: 10),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(999),
                            color: Colors.white.withValues(alpha: .16),
                            border: Border.all(color: Colors.white.withValues(alpha: .6)),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const AtriaIcon('checkMark', size: 11, color: Colors.white),
                              const SizedBox(width: 6),
                              Text(
                                'PATIENT ACCOUNT',
                                style: AtriaType.body(
                                  size: 10,
                                  weight: FontWeight.w700,
                                  color: Colors.white,
                                ).copyWith(letterSpacing: .3),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              Container(
                decoration: glassOnAccent(20),
                child: Row(
                  children: [
                    for (final (n, label) in [(upcoming, 'Upcoming'), (completed, 'Completed'), (units, 'Units')])
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 13, horizontal: 6),
                          child: Column(
                            children: [
                              Pop(
                                value: n ?? -1,
                                child: Text(
                                  n == null ? '–' : '$n',
                                  style: AtriaType.display(size: 19, color: Colors.white).copyWith(height: 1.2),
                                ),
                              ),
                              Text(
                                label,
                                style: AtriaType.body(size: 10, weight: FontWeight.w600, color: Colors.white),
                              ),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _RowData {
  const _RowData(this.icon, this.tone, this.title, this.sub, {this.end, this.onTap, this.danger = false});
  final String icon;
  final Color tone;
  final String title;
  final String sub;
  final String? end;
  final VoidCallback? onTap;
  final bool danger;
}

/// A labelled group of rows on glass (41:37): a solid icon tile, the title and
/// its line, then a value or a chevron. A row that opens something presses.
class _Section extends StatelessWidget {
  const _Section({required this.title, required this.rows});
  final String title;
  final List<_RowData> rows;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(4, 0, 4, 10),
        child: Text(
          title,
          style: AtriaType.body(
            size: 11,
            weight: FontWeight.w700,
            color: AtriaColors.inkSoft,
          ).copyWith(letterSpacing: 1.1),
        ),
      ),
      Glass(
        radius: 26,
        from: .95,
        to: .74,
        child: Column(
          children: [
            for (var i = 0; i < rows.length; i++) ...[
              if (i > 0) const Divider(height: 1, thickness: 1, color: AtriaColors.surfaceGround),
              _Row(row: rows[i], first: i == 0, last: i == rows.length - 1),
            ],
          ],
        ),
      ),
    ],
  );
}

class _Row extends StatelessWidget {
  const _Row({required this.row, required this.first, required this.last});
  final _RowData row;
  final bool first;
  final bool last;

  @override
  Widget build(BuildContext context) {
    final content = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 17, vertical: 15),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(color: row.tone, borderRadius: BorderRadius.circular(13)),
            child: Center(child: AtriaIcon(row.icon, size: 18, color: Colors.white)),
          ),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  row.title,
                  style: AtriaType.body(
                    size: 13.5,
                    weight: FontWeight.w600,
                    color: row.danger ? AtriaColors.cancelledInk : AtriaColors.inkPrimary,
                    height: 1.3,
                  ),
                ),
                const SizedBox(height: 2),
                Text(row.sub, style: AtriaType.body(size: 11.5, color: AtriaColors.inkSoft, height: 1.35)),
              ],
            ),
          ),
          if (row.end != null) ...[
            const SizedBox(width: 10),
            Text(
              row.end!,
              style: AtriaType.body(size: 12, weight: FontWeight.w600, color: AtriaColors.inkSoft),
            ),
          ],
          if (row.onTap != null) ...[
            const SizedBox(width: 8),
            const AtriaIcon('chevronRight', size: 16, color: AtriaColors.ink400),
          ],
        ],
      ),
    );
    if (row.onTap == null) return Semantics(container: true, child: content);
    return Pressable(
      onTap: row.onTap,
      radius: 0,
      scale: .985,
      ink: row.danger ? AtriaColors.cancelled : AtriaColors.blue700,
      semanticLabel: '${row.title}, ${row.sub}',
      builder: (context, _) => ExcludeSemantics(child: content),
    );
  }
}

/// Deleting one's own account (2026-09-29), as the web's dialog says it:
/// what happens at once, and that nothing is erased for 30 days.
class _DeleteSheet extends StatefulWidget {
  const _DeleteSheet({required this.session});
  final Session session;

  @override
  State<_DeleteSheet> createState() => _DeleteSheetState();
}

class _DeleteSheetState extends State<_DeleteSheet> {
  bool busy = false;
  String? failure;

  Future<void> delete() async {
    setState(() {
      busy = true;
      failure = null;
    });
    try {
      await widget.session.api.send('DELETE', '/me');
      if (!mounted) return;
      Navigator.of(context).pop();
      await widget.session.signOut();
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => GlassSheet(
    title: 'Delete your Atria account?',
    icon: Container(
      width: 46,
      height: 46,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        gradient: cssGradient(160, const [Color(0xFFE8606F), Color(0xFFC33C4E)]),
      ),
      child: const Center(child: AtriaIcon('close', size: 20, color: Colors.white)),
    ),
    children: [
      Text(
        'You will be signed out, and ${AtriaConfig.hospital} stops holding your appointments.',
        style: AtriaType.body(size: 13.5, color: AtriaColors.ink700),
      ),
      const SizedBox(height: 12),
      for (final point in const [
        'Your upcoming visits and queue places are cancelled and their times given back.',
        'Sign in again within 30 days to restore your account.',
        'After 30 days your details are erased for good.',
      ])
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(top: 7, right: 10),
                child: Container(
                  width: 5,
                  height: 5,
                  decoration: const BoxDecoration(shape: BoxShape.circle, color: AtriaColors.inkSoft),
                ),
              ),
              Expanded(
                child: Text(point, style: AtriaType.body(size: 13, color: AtriaColors.ink700)),
              ),
            ],
          ),
        ),
      const SizedBox(height: 8),
      const Notice('Nothing is erased for 30 days. Until then the account can be restored exactly as it was.'),
      if (failure != null) ...[const SizedBox(height: 12), Notice(failure!, tone: NoticeTone.error)],
      const SizedBox(height: 16),
      Row(
        children: [
          Expanded(
            child: SecondaryButton(label: 'Keep it', onPressed: busy ? null : () => Navigator.of(context).pop()),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: PrimaryButton(label: 'Delete', danger: true, busy: busy, onPressed: delete),
          ),
        ],
      ),
    ],
  );
}

// ------------------------------------------------------------ edit details

/// A frame for the account's sub-screens: back, a title, glass content.
class _SubPage extends StatelessWidget {
  const _SubPage({required this.title, required this.lede, required this.children});
  final String title;
  final String lede;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Scaffold(
    body: PageBackground(
      child: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
          children: [
            const Align(
              alignment: Alignment.centerLeft,
              child: Rise(child: BackSquare()),
            ),
            const SizedBox(height: 18),
            Rise(index: 1, child: Text(title, style: AtriaType.display(size: 27).copyWith(letterSpacing: -.675))),
            const SizedBox(height: 6),
            Rise(
              index: 1,
              child: Text(lede, style: AtriaType.body(size: 13.5, color: const Color(0xFF54658A), height: 1.45)),
            ),
            const SizedBox(height: 18),
            Rise(
              index: 2,
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
            ),
          ],
        ),
      ),
    ),
  );
}

/// The name and the language, through PATCH /me (as the web's EditDetails).
class EditDetailsScreen extends StatefulWidget {
  const EditDetailsScreen({super.key, required this.session});
  final Session session;

  @override
  State<EditDetailsScreen> createState() => _EditDetailsScreenState();
}

class _EditDetailsScreenState extends State<EditDetailsScreen> {
  late final Me me = (widget.session.state as SignedIn).me;
  late final given = TextEditingController(text: me.givenName ?? '');
  late final family = TextEditingController(text: me.familyName ?? '');
  late String language = me.preferredLanguage ?? (me.languages.isEmpty ? 'en' : me.languages.first);
  bool busy = false;
  String? failure;
  String? said;

  @override
  void dispose() {
    given.dispose();
    family.dispose();
    super.dispose();
  }

  Future<void> save() async {
    if (given.text.trim().isEmpty || family.text.trim().isEmpty) {
      setState(() => failure = 'Enter your given and family names.');
      return;
    }
    setState(() {
      busy = true;
      failure = null;
      said = null;
    });
    try {
      await widget.session.api.send('PATCH', '/me', {
        'givenName': given.text.trim(),
        'familyName': family.text.trim(),
        'preferredLanguage': language,
      });
      await widget.session.refresh();
      if (mounted) setState(() => said = 'Saved. The front desk sees your name as you have it now.');
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => _SubPage(
    title: 'Personal details',
    lede: 'Change your name and the language messages come in. The front desk can correct the rest.',
    children: [
      FormCard(
        children: [
          if (failure != null) ...[Notice(failure!, tone: NoticeTone.error), const SizedBox(height: 14)],
          if (said != null) ...[Notice(said!, tone: NoticeTone.success), const SizedBox(height: 14)],
          AtriaField(label: 'Given name', icon: 'user', controller: given, capitalization: TextCapitalization.words),
          const SizedBox(height: 12),
          AtriaField(label: 'Family name', icon: 'user', controller: family, capitalization: TextCapitalization.words),
          const SizedBox(height: 16),
          Text(
            'Language',
            style: AtriaType.body(size: 12, weight: FontWeight.w600, color: AtriaColors.inkSoft),
          ),
          const SizedBox(height: 7),
          Segmented(
            labels: const ['English', 'Français'],
            selected: language == 'fr' ? 1 : 0,
            onChanged: (i) => setState(() => language = i == 1 ? 'fr' : 'en'),
          ),
          const SizedBox(height: 18),
          PrimaryButton(label: 'Save', busy: busy, onPressed: save),
        ],
      ),
    ],
  );
}

/// A new email: Cognito's code to the new address, then POST /me/email takes
/// the address Cognito has verified (as the web's EditDetails does).
class ChangeEmailScreen extends StatefulWidget {
  const ChangeEmailScreen({super.key, required this.session});
  final Session session;

  @override
  State<ChangeEmailScreen> createState() => _ChangeEmailScreenState();
}

class _ChangeEmailScreenState extends State<ChangeEmailScreen> {
  final email = TextEditingController();
  final code = TextEditingController();
  bool sent = false;
  bool busy = false;
  String? failure;

  @override
  void initState() {
    super.initState();
    email.addListener(() => setState(() {}));
    code.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    email.dispose();
    code.dispose();
    super.dispose();
  }

  Future<void> send() async {
    setState(() {
      busy = true;
      failure = null;
    });
    try {
      await widget.session.auth.changeEmail(email.text);
      if (mounted) setState(() => sent = true);
    } on AuthFailure catch (e) {
      if (mounted) setState(() => failure = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> confirm() async {
    setState(() {
      busy = true;
      failure = null;
    });
    try {
      await widget.session.auth.confirmEmailChange(code.text);
      await widget.session.api.send('POST', '/me/email');
      await widget.session.refresh();
      if (mounted) {
        say(context, 'Your new email is verified. Confirmations go there from now on.');
        context.pop();
      }
    } on AuthFailure catch (e) {
      if (mounted) setState(() => failure = e.message);
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final current = (widget.session.state as SignedIn).me.email;
    return _SubPage(
      title: 'Email',
      lede: sent
          ? 'We sent a six-digit code to ${email.text.trim()}. Enter it to confirm the change.'
          : 'Confirmations and receipts go here. ${current == null ? '' : 'Now: $current.'}',
      children: [
        FormCard(
          children: [
            if (failure != null) ...[Notice(failure!, tone: NoticeTone.error), const SizedBox(height: 14)],
            if (!sent) ...[
              AtriaField(
                label: 'New email address',
                icon: 'mail',
                controller: email,
                hint: current ?? 'you@example.com',
                keyboard: TextInputType.emailAddress,
                autofill: const [AutofillHints.email],
              ),
              const SizedBox(height: 16),
              PrimaryButton(label: 'Send the code', busy: busy, onPressed: isEmail(email.text) ? send : null),
            ] else ...[
              CodeBoxes(controller: code, invalid: failure != null),
              const SizedBox(height: 16),
              PrimaryButton(label: 'Confirm', busy: busy, onPressed: code.text.length == 6 ? confirm : null),
            ],
          ],
        ),
      ],
    );
  }
}

// ------------------------------------------------------------------ units

/// The hospital's units on a map of the site (2026-09-28), as the web draws
/// it: each placed unit a pin; choosing one, from its pin or the list, shows
/// where it is inside, its hours, and walking directions to its own door.
class UnitsScreen extends StatefulWidget {
  const UnitsScreen({super.key, required this.store});
  final PatientStore store;

  @override
  State<UnitsScreen> createState() => _UnitsScreenState();
}

class _UnitsScreenState extends State<UnitsScreen> {
  String? chosen;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.store,
    builder: (context, _) {
      final state = widget.store.state;
      if (state is! DataReady) {
        return const _SubPage(
          title: 'Units',
          lede: '',
          children: [LoadingPane(label: 'Loading the units')],
        );
      }
      final clinics = state.data.clinics;
      final pick = clinics.where((c) => c.id == chosen).firstOrNull ?? clinics.firstOrNull;
      return _SubPage(
        title: 'Units',
        lede: 'The units of ${AtriaConfig.hospital} you can book: where each one is, and the way to its door.',
        children: [
          _SiteMap(clinics: clinics, chosen: pick?.id, onChoose: (id) => setState(() => chosen = id)),
          const SizedBox(height: 14),
          if (pick != null) _UnitDetail(clinic: pick),
          const SizedBox(height: 14),
          Glass(
            radius: 24,
            child: Column(
              children: [
                for (var i = 0; i < clinics.length; i++) ...[
                  if (i > 0) const Divider(height: 1, thickness: 1, color: AtriaColors.surfaceGround),
                  Pressable(
                    radius: 0,
                    scale: .985,
                    ink: AtriaColors.blue700,
                    semanticLabel: clinics[i].name,
                    onTap: () => setState(() => chosen = clinics[i].id),
                    builder: (context, _) => AnimatedContainer(
                      duration: AtriaMotion.effectsDefaultDuration,
                      color: clinics[i].id == pick?.id ? AtriaColors.blue100.withValues(alpha: .6) : Colors.transparent,
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  clinics[i].name,
                                  style: AtriaType.body(
                                    size: 13.5,
                                    weight: FontWeight.w600,
                                    color: AtriaColors.inkPrimary,
                                  ),
                                ),
                                if (clinics[i].whereInside.isNotEmpty)
                                  Text(
                                    clinics[i].whereInside,
                                    style: AtriaType.body(size: 11.5, color: AtriaColors.inkSoft),
                                  ),
                              ],
                            ),
                          ),
                          const AtriaIcon('chevronRight', size: 16, color: AtriaColors.ink400),
                        ],
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      );
    },
  );
}

class _UnitDetail extends StatelessWidget {
  const _UnitDetail({required this.clinic});
  final Clinic clinic;

  static const _days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  @override
  Widget build(BuildContext context) => AnimatedSwitcher(
    duration: AtriaMotion.spatialDefaultDuration,
    switchInCurve: AtriaMotion.spatialDefault,
    transitionBuilder: (child, animation) => FadeTransition(
      opacity: animation,
      child: SlideTransition(
        position: Tween(begin: const Offset(0, .04), end: Offset.zero).animate(animation),
        child: child,
      ),
    ),
    child: Glass(
      key: ValueKey(clinic.id),
      radius: 24,
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(clinic.name, style: AtriaType.display(size: 17, weight: FontWeight.w600)),
          Text(
            [clinic.whereInside, clinic.address].whereType<String>().where((s) => s.isNotEmpty).join(' · '),
            style: AtriaType.body(size: 12, color: AtriaColors.inkSoft),
          ),
          if (clinic.walkingDirections != null) ...[
            const SizedBox(height: 10),
            Text(clinic.walkingDirections!, style: AtriaType.body(size: 13, color: AtriaColors.ink700)),
          ],
          const SizedBox(height: 10),
          for (var d = 0; d < 7; d++)
            Container(
              padding: const EdgeInsets.symmetric(vertical: 7),
              decoration: const BoxDecoration(
                border: Border(top: BorderSide(color: AtriaColors.lineHairline)),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(_days[d], style: AtriaType.body(size: 12.5, color: AtriaColors.inkSoft)),
                  ),
                  Text(switch (clinic.openingHours?['$d']) {
                    {'start': final String a, 'end': final String b} => '$a to $b',
                    _ => 'Closed',
                  }, style: AtriaType.body(size: 12.5, weight: FontWeight.w600, color: AtriaColors.inkPrimary)),
                ],
              ),
            ),
          const SizedBox(height: 12),
          PressableSurface(
            gradient: cssGradient(171, const [AtriaColors.blue500, AtriaColors.blue700], [.145, .855]),
            shadow: const BoxShadow(offset: Offset(0, 10), blurRadius: 22, color: Color(0x572461DB)),
            radius: 19,
            height: 52,
            ink: Colors.white,
            onTap: () => launchUrl(clinic.directions, mode: LaunchMode.externalApplication),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const AtriaIcon('pin', size: 17, color: Colors.white),
                const SizedBox(width: 8),
                Text(
                  clinic.entrance == null ? 'Directions to the hospital' : 'Directions to this unit',
                  style: AtriaType.body(size: 14.5, weight: FontWeight.w600, color: Colors.white),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

/// The placed entrances drawn relative to one another, a route from the gate
/// to the chosen one (drawn, not a live map: nothing is sent anywhere).
class _SiteMap extends StatelessWidget {
  const _SiteMap({required this.clinics, required this.chosen, required this.onChoose});
  final List<Clinic> clinics;
  final String? chosen;
  final ValueChanged<String> onChoose;

  @override
  Widget build(BuildContext context) {
    final placed = [
      for (final c in clinics)
        if (c.entrance != null) (clinic: c, door: c.entrance!),
    ];
    if (placed.isEmpty) {
      return Glass(
        radius: 24,
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            const AtriaIcon('pin', size: 20, color: AtriaColors.blue600),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                '${AtriaConfig.hospital} has not placed its units on the map yet. Directions lead to the hospital, and the front desk can show you the way.',
                style: AtriaType.body(size: 12.5, color: AtriaColors.ink700),
              ),
            ),
          ],
        ),
      );
    }
    return Glass(
      radius: 24,
      child: AspectRatio(
        aspectRatio: 400 / 220,
        child: LayoutBuilder(
          builder: (context, box) {
            final lats = placed.map((p) => p.door.lat);
            final lngs = placed.map((p) => p.door.lng);
            final minLat = lats.reduce(math.min), maxLat = lats.reduce(math.max);
            final minLng = lngs.reduce(math.min), maxLng = lngs.reduce(math.max);
            const pad = 30.0;
            final span = math.max(math.max(maxLat - minLat, maxLng - minLng), .0004);
            final scale = math.min(box.maxWidth - 2 * pad, box.maxHeight - 2 * pad - 16) / span;
            final ox = (box.maxWidth - (maxLng - minLng) * scale) / 2;
            final oy = (box.maxHeight - 16 - (maxLat - minLat) * scale) / 2;
            Offset at(({double lat, double lng}) d) =>
                Offset(ox + (d.lng - minLng) * scale, box.maxHeight - 16 - (oy + (d.lat - minLat) * scale));
            final gate = Offset(box.maxWidth / 2, box.maxHeight - 14);
            final pick = placed.where((p) => p.clinic.id == chosen).firstOrNull;
            return Stack(
              clipBehavior: Clip.none,
              children: [
                Positioned.fill(
                  child: TweenAnimationBuilder<double>(
                    key: ValueKey(chosen),
                    tween: Tween(begin: 0, end: 1),
                    duration: const Duration(milliseconds: 900),
                    curve: AtriaMotion.effects,
                    builder: (context, t, _) => CustomPaint(
                      painter: _SitePainter(gate: gate, to: pick == null ? null : at(pick.door), drawn: t),
                    ),
                  ),
                ),
                for (final p in placed)
                  Positioned(
                    left: at(p.door).dx - 22,
                    top: at(p.door).dy - 22,
                    child: Semantics(
                      button: true,
                      selected: p.clinic.id == chosen,
                      label: p.clinic.name,
                      child: GestureDetector(
                        onTap: () => onChoose(p.clinic.id),
                        child: SizedBox(
                          width: 44,
                          height: 44,
                          child: Center(
                            child: AnimatedContainer(
                              duration: AtriaMotion.spatialFastDuration,
                              curve: AtriaMotion.spatialFast,
                              width: p.clinic.id == chosen ? 22 : 14,
                              height: p.clinic.id == chosen ? 22 : 14,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: p.clinic.id == chosen ? AtriaColors.blue600 : Colors.white,
                                border: Border.all(
                                  color: p.clinic.id == chosen ? Colors.white : AtriaColors.blue600,
                                  width: p.clinic.id == chosen ? 3 : 2.5,
                                ),
                                boxShadow: p.clinic.id == chosen
                                    ? const [BoxShadow(offset: Offset(0, 4), blurRadius: 8, color: Color(0x732461DB))]
                                    : null,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                if (pick != null)
                  Positioned.fromRect(
                    rect: _labelSpot(pick.clinic.name, MediaQuery.textScalerOf(context), at(pick.door), gate, [
                      for (final p in placed)
                        if (p.clinic.id != chosen) at(p.door),
                    ], Size(box.maxWidth, box.maxHeight - 24)),
                    child: IgnorePointer(
                      child: Container(
                        alignment: Alignment.center,
                        padding: const EdgeInsets.symmetric(horizontal: 10),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AtriaColors.lineHairline),
                          boxShadow: const [BoxShadow(offset: Offset(0, 4), blurRadius: 10, color: Color(0x1F102A5E))],
                        ),
                        child: Text(
                          pick.clinic.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          textAlign: TextAlign.center,
                          style: _labelStyle,
                        ),
                      ),
                    ),
                  ),
                Positioned(
                  left: gate.dx - 22,
                  top: gate.dy - 9,
                  child: Container(
                    width: 44,
                    height: 18,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(color: AtriaColors.ink800, borderRadius: BorderRadius.circular(9)),
                    child: Text(
                      'Gate',
                      style: AtriaType.body(size: 10, weight: FontWeight.w600, color: Colors.white, height: 1),
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

final _labelStyle = AtriaType.body(size: 11, weight: FontWeight.w600, color: AtriaColors.inkPrimary);

/// Where the chosen unit's name sits: of the spots around its pin, the one
/// that hides no other pin and as little of the route from the gate as it can,
/// inside the map.
Rect _labelSpot(String name, TextScaler scaler, Offset pin, Offset gate, List<Offset> others, Size map) {
  final text = TextPainter(
    text: TextSpan(text: name, style: _labelStyle),
    maxLines: 1,
    textScaler: scaler,
    textDirection: TextDirection.ltr,
  )..layout();
  final w = math.min(text.width + 24, map.width - 16), gap = 16.0;
  const h = 28.0;
  Rect clampIn(Rect r) => Rect.fromLTWH(r.left.clamp(8.0, map.width - w - 8), r.top.clamp(6.0, map.height - h), w, h);
  final tries = [
    Rect.fromLTWH(pin.dx - w / 2, pin.dy - gap - h, w, h),
    Rect.fromLTWH(pin.dx + gap / 2, pin.dy - gap - h, w, h),
    Rect.fromLTWH(pin.dx - w - gap / 2, pin.dy - gap - h, w, h),
    Rect.fromLTWH(pin.dx - w / 2, pin.dy + gap, w, h),
    Rect.fromLTWH(pin.dx + gap / 2, pin.dy + gap, w, h),
    Rect.fromLTWH(pin.dx - w - gap / 2, pin.dy + gap, w, h),
    Rect.fromLTWH(pin.dx + gap, pin.dy - h / 2, w, h),
    Rect.fromLTWH(pin.dx - gap - w, pin.dy - h / 2, w, h),
  ].map(clampIn).toList();
  // The route runs up from the gate, then across to the pin.
  final route = [
    for (var t = 0.0; t <= 1; t += .05) Offset(gate.dx, gate.dy + (pin.dy - gate.dy) * t),
    for (var t = 0.0; t <= 1; t += .05) Offset(gate.dx + (pin.dx - gate.dx) * t, pin.dy),
  ];
  double cost(Rect r) =>
      (r.inflate(4).contains(pin) ? 1000.0 : 0.0) +
      100 * others.where((o) => r.inflate(14).contains(o)).length +
      route.where((o) => r.inflate(3).contains(o)).length;
  return tries.reduce((best, r) => cost(r) < cost(best) ? r : best);
}

class _SitePainter extends CustomPainter {
  _SitePainter({required this.gate, required this.to, required this.drawn});
  final Offset gate;
  final Offset? to;
  final double drawn;

  @override
  void paint(Canvas canvas, Size size) {
    final ground = RRect.fromRectAndRadius(
      Rect.fromLTWH(10, 10, size.width - 20, size.height - 20),
      const Radius.circular(18),
    );
    canvas.drawRRect(ground, Paint()..color = const Color(0x8CFFFFFF));
    final road = Paint()
      ..color = Colors.white
      ..strokeWidth = 5
      ..strokeCap = StrokeCap.round;
    canvas.drawLine(Offset(0, gate.dy), Offset(size.width, gate.dy), road);
    if (to == null) return;
    final path = Path()
      ..moveTo(gate.dx, gate.dy)
      ..lineTo(gate.dx, to!.dy)
      ..lineTo(to!.dx, to!.dy);
    // The route draws itself from the gate, as the web's does.
    for (final metric in path.computeMetrics()) {
      canvas.drawPath(
        metric.extractPath(0, metric.length * drawn),
        Paint()
          ..color = AtriaColors.blue600
          ..style = PaintingStyle.stroke
          ..strokeWidth = 3
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round,
      );
    }
  }

  @override
  bool shouldRepaint(_SitePainter old) => old.drawn != drawn || old.to != to;
}
