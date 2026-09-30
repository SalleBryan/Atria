import 'package:flutter/material.dart';

import '../api/api.dart';
import '../patient/data.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/expressive.dart';
import '../ui/filters.dart';
import '../ui/glass.dart';
import '../ui/loading.dart';
import '../ui/widgets.dart';
import 'data.dart';
import 'parts.dart';

/// The procedure requests inbox (web: Requests.tsx, FR-STF-15): what patients
/// asked for, oldest first, to size and place with a clinician and a time, or
/// to decline with a reason the patient reads.
class RequestsScreen extends StatefulWidget {
  const RequestsScreen({super.key, required this.store});
  final StaffStore store;

  @override
  State<RequestsScreen> createState() => _RequestsScreenState();
}

class _RequestsScreenState extends State<RequestsScreen> {
  Map<String, dynamic>? inbox;
  String? failure;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final r = await widget.store.api.get('/clinics/${Uri.encodeComponent(widget.store.clinicId ?? '')}/requests');
      if (mounted) setState(() => inbox = r);
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = e.message);
    }
  }

  Future<void> open(Appointment a, String name) async {
    final said = await showModalBottomSheet<String>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: AtriaColors.surfacePanel,
      builder: (_) => _Decide(store: widget.store, a: a, name: name),
    );
    if (said != null && mounted) {
      say(context, said);
      load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final dir = widget.store.directory;
    final list = [
      for (final a in (inbox?['appointments'] as List? ?? const []).cast<Map<String, dynamic>>()) Appointment(a),
    ]..sort((a, b) => a.createdAt.compareTo(b.createdAt));
    final names = <String, PatientName>{};
    (inbox?['patients'] as Map? ?? const {}).forEach(
      (k, v) => names['$k'] = PatientName((v as Map)['givenName'] as String?, v['familyName'] as String?),
    );
    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 130),
        children: [
          Rise(
            child: StaffHeader(
              title: 'Requests',
              sub: '${dir?.clinic(widget.store.clinicId)?.name ?? 'Your unit'} · procedures patients asked for',
            ),
          ),
          const SizedBox(height: 16),
          if (failure != null)
            Notice(failure!, tone: NoticeTone.error)
          else if (inbox == null)
            const Padding(
              padding: EdgeInsets.all(40),
              child: Center(child: LoadingIndicator(label: 'Loading')),
            )
          else if (list.isEmpty)
            Glass(
              radius: 22,
              padding: const EdgeInsets.all(18),
              child: Text(
                'No request is waiting. New ones appear here, oldest first.',
                textAlign: TextAlign.center,
                style: AtriaType.body(color: AtriaColors.inkMuted),
              ),
            )
          else
            for (final (i, a) in list.indexed) ...[
              if (i > 0) const SizedBox(height: 10),
              Rise(
                index: 1 + i,
                child: Glass(
                  radius: 22,
                  onTap: () => open(a, names[a.patientId]?.full ?? 'The patient'),
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Initials(names[a.patientId]?.initials ?? ''),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  (names[a.patientId]?.full ?? '').isEmpty ? 'Patient' : names[a.patientId]!.full,
                                  style: AtriaType.body(size: 14.5, weight: FontWeight.w700, color: AtriaColors.ink900),
                                ),
                                Text(
                                  '${dir?.type(a.typeId)?.name ?? 'Procedure'} · asked ${ClinicClock.day(a.createdAt)}',
                                  style: AtriaType.body(size: 12, color: AtriaColors.inkSoft),
                                ),
                              ],
                            ),
                          ),
                          const StateChip('Waiting', StaffTone.awaiting),
                        ],
                      ),
                      if ((a.requestNote ?? '').isNotEmpty) ...[
                        const SizedBox(height: 10),
                        Text('"${a.requestNote}"', style: AtriaType.body(size: 13, color: AtriaColors.ink800)),
                      ],
                    ],
                  ),
                ),
              ),
            ],
        ],
      ),
    );
  }
}

class _Decide extends StatefulWidget {
  const _Decide({required this.store, required this.a, required this.name});
  final StaffStore store;
  final Appointment a;
  final String name;

  @override
  State<_Decide> createState() => _DecideState();
}

class _DecideState extends State<_Decide> {
  bool declining = false;
  String? clinicianId;
  Map<String, List<DateTime>>? days;
  String? day;
  DateTime? slot;
  final reason = TextEditingController();
  bool busy = false;
  String? failure;

  Api get api => widget.store.api;

  List<Clinician> get clinicians {
    final all = widget.store.directory?.clinicians ?? const <Clinician>[];
    return widget.store.role == StaffRole.clinician
        ? all.where((c) => c.id == widget.store.me.staffId).toList()
        : all.where((c) => c.clinicId == widget.a.clinicId).toList();
  }

  @override
  void initState() {
    super.initState();
    reason.addListener(() => setState(() {}));
    final first = clinicians.firstOrNull;
    if (first != null) pick(first.id);
  }

  @override
  void dispose() {
    reason.dispose();
    super.dispose();
  }

  Future<void> pick(String id) async {
    setState(() {
      clinicianId = id;
      days = null;
      slot = null;
    });
    final from = ClinicClock.isoDate(DateTime.now());
    final to = ClinicClock.isoDate(DateTime.now().add(const Duration(days: 13)));
    try {
      final r = await api.get(
        '/clinicians/${Uri.encodeComponent(id)}/slots?from=$from&to=$to&typeId=${Uri.encodeComponent(widget.a.typeId)}',
      );
      final raw = (r['days'] as Map? ?? const {});
      final out = <String, List<DateTime>>{};
      for (final k in raw.keys.map((k) => '$k').toList()..sort()) {
        final times = [for (final s in (raw[k] as List? ?? const [])) DateTime.parse((s as Map)['startAt'] as String)]
            .where((t) => t.isAfter(DateTime.now()))
            .toList();
        if (times.isNotEmpty) out[k] = times;
      }
      if (mounted) {
        setState(() {
          days = out;
          day = out.keys.firstOrNull;
        });
      }
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = e.message);
    }
  }

  Future<void> place() async {
    setState(() {
      busy = true;
      failure = null;
    });
    try {
      await api.send('POST', '/appointments/${widget.a.id}/place', {
        'clinicianProfileId': clinicianId,
        'startAt': slot!.toUtc().toIso8601String().replaceFirst('.000', ''),
        'durationUnits': widget.store.directory?.type(widget.a.typeId)?.durationUnits,
      });
      if (mounted) Navigator.pop(context, '${widget.a.reference} placed. The patient is emailed to confirm.');
    } on ApiError catch (e) {
      if (mounted) {
        setState(() {
          failure = '${sentence(e.message)} Nothing was placed.';
          busy = false;
        });
      }
    }
  }

  Future<void> decline() async {
    setState(() {
      busy = true;
      failure = null;
    });
    try {
      await api.send('POST', '/appointments/${widget.a.id}/decline', {'reason': reason.text.trim()});
      if (mounted) Navigator.pop(context, '${widget.a.reference} declined. ${widget.name} can read why.');
    } on ApiError catch (e) {
      if (mounted) {
        setState(() {
          failure = '${sentence(e.message)} Nothing was changed.';
          busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final type = widget.store.directory?.type(widget.a.typeId);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * .85),
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(22, 0, 22, 20),
            children: [
              Text(type?.name ?? 'Procedure', style: AtriaType.display(size: 21)),
              const SizedBox(height: 4),
              Text(
                '${widget.name} · ${widget.a.reference}',
                style: AtriaType.body(size: 13, color: AtriaColors.inkMuted),
              ),
              if ((widget.a.requestNote ?? '').isNotEmpty) ...[
                const SizedBox(height: 10),
                Notice('"${widget.a.requestNote}"'),
              ],
              const SizedBox(height: 14),
              Segmented(
                labels: const ['Place it', 'Decline'],
                selected: declining ? 1 : 0,
                onChanged: (i) => setState(() => declining = i == 1),
              ),
              const SizedBox(height: 14),
              if (declining) ...[
                AtriaField(
                  label: 'Why, in words the patient reads',
                  icon: 'pencil',
                  controller: reason,
                  hint: 'For example, this needs a consultation first',
                ),
                if (failure != null) ...[const SizedBox(height: 12), Notice(failure!, tone: NoticeTone.error)],
                const SizedBox(height: 16),
                PrimaryButton(
                  label: 'Decline the request',
                  danger: true,
                  busy: busy,
                  onPressed: reason.text.trim().length > 2 ? decline : null,
                ),
              ] else ...[
                Text(
                  'Clinician',
                  style: AtriaType.body(size: 12, weight: FontWeight.w600, color: AtriaColors.inkSoft),
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final c in clinicians)
                      FilterChipButton(label: c.name, on: c.id == clinicianId, onTap: () => pick(c.id)),
                  ],
                ),
                const SizedBox(height: 14),
                if (clinicianId != null && days == null)
                  const Center(child: LoadingIndicator(size: 30))
                else if (days != null && days!.isEmpty)
                  Text('No free time in the next two weeks.', style: AtriaType.body(color: AtriaColors.inkMuted))
                else if (days != null) ...[
                  SizedBox(
                    height: 44,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      children: [
                        for (final d in days!.keys)
                          Padding(
                            padding: const EdgeInsets.only(right: 8),
                            child: FilterChipButton(
                              label: ClinicClock.day(ClinicClock.onDate(d)),
                              on: d == day,
                              onTap: () => setState(() {
                                day = d;
                                slot = null;
                              }),
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final t in days![day] ?? const <DateTime>[])
                        FilterChipButton(
                          label: ClinicClock.time(t),
                          on: t == slot,
                          onTap: () => setState(() => slot = t),
                        ),
                    ],
                  ),
                ],
                if (failure != null) ...[const SizedBox(height: 12), Notice(failure!, tone: NoticeTone.error)],
                const SizedBox(height: 16),
                PrimaryButton(label: 'Place it at this time', busy: busy, onPressed: slot == null ? null : place),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
