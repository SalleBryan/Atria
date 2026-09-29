import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api.dart';
import '../patient/data.dart';
import 'account.dart' show showGlassSheet;
import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/expressive.dart';
import '../ui/form_parts.dart';
import '../ui/glass.dart';
import '../ui/icons.dart';
import '../ui/loading.dart';
import '../ui/widgets.dart';

const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const _monthNames = [
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

/// A published session of the outpatient queue (GET /clinics/{id}/sessions).
class QueueSession {
  QueueSession(this.raw);
  final Map<String, dynamic> raw;
  String get id => raw['sessionId'] as String;
  String get date => raw['sessionDate'] as String;
  String get start => raw['startTime'] as String;
  String get end => raw['endTime'] as String;
  int get capacity => (raw['capacity'] as num?)?.toInt() ?? 0;
  int get remaining => (raw['remaining'] as num?)?.toInt() ?? 0;
  int get issued => (raw['issuedTickets'] as num?)?.toInt() ?? capacity - remaining;
  int get clinicians => (raw['rosteredClinicianCount'] as num?)?.toInt() ?? 1;
  String get part => switch (raw['partOfDay']) {
    'MORNING' => 'Morning session',
    'AFTERNOON' => 'Afternoon session',
    'EVENING' => 'Evening session',
    _ => 'Session',
  };
  DateTime get day => DateTime.parse('${date}T12:00:00Z');
}

/// The unit that runs the day's queue: the one the general consultation is offered at.
Clinic? queueUnit(PatientData data) {
  final general = data.types.where((t) => t.serviceLine == 'GENERAL').firstOrNull;
  if (general == null) return null;
  return data.clinics.where((c) => general.clinicIds.isEmpty || general.clinicIds.contains(c.id)).firstOrNull;
}

// ---------------------------------------------------------------- join

/// "Mobile · Session queue" (Figma 308:2), as the web's JoinQueue works:
/// a day, a part of the day, then a place. A session whose hours are over is
/// never offered (the API leaves it out).
class JoinQueueScreen extends StatefulWidget {
  const JoinQueueScreen({super.key, required this.store});
  final PatientStore store;

  @override
  State<JoinQueueScreen> createState() => _JoinQueueScreenState();
}

class _JoinQueueScreenState extends State<JoinQueueScreen> {
  List<QueueSession>? sessions;
  String? day;
  String? chosen;
  bool busy = false;
  String? failure;
  Clinic? unit;

  @override
  void initState() {
    super.initState();
    widget.store.addListener(_load);
    _load();
  }

  @override
  void dispose() {
    widget.store.removeListener(_load);
    super.dispose();
  }

  Future<void> _load() async {
    final state = widget.store.state;
    if (state is! DataReady || unit != null) return;
    unit = queueUnit(state.data);
    if (unit == null) {
      setState(() => sessions = const []);
      return;
    }
    try {
      final found = await widget.store.api.get('/clinics/${unit!.id}/sessions');
      final list = [for (final s in (found['sessions'] as List? ?? const [])) QueueSession(s as Map<String, dynamic>)];
      if (!mounted) return;
      setState(() {
        sessions = list;
        day = list.where((s) => s.remaining > 0).firstOrNull?.date ?? list.firstOrNull?.date;
      });
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = e.message);
    }
  }

  Future<void> join() async {
    final session = sessions?.where((s) => s.id == chosen).firstOrNull;
    if (session == null || busy) return;
    setState(() {
      busy = true;
      failure = null;
    });
    try {
      final made = await widget.store.api.send('POST', '/sessions/${session.id}/tickets');
      await widget.store.reload();
      if (!mounted) return;
      context.go('/queue/${made['appointmentId']}');
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = sessions;
    final days = {for (final s in list ?? <QueueSession>[]) s.date}.toList();
    final onDay = (list ?? <QueueSession>[]).where((s) => s.date == day).toList();
    final pick = onDay.where((s) => s.id == chosen).firstOrNull;
    final first = onDay.firstOrNull;
    return Scaffold(
      body: PageBackground(
        child: SafeArea(
          child: Column(
            children: [
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(20, 14, 20, 20),
                  children: [
                    const Rise(child: _Bar(title: 'General consultation')),
                    const SizedBox(height: 16),
                    Rise(
                      index: 1,
                      child: _QueueHero(
                        initialsOf: unit?.name ?? 'Outpatients',
                        title: unit?.name ?? 'Outpatients',
                        sub: 'General consultation · no fixed time',
                        chip: 'Queue by arrival window',
                        stats: [
                          ('${first?.capacity ?? '–'}', 'Places'),
                          ('${first?.issued ?? '–'}', 'Taken'),
                          ('~${first == null ? '–' : (60 ~/ 4.5).round()}m', 'Per patient'),
                          ('${first?.clinicians ?? '–'}', 'Clinicians'),
                        ],
                      ),
                    ),
                    const SizedBox(height: 20),
                    if (failure != null) ...[Notice(failure!, tone: NoticeTone.error), const SizedBox(height: 14)],
                    if (list == null)
                      const LoadingPane(label: 'Loading sessions')
                    else if (list.isEmpty)
                      const Notice(
                        'No sessions are published for the next two weeks yet. The desk can add you when you arrive.',
                      )
                    else ...[
                      Rise(
                        index: 2,
                        child: Row(
                          children: [
                            Expanded(
                              child: Text('Pick a day', style: AtriaType.display(size: 17, weight: FontWeight.w600)),
                            ),
                            if (day != null)
                              Text(
                                '${_monthNames[DateTime.parse('${day}T12:00:00Z').month - 1]} ${day!.substring(0, 4)}',
                                style: AtriaType.body(size: 12.5, weight: FontWeight.w600, color: AtriaColors.blue600),
                              ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 12),
                      SizedBox(
                        height: 76,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          clipBehavior: Clip.none,
                          itemCount: days.length,
                          separatorBuilder: (_, _) => const SizedBox(width: 10),
                          itemBuilder: (context, i) {
                            final d = DateTime.parse('${days[i]}T12:00:00Z');
                            final on = days[i] == day;
                            final places = list.where((s) => s.date == days[i]).fold<int>(0, (n, s) => n + s.remaining);
                            return Semantics(
                              selected: on,
                              child: Pressable(
                                radius: 20,
                                ink: AtriaColors.blue700,
                                semanticLabel: '${_weekdays[d.weekday - 1]} ${d.day}, $places places',
                                onTap: () => setState(() {
                                  day = days[i];
                                  chosen = null;
                                }),
                                builder: (context, _) => AnimatedContainer(
                                  duration: AtriaMotion.spatialFastDuration,
                                  curve: AtriaMotion.spatialFast,
                                  width: 64,
                                  decoration: BoxDecoration(
                                    gradient: on
                                        ? accentGradient()
                                        : cssGradient(160, [
                                            Colors.white.withValues(alpha: .92),
                                            Colors.white.withValues(alpha: .62),
                                          ]),
                                    borderRadius: BorderRadius.circular(on ? 24 : 20),
                                    border: Border.all(color: Colors.white),
                                    boxShadow: [
                                      if (on)
                                        const BoxShadow(offset: Offset(0, 8), blurRadius: 18, color: Color(0x572F6BE4)),
                                    ],
                                  ),
                                  child: Column(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      Text(
                                        _weekdays[d.weekday - 1],
                                        style: AtriaType.body(
                                          size: 12,
                                          color: on ? Colors.white : AtriaColors.ink700,
                                          height: 1.3,
                                        ),
                                      ),
                                      Text(
                                        '${d.day}',
                                        style: AtriaType.display(
                                          size: 21,
                                          color: on ? Colors.white : AtriaColors.inkPrimary,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            );
                          },
                        ),
                      ),
                      const SizedBox(height: 22),
                      Rise(
                        index: 3,
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                'Choose a session',
                                style: AtriaType.display(size: 17, weight: FontWeight.w600),
                              ),
                            ),
                            Text(
                              '${onDay.length} that day',
                              style: AtriaType.body(size: 12.5, weight: FontWeight.w600, color: AtriaColors.blue600),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 12),
                      for (var i = 0; i < onDay.length; i++) ...[
                        if (i > 0) const SizedBox(height: 10),
                        Rise(
                          index: 4 + i,
                          child: _SessionRow(
                            session: onDay[i],
                            on: onDay[i].id == chosen,
                            onTap: () => setState(() => chosen = onDay[i].id),
                          ),
                        ),
                      ],
                    ],
                  ],
                ),
              ),
              _Dock(
                label: pick == null ? 'No session selected' : '${pick.part} · ${pick.start} to ${pick.end}',
                title: pick == null ? 'Place assigned on join' : 'Place ${pick.issued + 1}',
                action: busy ? 'Taking a place' : 'Join queue',
                busy: busy,
                onTap: pick == null || pick.remaining == 0 ? null : join,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SessionRow extends StatelessWidget {
  const _SessionRow({required this.session, required this.on, required this.onTap});
  final QueueSession session;
  final bool on;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final full = session.remaining == 0;
    return Semantics(
      selected: on,
      child: Pressable(
        radius: 20,
        ink: AtriaColors.blue700,
        onTap: full ? null : onTap,
        semanticLabel:
            '${session.part}, ${session.start} to ${session.end}, ${full ? 'full' : '${session.remaining} places left'}',
        builder: (context, _) => AnimatedContainer(
          duration: AtriaMotion.spatialFastDuration,
          curve: AtriaMotion.spatialFast,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(
            color: full ? Colors.white.withValues(alpha: .5) : Colors.white,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: on ? AtriaColors.blue500 : Colors.white, width: on ? 2 : 1),
            boxShadow: [
              on
                  ? const BoxShadow(spreadRadius: 3, color: Color(0x264A83F0))
                  : const BoxShadow(offset: Offset(0, 2), blurRadius: 10, color: Color(0x14102A5E)),
            ],
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      session.part,
                      style: AtriaType.body(
                        size: 14,
                        weight: FontWeight.w600,
                        color: full ? AtriaColors.inkSoft : AtriaColors.inkPrimary,
                      ),
                    ),
                    Text(
                      '${session.start} to ${session.end} · ${full ? 'Full, no places left' : '${session.remaining} of ${session.capacity} places left'}',
                      style: AtriaType.body(size: 12, color: AtriaColors.inkSoft),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(color: full ? AtriaColors.ink400 : AtriaColors.confirmed, width: 1.5),
                  color: on ? AtriaColors.confirmed : null,
                ),
                child: Text(
                  full ? 'Full' : (on ? 'Chosen' : 'Join'),
                  style: AtriaType.body(
                    size: 12,
                    weight: FontWeight.w600,
                    color: full ? AtriaColors.ink400 : (on ? Colors.white : AtriaColors.confirmedInk),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// -------------------------------------------------------------- your place

/// "Mobile · Queue ticket" (Figma 310:2): the place, the window to arrive
/// in, and giving the place up, which cancels the ticket (2026-09-28).
class QueueTicketScreen extends StatefulWidget {
  const QueueTicketScreen({super.key, required this.id, required this.store});
  final String id;
  final PatientStore store;

  @override
  State<QueueTicketScreen> createState() => _QueueTicketScreenState();
}

class _QueueTicketScreenState extends State<QueueTicketScreen> {
  QueueSession? session;
  bool busy = false;
  String? failure;

  Appointment? get ticket => switch (widget.store.state) {
    DataReady(:final data) => data.appointments.where((a) => a.id == widget.id).firstOrNull,
    _ => null,
  };

  @override
  void initState() {
    super.initState();
    _session();
  }

  Future<void> _session() async {
    final id = ticket?.sessionId;
    if (id == null) return;
    try {
      final found = await widget.store.api.get('/sessions/$id');
      if (mounted) setState(() => session = QueueSession(found));
    } on ApiError {
      // The ticket stands without the session's figures.
    }
  }

  /// Giving the place up cannot be undone once the session fills, so it is
  /// asked first.
  void confirmGiveUp() => showGlassSheet(
    context,
    title: 'Give up your place?',
    children: [
      Text(
        'Your place goes to the next person waiting. If you change your mind you can join again while places are left, '
        'but you join at the back.',
        style: AtriaType.body(size: 13.5, color: AtriaColors.ink700),
      ),
      const SizedBox(height: 20),
      Builder(
        builder: (sheet) => Row(
          children: [
            Expanded(
              child: SecondaryButton(label: 'Keep my place', onPressed: () => Navigator.of(sheet).pop()),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: PrimaryButton(
                label: 'Give it up',
                danger: true,
                onPressed: () {
                  Navigator.of(sheet).pop();
                  giveUp();
                },
              ),
            ),
          ],
        ),
      ),
    ],
  );

  Future<void> giveUp() async {
    final t = ticket;
    if (t == null) return;
    setState(() {
      busy = true;
      failure = null;
    });
    try {
      await widget.store.api.send('DELETE', '/appointments/${t.id}', {'reason': 'Gave up the place'});
      await widget.store.reload();
      if (mounted) {
        say(context, 'You gave up your place');
        context.go('/visits');
      }
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  String _clock(DateTime t) {
    final local = t.toUtc().add(const Duration(hours: 1)); // hospital time, UTC+1
    return '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.store,
    builder: (context, _) {
      final t = ticket;
      final data = widget.store.state is DataReady ? (widget.store.state as DataReady).data : null;
      final clinic = data?.clinics.where((c) => c.id == t?.clinicId).firstOrNull;
      if (t == null) {
        return const Scaffold(
          body: PageBackground(child: LoadingPane(label: 'Loading your place')),
        );
      }
      final open = !t.state.contains('CANCELLED') && t.state != 'COMPLETED';
      final window = '${_clock(t.startAt)} to ${_clock(t.endAt)}';
      final d = t.startAt.toUtc().add(const Duration(hours: 1));
      // The expected turn is ten minutes after the window opens.
      final wait = open
          ? math.max(0, t.startAt.add(const Duration(minutes: 10)).difference(DateTime.now()).inMinutes)
          : null;
      return Scaffold(
        body: PageBackground(
          child: SafeArea(
            child: Column(
              children: [
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(20, 14, 20, 20),
                    children: [
                      const Rise(child: _Bar(title: 'Your place')),
                      const SizedBox(height: 16),
                      Rise(
                        index: 1,
                        child: _QueueHero(
                          initialsOf: clinic?.name ?? 'Outpatients',
                          title: clinic?.name ?? 'Outpatients',
                          sub:
                              '${session?.part ?? 'Session'} · ${_weekdays[d.weekday - 1]} ${d.day} ${_monthNames[d.month - 1].substring(0, 3)}',
                          chip: open ? 'Arrive inside your window' : 'This place was given up',
                          stats: [
                            ('${t.position ?? '–'}', 'Your place'),
                            ('${session?.issued ?? '–'}', 'Issued'),
                            (wait == null ? '–' : '~${wait}m', 'Est. wait'),
                            ('${session?.clinicians ?? '–'}', 'Clinicians'),
                          ],
                        ),
                      ),
                      const SizedBox(height: 20),
                      Row(
                        children: [
                          Expanded(
                            child: Text('Your ticket', style: AtriaType.display(size: 17, weight: FontWeight.w600)),
                          ),
                          if (open)
                            Text(
                              'Live',
                              style: AtriaType.body(size: 12.5, weight: FontWeight.w600, color: AtriaColors.blue600),
                            ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Rise(
                        index: 2,
                        child: Glass(
                          radius: 26,
                          from: .98,
                          to: .9,
                          padding: const EdgeInsets.all(20),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      'Queue position',
                                      style: AtriaType.body(
                                        size: 12.5,
                                        weight: FontWeight.w600,
                                        color: AtriaColors.inkSoft,
                                      ),
                                    ),
                                  ),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                                    decoration: BoxDecoration(
                                      borderRadius: BorderRadius.circular(999),
                                      border: Border.all(
                                        color: open ? AtriaColors.blue600 : AtriaColors.cancelled,
                                        width: 1.5,
                                      ),
                                    ),
                                    child: Text(
                                      open ? 'Booked' : 'Given up',
                                      style: AtriaType.body(
                                        size: 12,
                                        weight: FontWeight.w600,
                                        color: open ? AtriaColors.blue700 : AtriaColors.cancelledInk,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Text.rich(
                                TextSpan(
                                  children: [
                                    TextSpan(
                                      text: '${t.position ?? '–'}',
                                      style: AtriaType.display(size: 34, color: AtriaColors.blue700),
                                    ),
                                    TextSpan(
                                      text: session == null ? '' : '  of ${session!.issued} today',
                                      style: AtriaType.body(size: 14, color: AtriaColors.ink700),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                'Arrive $window',
                                style: AtriaType.body(size: 15, weight: FontWeight.w700, color: AtriaColors.inkPrimary),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                'We will message you if the window moves.',
                                style: AtriaType.body(size: 12.5, color: AtriaColors.inkSoft),
                              ),
                            ],
                          ),
                        ),
                      ),
                      if (failure != null) ...[const SizedBox(height: 14), Notice(failure!, tone: NoticeTone.error)],
                      if (open) ...[
                        const SizedBox(height: 16),
                        Rise(
                          index: 3,
                          child: PressableSurface(
                            color: Colors.white,
                            border: Border.all(color: AtriaColors.cancelled, width: 1.5),
                            radius: 18,
                            height: 52,
                            ink: AtriaColors.cancelled,
                            onTap: busy ? null : confirmGiveUp,
                            child: busy
                                ? const LoadingIndicator(
                                    size: 24,
                                    color: AtriaColors.cancelled,
                                    label: 'Giving up the place',
                                  )
                                : Text(
                                    'Give up my place',
                                    style: AtriaType.body(
                                      size: 13.5,
                                      weight: FontWeight.w600,
                                      color: AtriaColors.cancelledInk,
                                    ),
                                  ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                _Dock(
                  label: 'Arrive $window',
                  title: 'We text you if it moves',
                  action: 'Directions',
                  onTap: clinic == null
                      ? null
                      : () => launchUrl(clinic.directions, mode: LaunchMode.externalApplication),
                ),
              ],
            ),
          ),
        ),
      );
    },
  );
}

// -------------------------------------------------------------- shared

class _Bar extends StatelessWidget {
  const _Bar({required this.title});
  final String title;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      BackSquare(onPressed: () => context.canPop() ? context.pop() : context.go('/home')),
      Expanded(
        child: Text(
          title,
          textAlign: TextAlign.center,
          style: AtriaType.display(size: 16, weight: FontWeight.w600),
        ),
      ),
      const SizedBox(width: 42),
    ],
  );
}

class _QueueHero extends StatelessWidget {
  const _QueueHero({
    required this.initialsOf,
    required this.title,
    required this.sub,
    required this.chip,
    required this.stats,
  });
  final String initialsOf;
  final String title;
  final String sub;
  final String chip;
  final List<(String, String)> stats;

  @override
  Widget build(BuildContext context) {
    final words = initialsOf.split(' ').where((w) => w.isNotEmpty && w[0] == w[0].toUpperCase()).toList();
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(30),
        gradient: cssGradient(
          155,
          const [AtriaColors.blue500, AtriaColors.blue600, Color(0xFF1E52C4)],
          [.144, .486, .856],
        ),
        boxShadow: const [BoxShadow(offset: Offset(0, 14), blurRadius: 32, color: Color(0x521E52C4))],
      ),
      child: Column(
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
                ),
                child: Text(
                  words.take(2).map((w) => w[0]).join(),
                  style: AtriaType.display(size: 22, color: const Color(0xFF1E52C4)),
                ),
              ),
              const SizedBox(width: 15),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: AtriaType.display(size: 19, weight: FontWeight.w600, color: Colors.white),
                    ),
                    const SizedBox(height: 3),
                    Text(sub, style: AtriaType.body(size: 12.5, color: Colors.white)),
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 5),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(999),
                        color: Colors.white.withValues(alpha: .16),
                        border: Border.all(color: Colors.white.withValues(alpha: .6)),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const AtriaIcon('clock', size: 12, color: Colors.white),
                          const SizedBox(width: 6),
                          Flexible(
                            child: Text(
                              chip,
                              style: AtriaType.body(size: 11.5, weight: FontWeight.w600, color: Colors.white),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Container(
            decoration: glassOnAccent(20),
            child: Row(
              children: [
                for (final (value, label) in stats)
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      child: Column(
                        children: [
                          Pop(
                            value: value,
                            child: Text(
                              value,
                              style: AtriaType.display(size: 17, color: Colors.white).copyWith(height: 1.25),
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
    );
  }
}

/// The dock at the foot (308:2): what is chosen, and the one action.
class _Dock extends StatelessWidget {
  const _Dock({required this.label, required this.title, required this.action, required this.onTap, this.busy = false});
  final String label;
  final String title;
  final String action;
  final VoidCallback? onTap;
  final bool busy;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
    child: Glass(
      radius: 26,
      from: .96,
      to: .86,
      padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AtriaType.body(size: 11.5, color: AtriaColors.inkSoft),
                ),
                Text(
                  title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AtriaType.body(size: 14, weight: FontWeight.w700, color: AtriaColors.inkPrimary, height: 1.3),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          SizedBox(
            width: 136,
            child: PressableSurface(
              gradient: onTap == null && !busy ? AtriaGradients.disabled : accentGradient(160),
              shadow: onTap == null
                  ? null
                  : const BoxShadow(offset: Offset(0, 8), blurRadius: 18, color: Color(0x4D2F6BE4)),
              radius: 18,
              height: 52,
              ink: Colors.white,
              semanticLabel: action,
              onTap: busy ? null : onTap,
              child: busy
                  ? Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const LoadingIndicator(size: 20, color: Colors.white, label: 'Taking a place'),
                        const SizedBox(width: 8),
                        Flexible(
                          child: Text(
                            'Joining',
                            style: AtriaType.body(size: 13.5, weight: FontWeight.w600, color: Colors.white),
                          ),
                        ),
                      ],
                    )
                  : Text(
                      action,
                      style: AtriaType.body(size: 14, weight: FontWeight.w600, color: Colors.white),
                    ),
            ),
          ),
        ],
      ),
    ),
  );
}

/// "See a doctor today": the way into the day's queue, on Home and Find care
/// as on the web's Find care.
class QueueEntry extends StatelessWidget {
  const QueueEntry({super.key});

  @override
  Widget build(BuildContext context) => Glass(
    radius: 22,
    semanticLabel: 'See a doctor today, a place in the outpatient queue',
    onTap: () => context.push('/queue'),
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
    child: Row(
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(gradient: accentGradient(), borderRadius: BorderRadius.circular(14)),
          child: const Center(child: AtriaIcon('stethoscope', size: 19, color: Colors.white)),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'See a doctor today',
                style: AtriaType.body(size: 14, weight: FontWeight.w700, color: AtriaColors.inkPrimary),
              ),
              Text('A place in the outpatient queue', style: AtriaType.body(size: 12, color: AtriaColors.inkSoft)),
            ],
          ),
        ),
        const AtriaIcon('chevronRight', size: 16, color: AtriaColors.ink400),
      ],
    ),
  );
}
