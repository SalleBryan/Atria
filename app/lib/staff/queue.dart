import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../api/api.dart';
import '../patient/data.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/expressive.dart';
import '../ui/filters.dart';
import '../ui/glass.dart';
import '../ui/layout.dart';
import '../ui/loading.dart';
import '../ui/search.dart';
import '../ui/widgets.dart';
import 'data.dart';
import 'parts.dart';
import 'patients.dart';

/// A published outpatient session.
class QueueSessionInfo {
  QueueSessionInfo(this.raw);
  final Map<String, dynamic> raw;
  String get id => raw['sessionId'] as String;
  String get date => raw['sessionDate'] as String? ?? '';
  String get start => raw['startTime'] as String? ?? '';
  String get end => raw['endTime'] as String? ?? '';
  String get part =>
      const {'MORNING': 'Morning', 'AFTERNOON': 'Afternoon', 'EVENING': 'Evening'}[raw['partOfDay']] ?? '';
  String get status => raw['status'] as String? ?? 'OPEN';
  int get capacity => (raw['capacity'] as num?)?.toInt() ?? 0;
  int get issued => (raw['issuedTickets'] as num?)?.toInt() ?? 0;
  int get rostered => (raw['rosteredClinicianCount'] as num?)?.toInt() ?? 0;
}

/// The outpatient queue (web: Queue.tsx, FR-BKG-10, FR-BKG-13): today's
/// session in position order, arrivals recorded, a doctor calling the next
/// patient who has arrived, walk-ins added; and the fortnight's sessions,
/// which the unit manager publishes and closes.
class StaffQueueScreen extends StatefulWidget {
  const StaffQueueScreen({super.key, required this.store});
  final StaffStore store;

  @override
  State<StaffQueueScreen> createState() => _StaffQueueScreenState();
}

class _StaffQueueScreenState extends State<StaffQueueScreen> {
  int tab = 0;
  List<QueueSessionInfo>? sessions;
  String? sessionId;
  Map<String, dynamic>? live;
  String? failure;
  String? busy;
  String? doctorId;
  int page = 0;
  Timer? tick;

  Api get api => widget.store.api;
  bool get iAmDoctor => widget.store.role == StaffRole.clinician;
  bool get publishes => widget.store.role == StaffRole.manager;

  @override
  void initState() {
    super.initState();
    loadSessions();
    // The queue moves while the desk watches it.
    tick = Timer.periodic(const Duration(seconds: 30), (_) => loadLive());
  }

  @override
  void dispose() {
    tick?.cancel();
    super.dispose();
  }

  Future<void> loadSessions() async {
    try {
      final r = await api.get('/clinics/${Uri.encodeComponent(widget.store.clinicId ?? '')}/sessions');
      final found = (r['sessions'] as List? ?? const [])
          .cast<Map<String, dynamic>>()
          .map(QueueSessionInfo.new)
          .toList();
      final today = ClinicClock.isoDate(DateTime.now());
      if (!mounted) return;
      setState(() {
        sessions = found;
        sessionId ??= found.where((s) => s.date == today).firstOrNull?.id;
      });
      loadLive();
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = e.message);
    }
  }

  Future<void> loadLive() async {
    final id = sessionId;
    if (id == null) return;
    try {
      final r = await api.get('/sessions/${Uri.encodeComponent(id)}/queue');
      if (mounted && id == sessionId) setState(() => live = r);
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = sentence(e.message));
    }
  }

  Future<void> step(String path, String done, [Object? body]) async {
    setState(() {
      busy = path;
      failure = null;
    });
    try {
      await api.send('POST', path, body);
      await loadLive();
      if (mounted) say(context, done);
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = '${sentence(e.message)} Nothing was changed.');
    } finally {
      if (mounted) setState(() => busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final dir = widget.store.directory;
    final unit = dir?.clinic(widget.store.clinicId);
    return RefreshIndicator(
      onRefresh: loadSessions,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 130),
        children: [
          Rise(
            child: StaffHeader(
              title: 'Queue',
              sub: '${unit?.name ?? 'Your unit'} · in the order places were taken',
              trailing: tab == 1 && publishes ? SmallAdd(label: 'Publish', onTap: publish) : null,
            ),
          ),
          const SizedBox(height: 16),
          Rise(
            index: 1,
            child: Segmented(
              labels: const ["Today's queue", 'Sessions'],
              selected: tab,
              onChanged: (i) => setState(() => tab = i),
            ),
          ),
          const SizedBox(height: 14),
          if (failure != null) ...[Notice(failure!, tone: NoticeTone.error), const SizedBox(height: 12)],
          if (sessions == null)
            const Padding(
              padding: EdgeInsets.all(40),
              child: Center(child: LoadingIndicator(label: 'Loading')),
            )
          else if (tab == 0)
            ..._live(context)
          else
            ..._sessions(context),
        ],
      ),
    );
  }

  List<Widget> _live(BuildContext context) {
    final today = ClinicClock.isoDate(DateTime.now());
    final todays = sessions!.where((s) => s.date == today).toList();
    if (todays.isEmpty) {
      return [
        Glass(
          radius: 22,
          padding: const EdgeInsets.all(18),
          child: Text(
            publishes ? 'No session today. Publish one from Sessions.' : 'No session is published for today.',
            textAlign: TextAlign.center,
            style: AtriaType.body(color: AtriaColors.inkMuted),
          ),
        ),
      ];
    }
    final q = live;
    final tickets = [
      for (final a in (q?['appointments'] as List? ?? const []).cast<Map<String, dynamic>>()) Appointment(a),
    ]..sort((a, b) => (a.position ?? 0).compareTo(b.position ?? 0));
    final names = <String, PatientName>{};
    (q?['patients'] as Map? ?? const {}).forEach(
      (k, v) => names['$k'] = PatientName((v as Map)['givenName'] as String?, v['familyName'] as String?),
    );
    final doctors =
        widget.store.directory?.clinicians.where((c) => c.clinicId == widget.store.me.clinicId).toList() ?? [];
    final pages = Pages(tickets, phonePage, page);
    final arrived = (q?['arrived'] as num?)?.toInt() ?? 0;
    Widget stat(String k, Object? v) => Expanded(
      child: Column(
        children: [
          Text('${v ?? '-'}', style: AtriaType.display(size: 20)),
          Text(k, style: AtriaType.body(size: 11, color: AtriaColors.inkMuted)),
        ],
      ),
    );
    return [
      if (todays.length > 1) ...[
        Wrap(
          spacing: 8,
          children: [
            for (final s in todays)
              FilterChipButton(
                label: '${s.part} ${s.start}',
                on: s.id == sessionId,
                onTap: () {
                  setState(() {
                    sessionId = s.id;
                    live = null;
                  });
                  loadLive();
                },
              ),
          ],
        ),
        const SizedBox(height: 12),
      ],
      Glass(
        radius: 24,
        padding: const EdgeInsets.all(14),
        child: q == null
            ? const Center(child: LoadingIndicator(size: 30))
            : Column(
                children: [
                  Text(
                    '${q['startTime']} to ${q['endTime']} · ${q['status'] == 'RUNNING'
                        ? 'Running'
                        : q['status'] == 'CLOSED'
                        ? 'Closed'
                        : 'Open'}',
                    style: AtriaType.body(size: 13, weight: FontWeight.w700, color: AtriaColors.ink800),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      stat('Waiting', q['waiting']),
                      stat('Arrived', q['arrived']),
                      stat('With a doctor', q['inConsultation']),
                      stat('Seen', q['seen']),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Pace ${q['actualPerHour'] ?? '–'} of ${q['plannedPerHour']} an hour',
                    style: AtriaType.body(size: 12, color: AtriaColors.inkSoft),
                  ),
                ],
              ),
      ),
      const SizedBox(height: 12),
      SecondaryButton(label: 'Add a walk-in', onPressed: sessionId == null ? null : walkIn),
      const SizedBox(height: 10),
      if (!iAmDoctor && doctors.isNotEmpty) ...[
        Text(
          'Doctor to call for',
          style: AtriaType.body(size: 12, weight: FontWeight.w600, color: AtriaColors.inkSoft),
        ),
        const SizedBox(height: 6),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final d in doctors)
              FilterChipButton(label: d.name, on: d.id == doctorId, onTap: () => setState(() => doctorId = d.id)),
          ],
        ),
        const SizedBox(height: 10),
      ],
      PrimaryButton(
        label: iAmDoctor ? 'Call my next patient' : 'Call next patient',
        busy: busy?.endsWith('/next') ?? false,
        onPressed: arrived == 0 || busy != null || (!iAmDoctor && doctorId == null)
            ? null
            : () => step(
                '/sessions/$sessionId/next',
                'The next patient is called in.',
                iAmDoctor ? null : {'clinicianProfileId': doctorId},
              ),
      ),
      const SizedBox(height: 16),
      if (q != null && tickets.isEmpty)
        Text(
          'Nobody has a place in this session yet.',
          textAlign: TextAlign.center,
          style: AtriaType.body(color: AtriaColors.inkMuted),
        )
      else
        for (final t in pages.shown) ...[
          Glass(
            radius: 20,
            onTap: () => context.go('/console/visits/${t.id}'),
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                SizedBox(
                  width: 34,
                  child: Text(
                    '${t.position ?? ''}',
                    textAlign: TextAlign.center,
                    style: AtriaType.display(size: 20, color: AtriaColors.blue600),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        (names[t.patientId]?.full ?? '').isEmpty ? 'Patient' : names[t.patientId]!.full,
                        style: AtriaType.body(size: 14, weight: FontWeight.w700, color: AtriaColors.ink900),
                      ),
                      Text(
                        [
                          t.channel == 'WALK_IN'
                              ? 'Walk-in'
                              : t.channel == 'PHONE'
                              ? 'By phone'
                              : 'Online',
                          '${ClinicClock.time(t.arrivalWindowStart ?? t.startAt)} to ${ClinicClock.time(t.arrivalWindowEnd ?? t.endAt)}',
                          widget.store.directory?.clinician(t.clinicianId)?.name ?? 'No doctor yet',
                        ].join(' · '),
                        style: AtriaType.body(size: 11.5, color: AtriaColors.inkSoft, height: 1.3),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 6),
                if (t.state == 'BOOKED' || t.state == 'CONFIRMED')
                  TextButton(
                    onPressed: busy != null ? null : () => step('/appointments/${t.id}/arrive', 'Arrival recorded.'),
                    child: const Text('Arrived'),
                  )
                else if (t.state == 'IN_CONSULTATION' && (iAmDoctor || publishes))
                  TextButton(
                    onPressed: busy != null
                        ? null
                        : () => step('/appointments/${t.id}/complete', 'Consultation closed.'),
                    child: const Text('Done'),
                  )
                else
                  StateChip.of(t.state),
              ],
            ),
          ),
          const SizedBox(height: 8),
        ],
      if (tickets.length > phonePage)
        Pager.of(pages, noun: 'places', onPrevious: () => setState(() => page--), onNext: () => setState(() => page++)),
    ];
  }

  List<Widget> _sessions(BuildContext context) {
    final list = sessions!;
    if (list.isEmpty) {
      return [
        Text(
          'No session published.',
          textAlign: TextAlign.center,
          style: AtriaType.body(color: AtriaColors.inkMuted),
        ),
      ];
    }
    return [
      for (final s in list) ...[
        Glass(
          radius: 20,
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${ClinicClock.day(ClinicClock.onDate(s.date))} · ${s.part}',
                      style: AtriaType.body(size: 14, weight: FontWeight.w700, color: AtriaColors.ink900),
                    ),
                    Text(
                      '${s.start} to ${s.end} · ${s.issued} of ${s.capacity} places · ${s.rostered} doctors',
                      style: AtriaType.body(size: 12, color: AtriaColors.inkSoft),
                    ),
                  ],
                ),
              ),
              if (publishes && s.status != 'CLOSED' && s.date.compareTo(ClinicClock.isoDate(DateTime.now())) <= 0)
                TextButton(
                  onPressed: busy != null
                      ? null
                      : () async {
                          await step(
                            '/sessions/${s.id}/close',
                            "Session closed. Its pace now informs the next sessions' capacity.",
                          );
                          loadSessions();
                        },
                  child: const Text('Close'),
                )
              else
                StateChip(
                  s.status == 'RUNNING'
                      ? 'Running'
                      : s.status == 'CLOSED'
                      ? 'Closed'
                      : 'Open',
                  s.status == 'RUNNING'
                      ? StaffTone.confirmed
                      : s.status == 'CLOSED'
                      ? StaffTone.neutral
                      : StaffTone.booked,
                ),
            ],
          ),
        ),
        const SizedBox(height: 8),
      ],
    ];
  }

  Future<void> walkIn() async {
    final said = await showModalBottomSheet<String>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: AtriaColors.surfacePanel,
      builder: (_) => _WalkIn(api: api, sessionId: sessionId!),
    );
    if (said != null && mounted) {
      say(context, said);
      loadLive();
    }
  }

  Future<void> publish() async {
    final said = await showModalBottomSheet<String>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: AtriaColors.surfacePanel,
      builder: (_) => _Publish(api: api, clinicId: widget.store.clinicId ?? ''),
    );
    if (said != null && mounted) {
      say(context, said);
      loadSessions();
    }
  }
}

class _WalkIn extends StatefulWidget {
  const _WalkIn({required this.api, required this.sessionId});
  final Api api;
  final String sessionId;

  @override
  State<_WalkIn> createState() => _WalkInState();
}

class _WalkInState extends State<_WalkIn> {
  final query = TextEditingController();
  List<RegisterEntry> found = const [];
  RegisterEntry? patient;
  String channel = 'WALK_IN';
  bool busy = false;
  String? failure;
  Timer? wait;

  @override
  void dispose() {
    wait?.cancel();
    query.dispose();
    super.dispose();
  }

  Future<void> add() async {
    final p = patient;
    if (p == null) return;
    setState(() {
      busy = true;
      failure = null;
    });
    try {
      final made = await widget.api.send('POST', '/sessions/${widget.sessionId}/tickets', {
        'patientProfileId': p.id,
        'channel': channel,
      });
      if (mounted) Navigator.pop(context, '${p.name} has place ${made['position']}.');
    } on ApiError catch (e) {
      if (mounted) {
        setState(() {
          failure = '${sentence(e.message)} No place was taken.';
          busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
    child: SafeArea(
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.fromLTRB(22, 0, 22, 20),
        children: [
          Text('Add a place', style: AtriaType.display(size: 21)),
          const SizedBox(height: 6),
          Text(
            'A patient at the desk or on the phone joins the end of the queue.',
            style: AtriaType.body(size: 13, color: AtriaColors.inkMuted),
          ),
          const SizedBox(height: 14),
          Segmented(
            labels: const ['At the desk', 'By phone'],
            selected: channel == 'PHONE' ? 1 : 0,
            onChanged: (i) => setState(() => channel = i == 1 ? 'PHONE' : 'WALK_IN'),
          ),
          const SizedBox(height: 12),
          if (patient == null) ...[
            SearchSuggest(
              controller: query,
              groups: const [],
              placeholder: 'Find the patient',
              onChanged: (v) {
                wait?.cancel();
                wait = Timer(const Duration(milliseconds: 300), () async {
                  if (v.trim().isEmpty) return setState(() => found = const []);
                  final r = await widget.api.get('/patients?q=${Uri.encodeQueryComponent(v.trim())}');
                  if (mounted) {
                    setState(
                      () => found = (r['results'] as List? ?? const [])
                          .cast<Map<String, dynamic>>()
                          .map(RegisterEntry.new)
                          .toList(),
                    );
                  }
                });
              },
            ),
            for (final p in found.take(6))
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(p.name),
                subtitle: Text([p.number, p.phone].whereType<String>().join(' · ')),
                onTap: () => setState(() => patient = p),
              ),
          ] else
            Glass(
              radius: 20,
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      patient!.name,
                      style: AtriaType.body(size: 14.5, weight: FontWeight.w700, color: AtriaColors.ink900),
                    ),
                  ),
                  TextButton(onPressed: () => setState(() => patient = null), child: const Text('Change')),
                ],
              ),
            ),
          if (failure != null) ...[const SizedBox(height: 12), Notice(failure!, tone: NoticeTone.error)],
          const SizedBox(height: 16),
          PrimaryButton(label: 'Give them a place', busy: busy, onPressed: patient == null ? null : add),
        ],
      ),
    ),
  );
}

class _Publish extends StatefulWidget {
  const _Publish({required this.api, required this.clinicId});
  final Api api;
  final String clinicId;

  @override
  State<_Publish> createState() => _PublishState();
}

class _PublishState extends State<_Publish> {
  late String date = ClinicClock.isoDate(DateTime.now().add(const Duration(days: 1)));
  String start = '08:00';
  String end = '12:00';
  int rostered = 2;
  bool busy = false;
  String? failure;

  static final times = [
    for (var h = 6; h <= 20; h++)
      for (final m in ['00', '30']) '${h.toString().padLeft(2, '0')}:$m',
  ];

  Future<void> save() async {
    setState(() {
      busy = true;
      failure = null;
    });
    try {
      await widget.api.send('POST', '/clinics/${Uri.encodeComponent(widget.clinicId)}/sessions', {
        'date': date,
        'startTime': start,
        'endTime': end,
        'rosteredClinicianCount': rostered,
      });
      if (mounted) Navigator.pop(context, 'Session published for ${ClinicClock.day(ClinicClock.onDate(date))}.');
    } on ApiError catch (e) {
      if (mounted) {
        setState(() {
          failure = '${sentence(e.message)} Nothing was published.';
          busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    Widget pick(String label, String value, ValueChanged<String> set) => Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: AtriaType.body(size: 12, weight: FontWeight.w600, color: AtriaColors.inkSoft),
          ),
          const SizedBox(height: 6),
          SizedBox(
            height: 44,
            child: ListView(
              scrollDirection: Axis.horizontal,
              controller: ScrollController(initialScrollOffset: (times.indexOf(value) * 70.0 - 40).clamp(0, 9999)),
              children: [
                for (final t in times)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: FilterChipButton(label: t, on: t == value, onTap: () => setState(() => set(t))),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
    return SafeArea(
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.fromLTRB(22, 0, 22, 20),
        children: [
          Text('Publish a session', style: AtriaType.display(size: 21)),
          const SizedBox(height: 6),
          Text(
            'A date, a window and the doctors rostered. The number of places is worked out from their pace.',
            style: AtriaType.body(size: 13, color: AtriaColors.inkMuted),
          ),
          const SizedBox(height: 14),
          DateBar(
            label: ClinicClock.long(ClinicClock.onDate(date)),
            onPrevious: () => setState(() => date = ClinicClock.shiftDate(date, -1)),
            onNext: () => setState(() => date = ClinicClock.shiftDate(date, 1)),
          ),
          const SizedBox(height: 14),
          Row(children: [pick('Opens', start, (v) => start = v)]),
          const SizedBox(height: 10),
          Row(children: [pick('Closes', end, (v) => end = v)]),
          const SizedBox(height: 14),
          Text(
            'Doctors rostered',
            style: AtriaType.body(size: 12, weight: FontWeight.w600, color: AtriaColors.inkSoft),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            children: [
              for (var n = 1; n <= 6; n++)
                FilterChipButton(label: '$n', on: n == rostered, onTap: () => setState(() => rostered = n)),
            ],
          ),
          if (failure != null) ...[const SizedBox(height: 12), Notice(failure!, tone: NoticeTone.error)],
          const SizedBox(height: 18),
          PrimaryButton(label: 'Publish', busy: busy, onPressed: start.compareTo(end) < 0 ? save : null),
        ],
      ),
    );
  }
}
