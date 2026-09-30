import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../api/api.dart';
import '../patient/data.dart';
import '../patient/intake.dart';
import '../screens/visits.dart' show OutlineDanger;
import '../ui/filters.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/expressive.dart';
import '../ui/glass.dart';
import '../ui/icons.dart';
import '../ui/loading.dart';
import '../ui/widgets.dart';
import 'data.dart';
import 'parts.dart';

/// One visit at the desk (web: VisitPage.tsx, FR-VIS-02, FR-STF-05): what,
/// when, who, the next step (arrival, consultation, completion), the
/// no-show question once the time has passed, moving and cancelling, and,
/// for the clinician, what the patient answered beforehand.
class StaffVisitScreen extends StatefulWidget {
  const StaffVisitScreen({super.key, required this.store, required this.id});
  final StaffStore store;
  final String id;

  @override
  State<StaffVisitScreen> createState() => _StaffVisitScreenState();
}

class _StaffVisitScreenState extends State<StaffVisitScreen> {
  Appointment? a;
  PatientName name = const PatientName(null, null);
  String? failure;
  String? acting;
  String? said;

  Api get api => widget.store.api;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final found = Appointment(await api.get('/appointments/${Uri.encodeComponent(widget.id)}'));
      final day = await widget.store
          .schedule(ClinicClock.isoDate(found.startAt))
          .catchError((Object _) => const Schedule([], {}));
      if (!mounted) return;
      setState(() {
        a = found;
        name = day.patients[found.patientId] ?? const PatientName(null, null);
      });
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = e.message);
    }
  }

  Future<void> act(String action, String done) async {
    setState(() {
      acting = action;
      said = null;
      failure = null;
    });
    try {
      await api.send('POST', '/appointments/${widget.id}/$action');
      widget.store.changed();
      await load();
      if (mounted) say(context, done);
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = '${sentence(e.message)} Nothing was changed.');
    } finally {
      if (mounted) setState(() => acting = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final v = a;
    if (v == null) {
      return Scaffold(
        body: PageBackground(
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  const StaffHeader(title: 'Visit', back: '/console'),
                  const SizedBox(height: 30),
                  if (failure != null)
                    Notice(failure!, tone: NoticeTone.error)
                  else
                    const LoadingIndicator(label: 'Loading the visit'),
                ],
              ),
            ),
          ),
        ),
      );
    }
    final store = widget.store;
    final dir = store.directory;
    final clinician = dir?.clinician(v.clinicianId);
    final type = dir?.type(v.typeId);
    final unit = dir?.clinic(v.clinicId);
    final (label, tone) = staffState(v.state);
    final now = DateTime.now();
    final scheduled = scheduledStates.contains(v.state);
    final consults = store.me.roles.any((r) => r == 'CLINICIAN' || r == 'CLINIC_MANAGER');
    final canArrive = scheduled && ClinicClock.isoDate(v.startAt) == ClinicClock.isoDate(now);
    final due = noShowDue(v, now);
    final canMove = scheduled && v.startAt.isAfter(now) && v.sessionId == null;
    final canCancel = activeStates.contains(v.state) && v.startAt.isAfter(now);
    final who = name.full.isEmpty ? 'the patient' : name.full;
    final step = canArrive && !due
        ? ('arrive', 'Record arrival', '${name.full.isEmpty ? 'The patient' : name.full} is here. Arrival recorded.')
        : v.state == 'ARRIVED' && consults
        ? ('start', 'Start consultation', 'Consultation started.')
        : v.state == 'IN_CONSULTATION' && consults
        ? ('complete', 'Complete visit', 'Visit completed.')
        : null;
    final reminder = reminderAt(v);
    final minutes = v.endAt.difference(v.startAt).inMinutes;
    final readsAnswers = store.me.roles.contains('CLINICIAN') && v.clinicianId == store.me.staffId;

    Widget fact(String k, String val) => Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(
              k,
              style: AtriaType.body(size: 12.5, weight: FontWeight.w600, color: AtriaColors.inkSoft),
            ),
          ),
          Expanded(
            child: Text(val, style: AtriaType.body(size: 13.5, color: AtriaColors.ink900)),
          ),
        ],
      ),
    );

    return Scaffold(
      body: PageBackground(
        child: SafeArea(
          child: RefreshIndicator(
            onRefresh: load,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 40),
              children: [
                Rise(
                  child: StaffHeader(
                    title: name.full.isEmpty ? 'Visit' : name.full,
                    sub: v.reference,
                    back: '/console',
                  ),
                ),
                const SizedBox(height: 18),
                Rise(
                  index: 1,
                  child: Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      gradient: cssGradient(150, const [Color(0xFF4A83F0), Color(0xFF1F55C9)]),
                      borderRadius: BorderRadius.circular(28),
                      boxShadow: const [BoxShadow(offset: Offset(0, 14), blurRadius: 30, color: Color(0x472461DB))],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: .2),
                            borderRadius: BorderRadius.circular(99),
                          ),
                          child: Text(
                            label.toUpperCase(),
                            style: AtriaType.body(size: 11, weight: FontWeight.w700, color: Colors.white),
                          ),
                        ),
                        const SizedBox(height: 10),
                        Text(ClinicClock.long(v.startAt), style: AtriaType.display(size: 21, color: Colors.white)),
                        const SizedBox(height: 4),
                        Text(
                          [type?.name, if (minutes > 0) '$minutes minutes'].whereType<String>().join(' · '),
                          style: AtriaType.body(size: 13, color: Colors.white.withValues(alpha: .9)),
                        ),
                        const SizedBox(height: 14),
                        Row(
                          children: [
                            for (final (k, val) in [
                              ('START', ClinicClock.time(v.startAt)),
                              ('END', ClinicClock.time(v.endAt)),
                              ('REF', v.reference),
                            ])
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      k,
                                      style: AtriaType.body(
                                        size: 10.5,
                                        weight: FontWeight.w700,
                                        color: Colors.white.withValues(alpha: .75),
                                      ),
                                    ),
                                    Text(val, style: AtriaType.display(size: 15, color: Colors.white)),
                                  ],
                                ),
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
                if (failure != null) ...[const SizedBox(height: 14), Notice(failure!, tone: NoticeTone.error)],
                if (said != null) ...[const SizedBox(height: 14), Notice(said!, tone: NoticeTone.success)],
                if (step != null) ...[
                  const SizedBox(height: 16),
                  PrimaryButton(
                    label: step.$2,
                    busy: acting == step.$1,
                    onPressed: acting == null ? () => act(step.$1, step.$3) : null,
                  ),
                ],
                if (due) ...[
                  const SizedBox(height: 16),
                  Glass(
                    radius: 24,
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          'Still not checked in, ${ClinicClock.time(v.endAt)} has passed. Did $who come?',
                          style: AtriaType.body(size: 13.5, color: AtriaColors.ink900),
                        ),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            Expanded(
                              child: SecondaryButton(
                                label: 'They came',
                                onPressed: acting == null
                                    ? () => act(
                                        'arrive',
                                        'Arrival recorded for ${name.full.isEmpty ? 'the patient' : name.full}.',
                                      )
                                    : null,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: OutlineDanger(
                                label: 'Mark no-show',
                                height: 56,
                                onTap: acting == null
                                    ? () => act('no-show', '${v.reference} recorded as a no-show.')
                                    : null,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                Rise(
                  index: 2,
                  child: Glass(
                    radius: 26,
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Appointment', style: AtriaType.display(size: 16, weight: FontWeight.w600)),
                        const SizedBox(height: 12),
                        fact('Status', label),
                        fact('Type', type?.name ?? '-'),
                        fact('Unit', unit?.name ?? '-'),
                        fact('Booked', bookedBy[v.bookedByRole ?? 'PATIENT'] ?? 'Booked'),
                        if (v.channel != null) fact('Channel', channelLabel[v.channel] ?? v.channel!),
                        fact(
                          'Reminder',
                          reminder == null
                              ? 'None: booked inside 24 hours, confirmed by text'
                              : '${reminder.isAfter(now) ? 'Goes' : 'Went'} ${ClinicClock.day(reminder)}, ${ClinicClock.time(reminder)}',
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Rise(
                  index: 3,
                  child: Glass(
                    radius: 26,
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('People', style: AtriaType.display(size: 16, weight: FontWeight.w600)),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            Initials(name.initials),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    name.full.isEmpty ? 'Patient' : name.full,
                                    style: AtriaType.body(
                                      size: 14.5,
                                      weight: FontWeight.w700,
                                      color: AtriaColors.ink900,
                                    ),
                                  ),
                                  Text('Patient', style: AtriaType.body(size: 12, color: AtriaColors.inkSoft)),
                                ],
                              ),
                            ),
                            if (v.patientId != null && !store.ownCalendar)
                              TextButton(
                                onPressed: () => context.go('/console/patients/${v.patientId}'),
                                child: Text(
                                  'Record',
                                  style: AtriaType.body(size: 13, weight: FontWeight.w700, color: AtriaColors.blue600),
                                ),
                              ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            Initials(initials(clinician?.givenName, clinician?.familyName)),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    clinician?.name ?? (v.sessionId != null ? 'The doctor on duty' : 'Not named'),
                                    style: AtriaType.body(
                                      size: 14.5,
                                      weight: FontWeight.w700,
                                      color: AtriaColors.ink900,
                                    ),
                                  ),
                                  Text(
                                    clinician?.specialty ?? 'Clinician',
                                    style: AtriaType.body(size: 12, color: AtriaColors.inkSoft),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
                if (readsAnswers && type?.intakeForm != null) ...[
                  const SizedBox(height: 16),
                  Rise(
                    index: 4,
                    child: _Answers(api: api, id: v.id),
                  ),
                ],
                if (canMove || canCancel) ...[
                  const SizedBox(height: 18),
                  Row(
                    children: [
                      if (canMove)
                        Expanded(
                          child: SecondaryButton(
                            label: 'Move visit',
                            onPressed: () async {
                              final moved = await moveVisit(context, api, v);
                              if (moved) {
                                widget.store.changed();
                                await load();
                                if (context.mounted) say(context, '${v.reference} moved. $who has been told.');
                              }
                            },
                          ),
                        ),
                      if (canMove && canCancel) const SizedBox(width: 10),
                      if (canCancel)
                        Expanded(
                          child: OutlineDanger(
                            label: 'Cancel visit',
                            height: 56,
                            onTap: () async {
                              final done = await cancelAtDesk(context, api, v, who, type);
                              if (done != null) {
                                widget.store.changed();
                                await load();
                                if (context.mounted) say(context, done);
                              }
                            },
                          ),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// What the patient answered, for the assigned clinician only (FR-PRV-10).
class _Answers extends StatefulWidget {
  const _Answers({required this.api, required this.id});
  final Api api;
  final String id;

  @override
  State<_Answers> createState() => _AnswersState();
}

class _AnswersState extends State<_Answers> {
  Map<String, dynamic>? care;
  bool failed = false;

  @override
  void initState() {
    super.initState();
    widget.api
        .get('/appointments/${Uri.encodeComponent(widget.id)}/care-context')
        .then(
          (found) {
            if (mounted) setState(() => care = found);
          },
          onError: (Object _) {
            if (mounted) setState(() => failed = true);
          },
        );
  }

  @override
  Widget build(BuildContext context) {
    final form = IntakeForm.of(care?['form']);
    final answers = (care?['answers'] as Map?)?.cast<String, Object?>();
    return Glass(
      radius: 26,
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const AtriaIcon('lock', size: 16, color: AtriaColors.blue600),
              const SizedBox(width: 8),
              Text('Before the visit', style: AtriaType.display(size: 16, weight: FontWeight.w600)),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Only you and the patient read this. The front desk and administrators cannot.',
            style: AtriaType.body(size: 12, color: AtriaColors.inkSoft),
          ),
          const SizedBox(height: 10),
          if (failed)
            Text('The answers could not be read. Try again later.', style: AtriaType.body(color: AtriaColors.inkMuted))
          else if (care == null)
            const Center(child: LoadingIndicator(size: 30))
          else if (form == null || answers == null)
            Text('The patient has not answered the questions.', style: AtriaType.body(color: AtriaColors.inkMuted))
          else
            for (final f in form.fields)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      f.label,
                      style: AtriaType.body(size: 12, weight: FontWeight.w600, color: AtriaColors.inkSoft),
                    ),
                    Text(switch (answers[f.id]) {
                      null || '' => 'Not answered',
                      true => 'Yes',
                      false => 'No',
                      final v =>
                        f.kind == 'choice' ? f.options.where((o) => o.$1 == '$v').firstOrNull?.$2 ?? '$v' : '$v',
                    }, style: AtriaType.body(size: 14, color: AtriaColors.ink900)),
                  ],
                ),
              ),
        ],
      ),
    );
  }
}

const _reasons = [
  ('Clinician unavailable', 'CLINIC'),
  ('Patient called to cancel', 'PATIENT'),
  ('Double booking', 'CLINIC'),
  ('Unit closure', 'CLINIC'),
  ('No longer needed', 'PATIENT'),
  ('Other', null),
];

/// Cancel at the desk (web: CancelVisit.tsx): a reason from the list, who it
/// came from for "Other", and the note. Returns what to say, or null.
Future<String?> cancelAtDesk(BuildContext context, Api api, Appointment a, String who, AppointmentType? type) =>
    showModalBottomSheet<String>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: AtriaColors.surfacePanel,
      builder: (_) => _CancelSheet(api: api, a: a, who: who, type: type),
    );

class _CancelSheet extends StatefulWidget {
  const _CancelSheet({required this.api, required this.a, required this.who, required this.type});
  final Api api;
  final Appointment a;
  final String who;
  final AppointmentType? type;

  @override
  State<_CancelSheet> createState() => _CancelSheetState();
}

class _CancelSheetState extends State<_CancelSheet> {
  (String, String?)? reason;
  String? other;
  final note = TextEditingController();
  bool busy = false;
  String? failure;

  @override
  void dispose() {
    note.dispose();
    super.dispose();
  }

  Future<void> cancel() async {
    final r = reason;
    final by = r?.$2 ?? other;
    if (r == null || by == null || (r.$2 == null && note.text.trim().isEmpty)) return;
    setState(() {
      busy = true;
      failure = null;
    });
    try {
      await widget.api.send('DELETE', '/appointments/${widget.a.id}', {
        'cancelledBy': by,
        'reason': r.$2 == null ? '${r.$1}: ${note.text.trim()}' : r.$1,
      });
      if (mounted) {
        Navigator.pop(
          context,
          '${widget.a.reference} cancelled. The time is free again and ${widget.who} has been emailed.',
        );
      }
    } on ApiError catch (e) {
      if (mounted) {
        setState(() {
          failure = '${sentence(e.message)} Nothing was changed; try again.';
          busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final windowHours = (widget.type?.cancellationWindowMinutes ?? 1440) / 60;
    final late = widget.a.startAt.difference(DateTime.now()).inMinutes / 60 < windowHours;
    final r = reason;
    final ready = r != null && (r.$2 ?? other) != null && (r.$2 != null || note.text.trim().isNotEmpty);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(22, 0, 22, 20),
          children: [
            Text('Cancel this appointment?', style: AtriaType.display(size: 21)),
            const SizedBox(height: 6),
            Text(
              "The time returns to the unit's calendar straight away and the patient's reminder is removed. This is recorded against your account.",
              style: AtriaType.body(size: 13, color: AtriaColors.inkMuted),
            ),
            if (late) ...[
              const SizedBox(height: 12),
              Notice(
                'Inside the ${windowHours.round()}-hour cancellation window. A cancellation by the institution keeps the patient\'s full entitlement.',
              ),
            ],
            const SizedBox(height: 16),
            Text(
              'REASON · RECORDED IN THE AUDIT LOG',
              style: AtriaType.body(size: 11, weight: FontWeight.w700, color: AtriaColors.inkSoft),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final option in _reasons)
                  FilterChipButton(
                    label: option.$1,
                    on: reason == option,
                    onTap: () => setState(() => reason = option),
                  ),
              ],
            ),
            if (r != null && r.$2 == null) ...[
              const SizedBox(height: 14),
              Text(
                'Who asked for it?',
                style: AtriaType.body(size: 13, weight: FontWeight.w700, color: AtriaColors.ink900),
              ),
              const SizedBox(height: 8),
              Segmented(
                labels: const ['The patient', 'The institution'],
                selected: other == 'CLINIC' ? 1 : 0,
                onChanged: (i) => setState(() => other = i == 1 ? 'CLINIC' : 'PATIENT'),
              ),
              const SizedBox(height: 12),
              AtriaField(label: 'What happened', icon: 'pencil', controller: note, hint: 'In a few words'),
            ],
            if (failure != null) ...[const SizedBox(height: 12), Notice(failure!, tone: NoticeTone.error)],
            const SizedBox(height: 18),
            PrimaryButton(label: 'Cancel the visit', danger: true, busy: busy, onPressed: ready ? cancel : null),
            const SizedBox(height: 10),
            SecondaryButton(label: 'Keep it', onPressed: busy ? null : () => Navigator.pop(context)),
          ],
        ),
      ),
    );
  }
}

/// Move a visit to another free time of its clinician's (FR-VIS-07): the
/// next free times this week and the next, one tap to move. True when moved.
Future<bool> moveVisit(BuildContext context, Api api, Appointment a) async =>
    await showModalBottomSheet<bool>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: AtriaColors.surfacePanel,
      builder: (_) => _MoveSheet(api: api, a: a),
    ) ??
    false;

class _MoveSheet extends StatefulWidget {
  const _MoveSheet({required this.api, required this.a});
  final Api api;
  final Appointment a;

  @override
  State<_MoveSheet> createState() => _MoveSheetState();
}

class _MoveSheetState extends State<_MoveSheet> {
  Map<String, List<DateTime>>? days;
  DateTime? picked;
  bool busy = false;
  String? failure;

  @override
  void initState() {
    super.initState();
    final from = ClinicClock.isoDate(DateTime.now());
    final to = ClinicClock.isoDate(DateTime.now().add(const Duration(days: 13)));
    widget.api
        .get(
          '/clinicians/${Uri.encodeComponent(widget.a.clinicianId ?? '')}/slots?from=$from&to=$to&typeId=${Uri.encodeComponent(widget.a.typeId)}',
        )
        .then(
          (found) {
            final raw = (found['days'] as Map? ?? const {});
            final out = <String, List<DateTime>>{};
            for (final k in raw.keys.map((k) => '$k').toList()..sort()) {
              final times = [
                for (final s in (raw[k] as List? ?? const [])) DateTime.parse((s as Map)['startAt'] as String),
              ].where((t) => t != widget.a.startAt && t.isAfter(DateTime.now())).toList();
              if (times.isNotEmpty) out[k] = times;
            }
            if (mounted) setState(() => days = out);
          },
          onError: (Object e) {
            if (mounted) setState(() => failure = e is ApiError ? e.message : 'Free times could not be loaded.');
          },
        );
  }

  Future<void> move() async {
    final slot = picked;
    if (slot == null) return;
    setState(() {
      busy = true;
      failure = null;
    });
    try {
      await widget.api.send('POST', '/appointments/${widget.a.id}/reschedule', {
        'startAt': slot.toUtc().toIso8601String().replaceFirst('.000', ''),
      });
      if (mounted) Navigator.pop(context, true);
    } on ApiError catch (e) {
      if (mounted) {
        setState(() {
          failure = e.status == 409 ? 'That time has just been taken. Choose another.' : sentence(e.message);
          busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    child: ConstrainedBox(
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * .8),
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.fromLTRB(22, 0, 22, 20),
        children: [
          Text('Move visit', style: AtriaType.display(size: 21)),
          const SizedBox(height: 6),
          Text(
            'Now ${ClinicClock.day(widget.a.startAt)}, ${ClinicClock.time(widget.a.startAt)}. Choose another free time with the same clinician; the patient is told at once.',
            style: AtriaType.body(size: 13, color: AtriaColors.inkMuted),
          ),
          const SizedBox(height: 14),
          if (failure != null) ...[Notice(failure!, tone: NoticeTone.error), const SizedBox(height: 12)],
          if (days == null && failure == null)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: LoadingIndicator(label: 'Finding free times')),
            )
          else if (days != null && days!.isEmpty)
            Text('No free time in the next two weeks.', style: AtriaType.body(color: AtriaColors.inkMuted))
          else if (days != null)
            for (final e in days!.entries) ...[
              Text(
                ClinicClock.day(ClinicClock.onDate(e.key)),
                style: AtriaType.body(size: 13, weight: FontWeight.w700, color: AtriaColors.ink900),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final t in e.value)
                    FilterChipButton(
                      label: ClinicClock.time(t),
                      on: picked == t,
                      onTap: () => setState(() => picked = t),
                    ),
                ],
              ),
              const SizedBox(height: 14),
            ],
          const SizedBox(height: 6),
          PrimaryButton(label: 'Move it here', busy: busy, onPressed: picked == null ? null : move),
        ],
      ),
    ),
  );
}
