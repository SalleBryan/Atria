import 'dart:math';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../api/api.dart';
import '../patient/data.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/glass.dart';
import '../ui/icons.dart';
import '../ui/widgets.dart';
import '../ui/loading.dart';
import '../ui/expressive.dart';
import 'visits.dart' show Pill;

/// A time the API offers: free, and bookable by this patient (FR-DIR-02).
typedef Slot = DateTime;

const _avatars = [
  [Color(0xFF7C7BF0), Color(0xFF4B49CE)],
  [Color(0xFF6F9BF5), Color(0xFF3564D6)],
  [Color(0xFF4CA6EC), Color(0xFF1F6FC4)],
  [Color(0xFF3FA9C9), Color(0xFF1E7FA8)],
];

String _key() {
  final r = Random.secure();
  return List.generate(16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
}

String _date(DateTime day) => ClinicClock.isoDate(day);

Future<Map<String, List<Slot>>> _week(Api api, Clinician c, AppointmentType type, DateTime from) async {
  final found = await api.get(
    '/clinicians/${Uri.encodeComponent(c.id)}/slots?from=${_date(from)}&to=${_date(from.add(const Duration(days: 6)))}'
    '&typeId=${Uri.encodeComponent(type.id)}',
  );
  final days = found['days'] as Map? ?? const {};
  return {
    for (final e in days.entries)
      '${e.key}': [for (final s in (e.value as List? ?? const [])) DateTime.parse((s as Map)['startAt'] as String)],
  };
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.clinician, required this.index, this.size = 54, this.light = false});
  final Clinician clinician;
  final int index;
  final double size;
  final bool light;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      gradient: light
          ? cssGradient(145, [Colors.white.withValues(alpha: .96), Colors.white.withValues(alpha: .74)])
          : cssGradient(145, _avatars[index % _avatars.length], [.141, .859]),
      borderRadius: BorderRadius.circular(size / 3),
      boxShadow: light ? const [BoxShadow(offset: Offset(0, 8), blurRadius: 20, color: Color(0x33102A5E))] : null,
    ),
    child: Text(
      initials(clinician.givenName, clinician.familyName),
      style: AtriaType.display(
        size: size * .3,
        weight: FontWeight.w600,
        color: light ? AtriaColors.blue700 : Colors.white,
      ).copyWith(letterSpacing: 0),
    ),
  );
}

class _Back extends StatelessWidget {
  const _Back({required this.onTap, this.label = 'Back'});
  final VoidCallback onTap;
  final String label;

  @override
  Widget build(BuildContext context) => Glass(
    radius: 16,
    height: 46,
    semanticLabel: label,
    onTap: onTap,
    child: const SizedBox(
      width: 46,
      child: Center(child: AtriaIcon('chevronLeft', size: 19, color: AtriaColors.ink800)),
    ),
  );
}

/// "Mobile · Search results" (Figma 34:2): the clinicians a patient can book,
/// narrowed by what they type and by specialty, soonest opening first.
/// The frame's distance and fee chips give way to what Atria knows: the
/// specialty and the languages spoken (FR-DIR-01).
class FindCareScreen extends StatefulWidget {
  const FindCareScreen({super.key, required this.store, this.query = '', this.clinician});
  final PatientStore store;
  final String query;
  final String? clinician;

  @override
  State<FindCareScreen> createState() => _FindCareScreenState();
}

class _FindCareScreenState extends State<FindCareScreen> {
  late final search = TextEditingController(text: widget.query);
  final next = <String, DateTime?>{};
  bool today = false;
  bool french = false;
  bool asked = false;

  @override
  void initState() {
    super.initState();
    search.addListener(() => setState(() {}));
    if (widget.clinician != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) context.go('/find-care/${widget.clinician}');
      });
    }
  }

  void ask(PatientData data) {
    if (asked) return;
    asked = true;
    final now = DateTime.now();
    for (final c in data.bookable) {
      final type = specialistTypes(data.types, c.clinicId).firstOrNull;
      if (type == null) continue;
      _week(widget.store.api, c, type, now)
          .then((days) {
            final keys = days.keys.toList()..sort();
            final first = [for (final k in keys) ...days[k]!].where((t) => t.isAfter(now)).firstOrNull;
            if (mounted) setState(() => next[c.id] = first);
          })
          .catchError((Object _) {
            if (mounted) setState(() => next[c.id] = null);
          });
    }
  }

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.store,
      builder: (context, _) {
        final state = widget.store.state;
        if (state is DataFailed) {
          return Padding(
            padding: const EdgeInsets.all(20),
            child: Notice(state.message, tone: NoticeTone.error),
          );
        }
        if (state is! DataReady) return const Center(child: LoadingIndicator());
        final data = state.data;
        ask(data);
        final words = search.text.trim().toLowerCase();
        final todayKey = _date(DateTime.now());
        final found =
            data.bookable.where((c) {
              final clinic = data.clinics.where((u) => u.id == c.clinicId).firstOrNull;
              final text = [c.name, c.specialty, clinic?.name].whereType<String>().join(' ').toLowerCase();
              if (words.isNotEmpty && !words.split(' ').every(text.contains)) return false;
              if (today && (next[c.id] == null || _date(next[c.id]!) != todayKey)) return false;
              if (french && !((c.raw['languages'] as List?)?.contains('fr') ?? false)) return false;
              return true;
            }).toList()..sort((a, b) {
              final x = next[a.id], y = next[b.id];
              if (x == null && y == null) return a.name.compareTo(b.name);
              if (x == null) return 1;
              if (y == null) return -1;
              return x.compareTo(y);
            });

        return ListView(
          padding: const EdgeInsets.fromLTRB(20, 26, 20, 132),
          children: [
            Rise(
              child: Row(
                children: [
                  _Back(onTap: () => context.go('/home'), label: 'Back home'),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Container(
                      height: 50,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(18),
                        border: Border.all(color: AtriaColors.blue500, width: 1.5),
                        boxShadow: const [BoxShadow(offset: Offset(0, 4), blurRadius: 14, color: Color(0x1F2F6BE4))],
                      ),
                      child: Row(
                        children: [
                          const SizedBox(width: 14),
                          const AtriaIcon('search', size: 18, color: AtriaColors.blue600),
                          const SizedBox(width: 10),
                          Expanded(
                            child: TextField(
                              onTapOutside: (_) => FocusManager.instance.primaryFocus?.unfocus(),
                              controller: search,
                              textInputAction: TextInputAction.search,
                              style: AtriaType.body(size: 15, weight: FontWeight.w600, color: AtriaColors.inkPrimary),
                              decoration: InputDecoration(
                                isDense: true,
                                border: InputBorder.none,
                                hintText: 'Clinician, specialty or unit',
                                hintStyle: AtriaType.body(size: 14.5, color: const Color(0xFF8497B8)),
                              ),
                            ),
                          ),
                          if (search.text.isNotEmpty)
                            IconButton(
                              tooltip: 'Clear',
                              onPressed: search.clear,
                              icon: Container(
                                width: 22,
                                height: 22,
                                alignment: Alignment.center,
                                decoration: const BoxDecoration(
                                  color: AtriaColors.surfaceField,
                                  shape: BoxShape.circle,
                                ),
                                child: const AtriaIcon('close', size: 12, color: AtriaColors.inkMuted, stroke: 2.4),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Rise(
              index: 1,
              child: Row(
                children: [
                  _Toggle(label: 'Available today', on: today, onTap: () => setState(() => today = !today)),
                  const SizedBox(width: 8),
                  _Toggle(label: 'Speaks French', on: french, onTap: () => setState(() => french = !french)),
                ],
              ),
            ),
            const SizedBox(height: 22),
            Rise(
              index: 2,
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      words.isEmpty
                          ? '${found.length} clinicians'
                          : '${found.length} ${found.length == 1 ? 'clinician' : 'clinicians'} for "${search.text.trim()}"',
                      style: AtriaType.body(size: 13, color: AtriaColors.inkMuted),
                    ),
                  ),
                  Text(
                    'Soonest first',
                    style: AtriaType.body(size: 13, weight: FontWeight.w700, color: AtriaColors.blue600),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            if (found.isEmpty)
              Text(
                'Nobody matches that. Try a specialty or a unit.',
                style: AtriaType.body(color: AtriaColors.inkMuted),
              ),
            for (var i = 0; i < found.length; i++) ...[
              if (i > 0) const SizedBox(height: 12),
              Rise(
                index: i + 3,
                child: _ClinicianRow(
                  clinician: found[i],
                  index: i,
                  data: data,
                  next: next[found[i].id],
                  checking: !next.containsKey(found[i].id),
                ),
              ),
            ],
          ],
        );
      },
    );
  }
}

class _Toggle extends StatelessWidget {
  const _Toggle({required this.label, required this.on, required this.onTap});
  final String label;
  final bool on;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    selected: on,
    child: Pressable(
      onTap: onTap,
      radius: 16,
      ink: AtriaColors.blue700,
      builder: (context, _) => AnimatedContainer(
        duration: AtriaMotion.spatialFastDuration,
        curve: AtriaMotion.spatialFast,
        height: 44,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          gradient: on
              ? accentGradient()
              : cssGradient(160, [Colors.white.withValues(alpha: .9), Colors.white.withValues(alpha: .58)]),
          borderRadius: BorderRadius.circular(on ? 22 : 15),
          border: Border.all(color: Colors.white),
          boxShadow: const [BoxShadow(offset: Offset(0, 1), blurRadius: 6, color: Color(0x0F0F295E))],
        ),
        child: Text(
          label,
          style: AtriaType.body(size: 13.5, weight: FontWeight.w600, color: on ? Colors.white : AtriaColors.ink800),
        ),
      ),
    ),
  );
}

class _ClinicianRow extends StatelessWidget {
  const _ClinicianRow({
    required this.clinician,
    required this.index,
    required this.data,
    required this.next,
    required this.checking,
  });
  final Clinician clinician;
  final int index;
  final PatientData data;
  final DateTime? next;
  final bool checking;

  @override
  Widget build(BuildContext context) {
    final clinic = data.clinics.where((u) => u.id == clinician.clinicId).firstOrNull;
    final today = next != null && _date(next!) == _date(DateTime.now());
    final languages = ((clinician.raw['languages'] as List?) ?? const []).map((l) => '$l'.toUpperCase()).join(' ');
    return Glass(
      radius: 24,
      padding: const EdgeInsets.all(14),
      semanticLabel: clinician.name,
      onTap: () => context.go('/find-care/${clinician.id}'),
      child: Row(
        children: [
          _Avatar(clinician: clinician, index: index),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  clinician.name,
                  style: AtriaType.display(size: 15.5, weight: FontWeight.w600).copyWith(letterSpacing: 0, height: 1.3),
                ),
                Text(
                  [clinician.specialty, clinic?.name].whereType<String>().join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AtriaType.body(size: 12.5, color: AtriaColors.inkSoft, height: 1.35),
                ),
                const SizedBox(height: 7),
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  children: [
                    Pill(
                      text: checking
                          ? 'Checking'
                          : next == null
                          ? 'Nothing this week'
                          : today
                          ? 'Today ${ClinicClock.time(next!)}'
                          : '${ClinicClock.day(next!).split(' ').first} ${ClinicClock.time(next!)}',
                      colour: today ? AtriaColors.confirmedInk : AtriaColors.bookedInk,
                    ),
                    if (languages.isNotEmpty) Pill(text: languages, colour: AtriaColors.bookedInk),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            seniorityLabel[clinician.seniority] ?? '',
            style: AtriaType.body(size: 12.5, weight: FontWeight.w700, color: AtriaColors.inkPrimary),
          ),
        ],
      ),
    );
  }
}

/// "Mobile · Booking" (Figma 34:103): the clinician, a day, a free time, and
/// the booking itself (FR-BKG-01, FR-BKG-02). Only free starts are shown,
/// because the API returns only those; the frame's struck-through times go.
class ClinicianScreen extends StatefulWidget {
  const ClinicianScreen({super.key, required this.id, required this.store});
  final String id;
  final PatientStore store;

  @override
  State<ClinicianScreen> createState() => _ClinicianScreenState();
}

class _ClinicianScreenState extends State<ClinicianScreen> {
  Map<String, List<Slot>>? days;
  String? day;
  Slot? slot;
  String key = _key();
  bool booking = false;
  String? failure;

  Future<void> load(PatientData data, Clinician c, AppointmentType type) async {
    try {
      final found = await _week(widget.store.api, c, type, DateTime.now());
      final keys = found.keys.toList()..sort();
      if (!mounted) return;
      setState(() {
        days = found;
        day ??= keys.where((k) => found[k]!.isNotEmpty).firstOrNull ?? keys.firstOrNull;
      });
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = e.message);
    }
  }

  Future<void> book(Clinician c, AppointmentType type) async {
    final chosen = slot;
    if (chosen == null) return;
    setState(() {
      booking = true;
      failure = null;
    });
    try {
      final made = await widget.store.api.send(
        'POST',
        '/appointments',
        {
          'appointmentTypeId': type.id,
          'clinicianProfileId': c.id,
          'startAt': chosen.toUtc().toIso8601String().replaceFirst('.000', ''),
        },
        {'Idempotency-Key': key},
      );
      await widget.store.reload();
      if (mounted) context.go('/booked/${made['appointmentId']}');
    } on ApiError catch (e) {
      if (!mounted) return;
      if (e.status == 409) {
        context.go('/find-care/${c.id}/taken?at=${Uri.encodeQueryComponent(chosen.toUtc().toIso8601String())}');
      } else {
        setState(() => failure = e.message);
      }
    } finally {
      if (mounted) setState(() => booking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.store,
      builder: (context, _) {
        final state = widget.store.state;
        if (state is! DataReady) return const Scaffold(body: Center(child: LoadingIndicator()));
        final data = state.data;
        final c = data.clinicians.where((x) => x.id == widget.id).firstOrNull;
        final type = c == null ? null : specialistTypes(data.types, c.clinicId).firstOrNull;
        if (c == null || type == null) {
          return const Scaffold(body: Center(child: Text('That clinician is not bookable here.')));
        }
        if (days == null && failure == null) load(data, c, type);
        final clinic = data.clinics.where((u) => u.id == c.clinicId).firstOrNull;
        final minutes = (type.durationUnits ?? 0) * 10;
        final keys = (days?.keys.toList() ?? [])..sort();
        final times = day == null ? <Slot>[] : days?[day] ?? <Slot>[];
        final experience = c.raw['registrationYear'] is int
            ? DateTime.now().year - (c.raw['registrationYear'] as int)
            : null;
        final languages = ((c.raw['languages'] as List?) ?? const []).map((l) => '$l'.toUpperCase()).join(' ');

        return Scaffold(
          extendBody: true,
          body: PageBackground(
            child: SafeArea(
              bottom: false,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 26, 20, 140),
                children: [
                  Rise(
                    child: Row(
                      children: [
                        _Back(onTap: () => context.go('/find-care'), label: 'Back to find care'),
                        Expanded(
                          child: Text(
                            'Clinician',
                            textAlign: TextAlign.center,
                            style: AtriaType.display(size: 17, weight: FontWeight.w600).copyWith(letterSpacing: 0),
                          ),
                        ),
                        const SizedBox(width: 46),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  Rise(
                    index: 1,
                    child: Container(
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        gradient: cssGradient(
                          151,
                          const [AtriaColors.blue500, AtriaColors.blue600, Color(0xFF1E52C4)],
                          [.144, .472, .856],
                        ),
                        borderRadius: BorderRadius.circular(30),
                        boxShadow: const [BoxShadow(offset: Offset(0, 12), blurRadius: 30, color: Color(0x571E52C4))],
                      ),
                      child: Column(
                        children: [
                          Row(
                            children: [
                              _Avatar(clinician: c, index: 0, size: 72, light: true),
                              const SizedBox(width: 16),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      c.name,
                                      style: AtriaType.display(size: 21, color: Colors.white).copyWith(height: 1.15),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      [c.specialty, clinic?.name].whereType<String>().join(' · '),
                                      style: AtriaType.body(
                                        size: 13,
                                        color: Colors.white.withValues(alpha: .9),
                                        height: 1.3,
                                      ),
                                    ),
                                    const SizedBox(height: 8),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                      decoration: BoxDecoration(
                                        borderRadius: BorderRadius.circular(999),
                                        border: Border.all(color: Colors.white.withValues(alpha: .8)),
                                      ),
                                      child: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          const AtriaIcon('clock', size: 12, color: Colors.white),
                                          const SizedBox(width: 6),
                                          Text(
                                            '$minutes min visit',
                                            style: AtriaType.body(
                                              size: 12,
                                              weight: FontWeight.w600,
                                              color: Colors.white,
                                              height: 1.2,
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
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            decoration: glassOnAccent(20),
                            child: Row(
                              children: [
                                for (final (value, label) in [
                                  (experience == null ? '-' : '${experience}y', 'Experience'),
                                  (seniorityLabel[c.seniority]?.split(' ').first ?? '-', 'Band'),
                                  ('${c.raw['registrationYear'] ?? '-'}', 'Registered'),
                                  (languages.isEmpty ? '-' : languages, 'Languages'),
                                ])
                                  Expanded(
                                    child: Column(
                                      children: [
                                        Text(
                                          value,
                                          style: AtriaType.display(
                                            size: 15,
                                            weight: FontWeight.w700,
                                            color: Colors.white,
                                          ),
                                        ),
                                        Text(
                                          label,
                                          style: AtriaType.body(
                                            size: 10.5,
                                            color: Colors.white.withValues(alpha: .85),
                                            height: 1.4,
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
                    ),
                  ),
                  const SizedBox(height: 22),
                  Rise(
                    index: 2,
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            'Pick a day',
                            style: AtriaType.display(size: 17, weight: FontWeight.w600).copyWith(letterSpacing: 0),
                          ),
                        ),
                        if (keys.isNotEmpty)
                          Text(
                            _monthYear(keys.first),
                            style: AtriaType.body(size: 12.5, weight: FontWeight.w600, color: AtriaColors.blue600),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    height: 76,
                    child: days == null
                        ? const Center(child: LoadingIndicator())
                        : ListView.separated(
                            scrollDirection: Axis.horizontal,
                            itemCount: keys.length,
                            separatorBuilder: (_, _) => const SizedBox(width: 9),
                            itemBuilder: (_, i) => _Day(
                              iso: keys[i],
                              on: keys[i] == day,
                              open: days![keys[i]]!.isNotEmpty,
                              onTap: () => setState(() {
                                day = keys[i];
                                slot = null;
                                key = _key();
                              }),
                            ),
                          ),
                  ),
                  const SizedBox(height: 22),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          'Choose a time',
                          style: AtriaType.display(size: 17, weight: FontWeight.w600).copyWith(letterSpacing: 0),
                        ),
                      ),
                      Text(
                        '${times.length} open',
                        style: AtriaType.body(size: 12.5, weight: FontWeight.w600, color: AtriaColors.blue600),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  if (times.isEmpty && days != null)
                    Text('No free times that day. Try another.', style: AtriaType.body(color: AtriaColors.inkMuted))
                  else
                    GridView.count(
                      crossAxisCount: 3,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      mainAxisSpacing: 10,
                      crossAxisSpacing: 10,
                      childAspectRatio: 110 / 50,
                      children: [
                        for (final t in times)
                          _Time(
                            label: ClinicClock.time(t),
                            on: t == slot,
                            onTap: () => setState(() {
                              slot = t;
                              key = _key();
                            }),
                          ),
                      ],
                    ),
                  if (failure != null) ...[const SizedBox(height: 14), Notice(failure!, tone: NoticeTone.error)],
                ],
              ),
            ),
          ),
          bottomNavigationBar: SafeArea(
            minimum: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Container(
              padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
              decoration: BoxDecoration(
                gradient: cssGradient(170, [Colors.white.withValues(alpha: .94), Colors.white.withValues(alpha: .78)]),
                borderRadius: BorderRadius.circular(28),
                border: Border.all(color: Colors.white),
                boxShadow: const [BoxShadow(offset: Offset(0, 10), blurRadius: 30, color: Color(0x290F295E))],
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          slot == null ? 'No time selected' : ClinicClock.day(slot!),
                          style: AtriaType.body(size: 12, color: AtriaColors.inkMuted, height: 1.3),
                        ),
                        Text(
                          slot == null ? 'Pick a slot above' : '${ClinicClock.time(slot!)}, $minutes min',
                          style: AtriaType.body(
                            size: 15,
                            weight: FontWeight.w700,
                            color: AtriaColors.inkPrimary,
                            height: 1.3,
                          ),
                        ),
                      ],
                    ),
                  ),
                  SizedBox(
                    width: 108,
                    child: PrimaryButton(
                      label: 'Book',
                      busy: booking,
                      onPressed: slot == null ? null : () => book(c, type),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

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
const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

String _monthYear(String iso) {
  final d = DateTime.parse(iso);
  return '${_months[d.month - 1]} ${d.year}';
}

class _Day extends StatelessWidget {
  const _Day({required this.iso, required this.on, required this.open, required this.onTap});
  final String iso;
  final bool on;
  final bool open;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final d = DateTime.parse(iso);
    final ink = on ? Colors.white : (open ? AtriaColors.inkPrimary : AtriaColors.ink400);
    return Semantics(
      button: true,
      selected: on,
      label: '${_weekdays[d.weekday - 1]} ${d.day}${open ? '' : ', no free times'}',
      excludeSemantics: true,
      child: Pressable(
        onTap: onTap,
        radius: 16,
        ink: AtriaColors.blue700,
        builder: (context, _) => AnimatedContainer(
          duration: AtriaMotion.spatialFastDuration,
          curve: AtriaMotion.spatialFast,
          width: 56,
          decoration: BoxDecoration(
            gradient: on
                ? accentGradient()
                : cssGradient(160, [Colors.white.withValues(alpha: .92), Colors.white.withValues(alpha: .62)]),
            borderRadius: BorderRadius.circular(on ? 24 : 18),
            border: Border.all(color: Colors.white),
            boxShadow: [if (on) const BoxShadow(offset: Offset(0, 8), blurRadius: 18, color: Color(0x572F6BE4))],
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(_weekdays[d.weekday - 1], style: AtriaType.body(size: 12, color: ink, height: 1.3)),
              Text(
                '${d.day}',
                style: AtriaType.display(size: 21, weight: FontWeight.w700, color: ink),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Time extends StatelessWidget {
  const _Time({required this.label, required this.on, required this.onTap});
  final String label;
  final bool on;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    selected: on,
    child: Pressable(
      onTap: onTap,
      radius: 16,
      ink: AtriaColors.blue700,
      builder: (context, _) => AnimatedContainer(
        duration: AtriaMotion.spatialFastDuration,
        curve: AtriaMotion.spatialFast,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          gradient: on
              ? accentGradient()
              : cssGradient(160, [Colors.white.withValues(alpha: .92), Colors.white.withValues(alpha: .66)]),
          borderRadius: BorderRadius.circular(on ? 20 : 16),
          border: Border.all(color: Colors.white),
          boxShadow: [
            on
                ? const BoxShadow(offset: Offset(0, 6), blurRadius: 16, color: Color(0x572F6BE4))
                : const BoxShadow(offset: Offset(0, 1), blurRadius: 6, color: Color(0x0F0F295E)),
          ],
        ),
        child: Text(
          label,
          style: AtriaType.body(size: 15, weight: FontWeight.w600, color: on ? Colors.white : AtriaColors.inkPrimary),
        ),
      ),
    ),
  );
}

/// "Mobile · Slot conflict" (Figma 35:2): somebody booked the time first, so
/// nothing was written (409); the closest openings with the same specialty
/// are offered instead (FR-BKG-04).
class TakenScreen extends StatefulWidget {
  const TakenScreen({super.key, required this.clinicianId, required this.at, required this.store});
  final String clinicianId;
  final DateTime at;
  final PatientStore store;

  @override
  State<TakenScreen> createState() => _TakenScreenState();
}

class _TakenScreenState extends State<TakenScreen> {
  List<(Clinician, Slot)>? offers;
  (Clinician, Slot)? picked;
  bool booking = false;
  String? failure;
  String key = _key();

  Future<void> load(PatientData data, Clinician taken) async {
    final peers = [taken, ...data.bookable.where((c) => c.id != taken.id && c.specialty == taken.specialty)];
    final all = <(Clinician, Slot)>[];
    for (final c in peers) {
      final type = specialistTypes(data.types, c.clinicId).firstOrNull;
      if (type == null) continue;
      try {
        final week = await _week(widget.store.api, c, type, widget.at);
        for (final list in week.values) {
          for (final s in list) {
            if (s != widget.at && s.isAfter(DateTime.now())) all.add((c, s));
          }
        }
      } on ApiError {
        // One clinician's calendar failing leaves the others to offer.
      }
    }
    all.sort((a, b) => (a.$2.difference(widget.at).abs()).compareTo(b.$2.difference(widget.at).abs()));
    if (mounted) setState(() => offers = all.take(4).toList());
  }

  Future<void> hold(PatientData data) async {
    final chosen = picked;
    if (chosen == null) return;
    final type = specialistTypes(data.types, chosen.$1.clinicId).first;
    setState(() {
      booking = true;
      failure = null;
    });
    try {
      final made = await widget.store.api.send(
        'POST',
        '/appointments',
        {
          'appointmentTypeId': type.id,
          'clinicianProfileId': chosen.$1.id,
          'startAt': chosen.$2.toUtc().toIso8601String().replaceFirst('.000', ''),
        },
        {'Idempotency-Key': key},
      );
      await widget.store.reload();
      if (mounted) context.go('/booked/${made['appointmentId']}');
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() {
        failure = e.status == 409 ? 'That one went too. Choose another.' : e.message;
        if (e.status == 409) offers = offers?.where((o) => o != chosen).toList();
        picked = null;
        key = _key();
        booking = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.store.state;
    if (state is! DataReady) return const Scaffold(body: Center(child: LoadingIndicator()));
    final data = state.data;
    final taken = data.clinicians.where((c) => c.id == widget.clinicianId).firstOrNull;
    if (taken == null) return const Scaffold(body: SizedBox.shrink());
    if (offers == null) load(data, taken);
    final clinic = data.clinics.where((u) => u.id == taken.clinicId).firstOrNull;

    return Scaffold(
      extendBody: true,
      body: PageBackground(
        child: SafeArea(
          bottom: false,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 26, 20, 140),
            children: [
              Rise(
                child: Row(
                  children: [
                    _Back(onTap: () => context.go('/find-care/${taken.id}'), label: 'Back to the calendar'),
                    Expanded(
                      child: Text(
                        'Slot unavailable',
                        textAlign: TextAlign.center,
                        style: AtriaType.display(size: 17, weight: FontWeight.w600).copyWith(letterSpacing: 0),
                      ),
                    ),
                    const SizedBox(width: 46),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              Rise(
                index: 1,
                child: Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFDE8EA),
                    borderRadius: BorderRadius.circular(26),
                    border: Border.all(color: AtriaColors.cancelled, width: 1.2),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          gradient: cssGradient(145, const [Color(0xFFE8606F), Color(0xFFC33C4E)]),
                          borderRadius: BorderRadius.circular(15),
                        ),
                        child: const AtriaIcon('alert', size: 20, color: Colors.white),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Someone took that slot',
                              style: AtriaType.display(
                                size: 16,
                                weight: FontWeight.w600,
                                color: AtriaColors.cancelledInk,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              '${ClinicClock.time(widget.at)} was booked a few seconds before you confirmed, so we did not '
                              'hold it for you. No appointment was created.',
                              style: AtriaType.body(size: 13, color: AtriaColors.cancelledInk, height: 1.5),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 14),
              Rise(
                index: 2,
                child: Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: .5),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: AtriaColors.lineSoft, width: 1.5),
                  ),
                  child: Row(
                    children: [
                      Text(
                        ClinicClock.time(widget.at),
                        style: AtriaType.display(size: 17, color: AtriaColors.inkMuted).copyWith(letterSpacing: 0),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              taken.name,
                              style: AtriaType.body(
                                size: 14,
                                weight: FontWeight.w700,
                                color: AtriaColors.inkMuted,
                              ).copyWith(decoration: TextDecoration.lineThrough),
                            ),
                            Text(
                              [ClinicClock.day(widget.at), clinic?.name].whereType<String>().join(' · '),
                              style: AtriaType.body(size: 12, color: AtriaColors.inkSoft, height: 1.3),
                            ),
                          ],
                        ),
                      ),
                      Pill(text: 'TAKEN', colour: AtriaColors.inkMuted),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 22),
              Text(
                'Closest openings',
                style: AtriaType.display(size: 17, weight: FontWeight.w600).copyWith(letterSpacing: 0),
              ),
              const SizedBox(height: 12),
              if (offers == null)
                const Center(child: LoadingIndicator())
              else if (offers!.isEmpty)
                Text('No openings close to that time.', style: AtriaType.body(color: AtriaColors.inkMuted))
              else
                for (final o in offers!) ...[
                  Glass(
                    radius: 22,
                    padding: const EdgeInsets.all(14),
                    semanticLabel: '${o.$1.name}, ${ClinicClock.day(o.$2)} at ${ClinicClock.time(o.$2)}',
                    onTap: () => setState(() => picked = o),
                    child: Row(
                      children: [
                        SizedBox(
                          width: 64,
                          child: Text(
                            ClinicClock.time(o.$2),
                            style: AtriaType.display(size: 17, weight: FontWeight.w600).copyWith(letterSpacing: 0),
                          ),
                        ),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                o.$1.name,
                                style: AtriaType.body(size: 14, weight: FontWeight.w700, color: AtriaColors.inkPrimary),
                              ),
                              Text(
                                ClinicClock.day(o.$2),
                                style: AtriaType.body(size: 12, color: AtriaColors.inkSoft, height: 1.3),
                              ),
                            ],
                          ),
                        ),
                        AnimatedContainer(
                          duration: AtriaMotion.spatialFastDuration,
                          width: 22,
                          height: 22,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: picked == o ? AtriaColors.blue600 : AtriaColors.lineSoft,
                              width: picked == o ? 7 : 1.5,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                ],
              if (failure != null) Notice(failure!, tone: NoticeTone.error),
            ],
          ),
        ),
      ),
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
          decoration: BoxDecoration(
            gradient: cssGradient(170, [Colors.white.withValues(alpha: .94), Colors.white.withValues(alpha: .78)]),
            borderRadius: BorderRadius.circular(28),
            border: Border.all(color: Colors.white),
            boxShadow: const [BoxShadow(offset: Offset(0, 10), blurRadius: 30, color: Color(0x290F295E))],
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Choose a replacement',
                      style: AtriaType.body(size: 12, color: AtriaColors.inkMuted, height: 1.3),
                    ),
                    Text(
                      picked == null
                          ? 'Nothing selected yet'
                          : '${ClinicClock.day(picked!.$2)}, ${ClinicClock.time(picked!.$2)}',
                      style: AtriaType.body(
                        size: 15,
                        weight: FontWeight.w700,
                        color: AtriaColors.inkPrimary,
                        height: 1.3,
                      ),
                    ),
                  ],
                ),
              ),
              SizedBox(
                width: 116,
                child: PrimaryButton(
                  label: 'Hold it',
                  busy: booking,
                  onPressed: picked == null ? null : () => hold(data),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// "Mobile · Booking confirmed" (Figma 35:89): the ticket, and what happens
/// next. The frame's fee and room give way to the unit and the visit's length.
class BookedScreen extends StatelessWidget {
  const BookedScreen({super.key, required this.id, required this.store, required this.email});
  final String id;
  final PatientStore store;
  final String? email;

  @override
  Widget build(BuildContext context) {
    final state = store.state;
    if (state is! DataReady) return const Scaffold(body: Center(child: LoadingIndicator()));
    final data = state.data;
    final a = data.appointments.where((x) => x.id == id).firstOrNull;
    if (a == null) return const Scaffold(body: SizedBox.shrink());
    final c = data.clinicianOf(a);
    final clinic = data.clinicOf(a);
    final reminder = a.startAt.subtract(const Duration(hours: 24));
    final label = AtriaType.body(
      size: 11,
      weight: FontWeight.w700,
      color: AtriaColors.inkMuted,
    ).copyWith(letterSpacing: .6);
    final value = AtriaType.display(size: 15, weight: FontWeight.w600).copyWith(letterSpacing: 0);

    Widget cell(String k, String v) => Expanded(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(k, style: label),
            const SizedBox(height: 4),
            Text(v, style: value),
          ],
        ),
      ),
    );

    return Scaffold(
      body: DecoratedBox(
        decoration: BoxDecoration(
          gradient: cssGradient(180, const [Color(0xFF2F6BE4), Color(0xFF4A83F0), Color(0xFFDDE9FE)], [0, .38, .62]),
        ),
        child: SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 30, 20, 30),
            children: [
              Rise(
                child: Center(
                  child: Container(
                    width: 92,
                    height: 92,
                    decoration: BoxDecoration(
                      gradient: cssGradient(145, [Colors.white, Colors.white.withValues(alpha: .8)]),
                      borderRadius: BorderRadius.circular(30),
                      boxShadow: const [BoxShadow(offset: Offset(0, 12), blurRadius: 28, color: Color(0x40102A5E))],
                    ),
                    child: const Center(
                      child: AtriaIcon('checkMark', size: 38, color: AtriaColors.blue600, stroke: 2.4),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 22),
              Rise(
                index: 1,
                child: Text(
                  "You're booked.",
                  textAlign: TextAlign.center,
                  style: AtriaType.display(size: 27, color: Colors.white),
                ),
              ),
              const SizedBox(height: 8),
              Rise(
                index: 2,
                child: Text(
                  email == null ? 'A confirmation is on its way.' : 'A confirmation is on its way to\n$email.',
                  textAlign: TextAlign.center,
                  style: AtriaType.body(size: 14, color: Colors.white.withValues(alpha: .92)),
                ),
              ),
              const SizedBox(height: 24),
              Rise(
                index: 3,
                child: Container(
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(28),
                    boxShadow: AtriaShadows.raised,
                  ),
                  child: Column(
                    children: [
                      Padding(
                        padding: const EdgeInsets.all(18),
                        child: Row(
                          children: [
                            if (c != null) _Avatar(clinician: c, index: 1, size: 58),
                            const SizedBox(width: 14),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    c?.name ?? 'Your visit',
                                    style: AtriaType.display(size: 17, weight: FontWeight.w600),
                                  ),
                                  Text(
                                    [c?.specialty, clinic?.name].whereType<String>().join(' · '),
                                    style: AtriaType.body(size: 12.5, color: AtriaColors.inkSoft, height: 1.3),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                      const Divider(height: 1, color: AtriaColors.lineHairline),
                      IntrinsicHeight(
                        child: Row(
                          children: [
                            cell('DATE', ClinicClock.day(a.startAt)),
                            const VerticalDivider(width: 1, color: AtriaColors.lineHairline),
                            cell('TIME', '${ClinicClock.time(a.startAt)} to ${ClinicClock.time(a.endAt)}'),
                          ],
                        ),
                      ),
                      const Divider(height: 1, color: AtriaColors.lineHairline),
                      IntrinsicHeight(
                        child: Row(
                          children: [
                            cell('WHERE', clinic?.name ?? '-'),
                            const VerticalDivider(width: 1, color: AtriaColors.lineHairline),
                            cell('LENGTH', '${a.endAt.difference(a.startAt).inMinutes} min'),
                          ],
                        ),
                      ),
                      const Divider(height: 1, color: AtriaColors.lineHairline),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(18, 14, 18, 16),
                        child: Row(
                          children: [
                            const AtriaIcon('clipboard', size: 15, color: AtriaColors.blue600),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                a.reference,
                                style: AtriaType.body(size: 13, weight: FontWeight.w700, color: AtriaColors.ink800),
                              ),
                            ),
                            Pill(text: 'CONFIRMED', colour: AtriaColors.confirmedInk),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Rise(
                index: 4,
                child: Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(26),
                    boxShadow: AtriaShadows.panel,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('What happens next', style: AtriaType.display(size: 15, weight: FontWeight.w600)),
                      const SizedBox(height: 12),
                      for (final (icon, title, sub, colour) in [
                        ('checkMark', 'Confirmation email', 'Sent just now', AtriaColors.blue600),
                        if (reminder.isAfter(DateTime.now()))
                          (
                            'clock',
                            'SMS reminder',
                            '${ClinicClock.day(reminder)}, ${ClinicClock.time(reminder)}, 24 hours before',
                            AtriaColors.awaitingInk,
                          ),
                        (
                          'user',
                          'Arrive 10 minutes early',
                          'Bring your ID and any referral letter',
                          AtriaColors.inkMuted,
                        ),
                      ])
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: Row(
                            children: [
                              Container(
                                width: 26,
                                height: 26,
                                alignment: Alignment.center,
                                decoration: BoxDecoration(color: colour.withValues(alpha: .14), shape: BoxShape.circle),
                                child: AtriaIcon(icon, size: 13, color: colour),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      title,
                                      style: AtriaType.body(
                                        size: 13.5,
                                        weight: FontWeight.w700,
                                        color: AtriaColors.ink900,
                                      ),
                                    ),
                                    Text(sub, style: AtriaType.body(size: 12, color: AtriaColors.inkSoft, height: 1.3)),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 18),
              PrimaryButton(label: 'See my visits', onPressed: () => context.go('/visits')),
            ],
          ),
        ),
      ),
    );
  }
}
