import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api.dart';
import '../patient/calendar.dart';
import '../patient/care_search.dart';
import '../patient/data.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/glass.dart';
import '../ui/icons.dart';
import '../ui/layout.dart';
import '../ui/search.dart';
import '../ui/widgets.dart';
import '../ui/expressive.dart';
import 'queue.dart';
import '../ui/loading.dart';

/// "Mobile · Home" (Figma 28:2) with everything the web's Home does
/// (web/src/patient/PatientHome.tsx, FR-VIS-01, FR-DIR-02): the greeting and
/// a one-line summary, search that suggests as you type, the next visit with
/// what to do about it, who has an opening today, quick actions, what is
/// coming up, what has happened, and where the next visit is. On a tablet
/// the page takes two columns (Figma "Patient · Tablet", 45:3).
///
/// Where the frame shows something Atria does not have, the space holds the
/// nearest true thing: "5 nearby" counts the openings today, and the arrow on
/// the next appointment opens directions to its unit.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.me, required this.store});
  final Me me;
  final PatientStore store;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final query = TextEditingController();

  @override
  void dispose() {
    query.dispose();
    super.dispose();
  }

  void search(String words) {
    final q = words.trim();
    context.go(q.isEmpty ? '/find-care' : '/find-care?q=${Uri.encodeQueryComponent(q)}');
  }

  List<SuggestionGroup> suggestions(PatientData? data) {
    if (data == null) return const [];
    void go(String name, String value) => context.go('/find-care?$name=${Uri.encodeQueryComponent(value)}');
    return careSuggestions(
      data.bookable,
      data.clinics,
      careChoices(data.bookable, data.clinics),
      clinician: (id) => go('clinician', id),
      specialty: (name) => go('specialty', name),
      clinic: (id) => go('clinic', id),
      language: (code) => go('language', code),
    );
  }

  @override
  Widget build(BuildContext context) {
    final store = widget.store;
    final tablet = tierOf(context) == Tier.tablet;
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        final state = store.state;
        final data = state is DataReady ? state.data : null;
        final head = [
          Rise(
            child: _TopBar(me: widget.me, summary: data == null ? 'Loading your visits' : homeSummary(data)),
          ),
          const SizedBox(height: 22),
          Rise(
            index: 1,
            child: Row(
              children: [
                Expanded(
                  child: SearchSuggest(
                    controller: query,
                    groups: suggestions(data),
                    placeholder: 'Search clinicians or specialties',
                    height: 56,
                    onSubmit: search,
                    trailing: SquareIconButton(
                      icon: 'sliders',
                      label: 'Find care with filters',
                      size: 40,
                      onTap: () => context.go('/find-care'),
                    ),
                  ),
                ),
                if (tablet) ...[const SizedBox(width: 12), _BookButton(onTap: () => context.go('/find-care'))],
              ],
            ),
          ),
          const SizedBox(height: 12),
          const Rise(index: 1, child: QueueEntry()),
          const SizedBox(height: 22),
        ];

        List<Widget> body;
        if (state is DataFailed) {
          body = [Notice(state.message, tone: NoticeTone.error)];
        } else if (data == null) {
          // Loading: the M3 indicator centred where the content will be.
          body = [const LoadingPane(label: 'Loading your visits')];
        } else {
          final next = [
            Rise(
              index: 2,
              child: SectionHead(title: 'Next appointment', link: 'See all', onLink: () => context.go('/visits')),
            ),
            const SizedBox(height: 12),
            Rise(index: 3, child: _NextAppointment(data: data)),
          ];
          final today = Rise(
            index: 4,
            child: AvailableToday(data: data, api: store.api),
          );
          final actions = Rise(index: 5, child: _QuickActions(data: data));
          final coming = Rise(index: 6, child: _Upcoming(data: data));
          final activity = Rise(index: 7, child: _Activity(data: data));
          final unit = Rise(index: 8, child: _UnitCard(data: data));
          const gap = SizedBox(height: 22);
          body = tablet
              ? [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        flex: 3,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [...next, gap, actions, gap, coming],
                        ),
                      ),
                      const SizedBox(width: 22),
                      Expanded(
                        flex: 2,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [today, gap, activity, gap, unit],
                        ),
                      ),
                    ],
                  ),
                ]
              : [...next, gap, actions, gap, today, gap, coming, gap, activity, gap, unit];
        }

        return RefreshIndicator(
          onRefresh: store.reload,
          child: ListView(
            padding: EdgeInsets.fromLTRB(tablet ? 32 : 20, 26, tablet ? 32 : 20, tablet ? 40 : 132),
            children: [...head, ...body],
          ),
        );
      },
    );
  }
}

/// "2 upcoming visits · reminder Tue 7 Oct · last visit Mon 29 Sep", as the
/// web's top bar says it.
String homeSummary(PatientData data, [DateTime? now]) {
  final at = now ?? DateTime.now();
  final ahead = upcoming(data.appointments, at);
  final behind = past(data.appointments, at);
  final next = ahead.firstOrNull;
  final reminder = next?.startAt.subtract(const Duration(days: 1));
  final attended = behind.where((a) => a.state == 'COMPLETED' || a.state == 'AWAITING_FEEDBACK').firstOrNull;
  return [
    ahead.length == 1 ? '1 upcoming visit' : '${ahead.length} upcoming visits',
    if (reminder != null && reminder.isAfter(at)) 'reminder ${ClinicClock.day(reminder)}',
    if (attended != null) 'last visit ${ClinicClock.day(attended.startAt)}',
  ].join(' · ');
}

class _BookButton extends StatelessWidget {
  const _BookButton({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => PressableSurface(
    semanticLabel: 'Book a visit',
    radius: 20,
    height: 56,
    gradient: accentGradient(),
    shadow: const BoxShadow(offset: Offset(0, 8), blurRadius: 20, color: Color(0x572F6BE4)),
    ink: Colors.white,
    onTap: onTap,
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 22),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const AtriaIcon('plus', size: 17, color: Colors.white),
          const SizedBox(width: 8),
          Text(
            'Book a visit',
            style: AtriaType.body(size: 14, weight: FontWeight.w700, color: Colors.white),
          ),
        ],
      ),
    ),
  );
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.me, required this.summary});
  final Me me;
  final String summary;

  @override
  Widget build(BuildContext context) {
    final letters = initials(me.givenName, me.familyName);
    return Row(
      children: [
        Container(
          width: 46,
          height: 46,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            gradient: cssGradient(145, const [Color(0xFF3E78EA), AtriaColors.blue800], [.141, .859]),
            borderRadius: BorderRadius.circular(16),
            boxShadow: const [BoxShadow(offset: Offset(0, 6), blurRadius: 16, color: Color(0x521B4FB8))],
          ),
          child: Text(
            letters.isEmpty ? 'A' : letters,
            style: AtriaType.display(size: 16, weight: FontWeight.w600, color: Colors.white),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                ClinicClock.greeting(),
                style: AtriaType.body(size: 12.5, color: const Color(0xFF63769A), height: 1.3),
              ),
              const SizedBox(height: 1),
              Text(
                me.name.isEmpty ? 'Welcome' : me.name,
                overflow: TextOverflow.ellipsis,
                style: AtriaType.display(size: 19, weight: FontWeight.w600).copyWith(letterSpacing: 0, height: 1.25),
              ),
              const SizedBox(height: 2),
              Text(
                summary,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: AtriaType.body(size: 12, color: AtriaColors.inkSoft, height: 1.3),
              ),
            ],
          ),
        ),
        // Reminders and notification settings live in the account.
        Glass(
          radius: 16,
          height: 46,
          semanticLabel: 'Notifications',
          onTap: () => context.go('/account?section=notifications'),
          child: const SizedBox(
            width: 46,
            child: Center(child: AtriaIcon('bell', size: 19, color: AtriaColors.ink800)),
          ),
        ),
      ],
    );
  }
}

class _SectionHead extends StatelessWidget {
  const _SectionHead({required this.title, this.link, this.onTap});
  final String title;
  final String? link;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: Text(title, style: AtriaType.display(size: 17, weight: FontWeight.w600).copyWith(letterSpacing: 0)),
        ),
        if (link != null)
          Pressable(
            onTap: onTap,
            radius: 8,
            ink: AtriaColors.blue600,
            builder: (context, _) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
              child: Text(
                link!,
                style: AtriaType.body(size: 12.5, weight: FontWeight.w600, color: AtriaColors.blue600),
              ),
            ),
          ),
      ],
    );
  }
}

/// The blue card (28:30): the next visit, or an invitation to book one.
class _NextAppointment extends StatelessWidget {
  const _NextAppointment({required this.data});
  final PatientData data;

  static const _longDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  Future<void> directions(Clinic? clinic) async {
    if (clinic == null) return;
    await launchUrl(clinic.directions, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final next = upcoming(data.appointments).firstOrNull;
    final clinician = next == null ? null : data.clinicianOf(next);
    final clinic = next == null ? null : data.clinicOf(next);
    final white = AtriaType.body(size: 12.5, weight: FontWeight.w600, color: Colors.white, height: 1.3);

    Widget body;
    if (next == null) {
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _Tag(icon: 'calendar', text: 'No visit booked'),
          const SizedBox(height: 11),
          Text(
            'Find a time that suits you.',
            style: AtriaType.display(size: 23, weight: FontWeight.w700, color: Colors.white),
          ),
          const SizedBox(height: 8),
          Text(
            'Choose a clinician, pick a day and hold a time. A text reminds you the day before.',
            style: AtriaType.body(size: 13, color: Colors.white.withValues(alpha: .9)),
          ),
          const SizedBox(height: 14),
          _CardButton(label: 'Find care', solid: true, onTap: () => context.go('/find-care')),
        ],
      );
    } else {
      final local = ClinicClock.local(next.startAt);
      final general = next.sessionId != null;
      final given = clinician == null ? null : 'Dr ${clinician.givenName ?? ''} ';
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Tag(icon: 'user', text: clinician?.specialty ?? (general ? 'General consultation' : 'Your visit')),
          const SizedBox(height: 11),
          Text.rich(
            TextSpan(
              children: clinician == null
                  ? [TextSpan(text: general ? 'Place ${next.position ?? ''} in the queue' : 'Your clinician')]
                  : [
                      TextSpan(text: given),
                      TextSpan(
                        text: clinician.familyName ?? '',
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontVariations: [FontVariation.weight(700)],
                        ),
                      ),
                    ],
            ),
            style: AtriaType.display(
              size: 23,
              weight: FontWeight.w600,
              color: Colors.white,
            ).copyWith(letterSpacing: -0.345),
          ),
          const SizedBox(height: 15),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: glassOnAccent(22),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const AtriaIcon('calendar', size: 15, color: Colors.white),
                          const SizedBox(width: 8),
                          Text(
                            '${_longDays[local.weekday - 1]}, ${ClinicClock.day(next.startAt).split(' ').skip(1).join(' ')}',
                            style: white,
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          const AtriaIcon('clock', size: 15, color: Colors.white),
                          const SizedBox(width: 8),
                          Text(
                            general
                                ? 'Arrive from ${ClinicClock.time(next.startAt)}'
                                : '${ClinicClock.time(next.startAt)} to ${ClinicClock.time(next.endAt)}',
                            style: white,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                Semantics(
                  button: true,
                  label: 'Directions to ${clinic?.name ?? 'the unit'}',
                  child: PressableSurface(
                    color: Colors.white,
                    radius: 16,
                    width: 44,
                    height: 44,
                    ink: AtriaColors.blue700,
                    onTap: () => directions(clinic),
                    child: const AtriaIcon('arrowUpRight', size: 18, color: AtriaColors.blue600),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _Fact(label: 'IN', value: until(next.startAt)),
              const SizedBox(width: 18),
              _Fact(label: 'REF', value: next.reference),
              const SizedBox(width: 18),
              _Fact(label: 'STATUS', value: stateLabel(next.state).$1),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _CardButton(label: 'Cancel', onTap: () => context.go('/visits/${next.id}?cancel=1')),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _CardButton(label: 'View details', solid: true, onTap: () => context.go('/visits/${next.id}')),
              ),
              const SizedBox(width: 10),
              Semantics(
                button: true,
                label: 'Add to calendar',
                child: PressableSurface(
                  color: Colors.white.withValues(alpha: .16),
                  border: Border.all(color: Colors.white.withValues(alpha: .7)),
                  radius: 16,
                  width: 46,
                  height: 46,
                  ink: Colors.white,
                  onTap: () => addToCalendar(context, next, data),
                  child: const AtriaIcon('calendar', size: 18, color: Colors.white),
                ),
              ),
            ],
          ),
        ],
      );
    }

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        gradient: cssGradient(
          151,
          const [AtriaColors.blue500, AtriaColors.blue600, Color(0xFF1E52C4)],
          [.144, .472, .856],
        ),
        borderRadius: BorderRadius.circular(30),
        boxShadow: const [BoxShadow(offset: Offset(0, 12), blurRadius: 30, color: Color(0x571E52C4))],
      ),
      child: Stack(
        children: [
          // The specular bloom in the top corner (28:31).
          Positioned(
            right: -40,
            top: -60,
            child: Container(
              width: 200,
              height: 200,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [Colors.white.withValues(alpha: .22), Colors.white.withValues(alpha: .04)],
                ),
              ),
            ),
          ),
          Padding(padding: const EdgeInsets.all(20), child: body),
        ],
      ),
    );
  }
}

/// A small fact on the blue card: its label over its value.
class _Fact extends StatelessWidget {
  const _Fact({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        label,
        style: AtriaType.body(size: 10, weight: FontWeight.w700, color: Colors.white.withValues(alpha: .75)),
      ),
      const SizedBox(height: 2),
      Text(
        value,
        style: AtriaType.body(size: 13, weight: FontWeight.w700, color: Colors.white),
      ),
    ],
  );
}

class _Tag extends StatelessWidget {
  const _Tag({required this.icon, required this.text});
  final String icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 5),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .18),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: Colors.white.withValues(alpha: .7)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          AtriaIcon(icon, size: 13, color: Colors.white),
          const SizedBox(width: 6),
          Text(
            text,
            style: AtriaType.body(size: 11.5, weight: FontWeight.w600, color: Colors.white, height: 1.25),
          ),
        ],
      ),
    );
  }
}

class _CardButton extends StatelessWidget {
  const _CardButton({required this.label, required this.onTap, this.solid = false});
  final String label;
  final VoidCallback onTap;
  final bool solid;

  @override
  Widget build(BuildContext context) {
    return PressableSurface(
      color: solid ? Colors.white : Colors.white.withValues(alpha: .16),
      border: Border.all(color: Colors.white.withValues(alpha: solid ? 1 : .7)),
      radius: 16,
      height: 46,
      ink: solid ? AtriaColors.blue700 : Colors.white,
      onTap: onTap,
      child: Text(
        label,
        style: AtriaType.body(size: 13.5, weight: FontWeight.w600, color: solid ? AtriaColors.blue800 : Colors.white),
      ),
    );
  }
}

/// The clinicians with an opening left today, soonest first, narrowed by
/// specialty; each opening is one Find care would offer (FR-DIR-02).
class AvailableToday extends StatefulWidget {
  const AvailableToday({super.key, required this.data, required this.api});
  final PatientData data;
  final Api api;

  @override
  State<AvailableToday> createState() => _AvailableTodayState();
}

class _AvailableTodayState extends State<AvailableToday> {
  final next = <String, DateTime?>{};
  String? specialty;

  @override
  void initState() {
    super.initState();
    final today = ClinicClock.isoDate(DateTime.now());
    for (final clinician in widget.data.bookable) {
      final type = specialistTypes(widget.data.types, clinician.clinicId).firstOrNull;
      if (type == null) continue;
      widget.api
          .get(
            '/clinicians/${Uri.encodeComponent(clinician.id)}/slots?date=$today&typeId=${Uri.encodeComponent(type.id)}',
          )
          .then((found) {
            final slots = (found['slots'] as List? ?? const []);
            final first = slots.isEmpty ? null : DateTime.parse((slots.first as Map)['startAt'] as String);
            if (mounted) setState(() => next[clinician.id] = first);
          })
          .catchError((Object _) {
            if (mounted) setState(() => next[clinician.id] = null);
          });
    }
  }

  List<String> get specialties {
    final counts = <String, int>{};
    for (final c in widget.data.bookable) {
      if (c.specialty != null) counts[c.specialty!] = (counts[c.specialty!] ?? 0) + 1;
    }
    return counts.keys.toList()..sort((a, b) => counts[b]!.compareTo(counts[a]!));
  }

  Future<void> more() async {
    final picked = await showModalBottomSheet<String>(
      useRootNavigator: true,
      context: context,
      showDragHandle: true,
      backgroundColor: AtriaColors.surfacePanel,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          children: [
            Text('Specialty', style: AtriaType.display(size: 18, weight: FontWeight.w600)),
            const SizedBox(height: 8),
            for (final s in ['', ...specialties])
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(
                  s.isEmpty ? 'All specialties' : s,
                  style: AtriaType.body(size: 14.5, color: AtriaColors.ink900),
                ),
                trailing: (s.isEmpty ? specialty == null : s == specialty)
                    ? const AtriaIcon('checkMark', color: AtriaColors.blue600)
                    : null,
                onTap: () => Navigator.pop(context, s),
              ),
          ],
        ),
      ),
    );
    if (picked != null) setState(() => specialty = picked.isEmpty ? null : picked);
  }

  @override
  Widget build(BuildContext context) {
    final bookable = widget.data.bookable;
    final waiting = bookable.any((c) => !next.containsKey(c.id));
    final open = bookable.where((c) => next[c.id] != null && (specialty == null || c.specialty == specialty)).toList()
      ..sort((a, b) => next[a.id]!.compareTo(next[b.id]!));
    final all = specialties;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // One row of whole chips, and a menu for the rest (the platform's convention).
        LayoutBuilder(
          builder: (context, box) {
            double width(String label, {bool icon = false}) {
              final painter = TextPainter(
                text: TextSpan(
                  text: label,
                  style: AtriaType.body(size: 13.5, weight: FontWeight.w600),
                ),
                textDirection: TextDirection.ltr,
              )..layout();
              return painter.width + 38 + (icon ? 21 : 0);
            }

            final order = [?specialty, ...all.where((s) => s != specialty)];
            final shown = <String>[];
            var used = width('All');
            for (var i = 0; i < order.length; i++) {
              final rest = order.length - i - 1;
              final more = rest > 0 ? 9 + width('$rest more', icon: true) : 0;
              final next = 9 + width(order[i]);
              if (used + next + more > box.maxWidth) break;
              shown.add(order[i]);
              used += next;
            }
            final hidden = all.length - shown.length;
            return Row(
              children: [
                _Chip(label: 'All', on: specialty == null, onTap: () => setState(() => specialty = null)),
                for (final s in shown) ...[
                  const SizedBox(width: 9),
                  _Chip(label: s, on: specialty == s, onTap: () => setState(() => specialty = s)),
                ],
                if (hidden > 0) ...[
                  const SizedBox(width: 9),
                  _Chip(label: '$hidden more', icon: 'filter', on: false, onTap: more),
                ],
              ],
            );
          },
        ),
        const SizedBox(height: 22),
        _SectionHead(
          title: 'Available today',
          link: waiting ? 'Checking' : '${open.length} open',
          onTap: () => context.go('/find-care'),
        ),
        const SizedBox(height: 12),
        if (!waiting && open.isEmpty)
          Text(
            'No openings left today. Find care shows the days ahead.',
            style: AtriaType.body(color: AtriaColors.inkMuted),
          )
        else
          for (var i = 0; i < open.length; i++) ...[
            if (i > 0) const SizedBox(height: 12),
            Rise(
              index: i,
              child: _Doctor(clinician: open[i], next: next[open[i].id]!, data: widget.data, index: i),
            ),
          ],
      ],
    );
  }
}

/// A specialty chip (28:62 selected, 28:64 not): 44 high; the selected one
/// takes the accent and a rounder corner.
class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.on, required this.onTap, this.icon});
  final String label;
  final bool on;
  final VoidCallback onTap;
  final String? icon;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(on ? 22 : 15);
    return Semantics(
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
          padding: const EdgeInsets.symmetric(horizontal: 18),
          decoration: BoxDecoration(
            gradient: on
                ? accentGradient()
                : cssGradient(
                    160,
                    [Colors.white.withValues(alpha: .9), Colors.white.withValues(alpha: .58)],
                    [.145, .855],
                  ),
            borderRadius: radius,
            border: Border.all(color: Colors.white),
            boxShadow: [
              on
                  ? const BoxShadow(offset: Offset(0, 6), blurRadius: 16, color: Color(0x572F6BE4))
                  : const BoxShadow(offset: Offset(0, 1), blurRadius: 6, color: Color(0x0F0F295E)),
            ],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[AtriaIcon(icon!, size: 15, color: AtriaColors.ink700), const SizedBox(width: 6)],
              Flexible(
                child: Text(
                  label,
                  overflow: TextOverflow.ellipsis,
                  style: AtriaType.body(
                    size: 13.5,
                    weight: FontWeight.w600,
                    color: on ? Colors.white : AtriaColors.ink700,
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

/// A clinician with an opening today (28:77).
class _Doctor extends StatelessWidget {
  const _Doctor({required this.clinician, required this.next, required this.data, required this.index});
  final Clinician clinician;
  final DateTime next;
  final PatientData data;
  final int index;

  static const _avatars = [
    [Color(0xFF5B8DF2), Color(0xFF2A62DC)],
    [Color(0xFF3FA9C9), Color(0xFF1E7FA8)],
    [Color(0xFF7C7BF0), Color(0xFF4B49CE)],
    [Color(0xFF4CA6EC), Color(0xFF1F6FC4)],
    [Color(0xFF6F9BF5), Color(0xFF3564D6)],
  ];

  @override
  Widget build(BuildContext context) {
    final clinic = data.clinics.where((c) => c.id == clinician.clinicId).firstOrNull;
    return Glass(
      radius: 24,
      padding: const EdgeInsets.all(13),
      semanticLabel: '${clinician.name}, next opening ${ClinicClock.time(next)}',
      onTap: () => context.go('/find-care?clinician=${clinician.id}'),
      child: Row(
        children: [
          Container(
            width: 54,
            height: 54,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              gradient: cssGradient(145, _avatars[index % _avatars.length], [.141, .859]),
              borderRadius: BorderRadius.circular(18),
            ),
            child: Text(
              initials(clinician.givenName, clinician.familyName),
              style: AtriaType.display(size: 16, weight: FontWeight.w600, color: Colors.white),
            ),
          ),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  clinician.name,
                  overflow: TextOverflow.ellipsis,
                  style: AtriaType.display(size: 15, weight: FontWeight.w600).copyWith(letterSpacing: 0, height: 1.3),
                ),
                const SizedBox(height: 2),
                Text(
                  [clinician.specialty, clinic?.name].whereType<String>().join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AtriaType.body(size: 12, color: AtriaColors.inkSoft, height: 1.3),
                ),
                const SizedBox(height: 7),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                  decoration: BoxDecoration(
                    color: AtriaColors.confirmed.withValues(alpha: .14),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const AtriaIcon('clock', size: 11, color: AtriaColors.confirmedInk),
                      const SizedBox(width: 5),
                      Text(
                        'Next ${ClinicClock.time(next)}',
                        style: AtriaType.body(
                          size: 11,
                          weight: FontWeight.w600,
                          color: AtriaColors.confirmedInk,
                          height: 1.2,
                        ),
                      ),
                    ],
                  ),
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

/// Book a visit, book again, my visits, reminders (the web's quick actions).
class _QuickActions extends StatelessWidget {
  const _QuickActions({required this.data});
  final PatientData data;

  @override
  Widget build(BuildContext context) {
    final behind = past(data.appointments);
    final next = upcoming(data.appointments).firstOrNull;
    // Book again suggests the clinician last seen, or else the one booked
    // next; never one whose visit was cancelled.
    final seen = behind.where((a) => !a.state.endsWith('CANCELLED')).firstOrNull ?? next;
    final again = seen == null ? null : data.clinicianOf(seen);
    final tiles = [
      _Quick(
        icon: 'plus',
        tone: const [Color(0xFF5B8DF2), Color(0xFF2A62DC)],
        title: 'Book a visit',
        sub: 'Find an opening',
        onTap: () => context.go('/find-care'),
      ),
      _Quick(
        icon: 'repeat',
        tone: const [Color(0xFF2EB88A), Color(0xFF0E7A53)],
        title: 'Book again',
        sub: again == null ? 'After your first visit' : '${again.name}, ${again.specialty ?? ''}',
        onTap: () => context.go(again == null ? '/find-care' : '/find-care?clinician=${again.id}'),
      ),
      _Quick(
        icon: 'clipboard',
        tone: const [Color(0xFF8B7BF0), Color(0xFF5B49CE)],
        title: 'My visits',
        sub: behind.length == 1 ? '1 past visit' : '${behind.length} past visits',
        onTap: () => context.go('/visits?show=past'),
      ),
      _Quick(
        icon: 'bell',
        tone: const [Color(0xFFF2B24C), Color(0xFFD1850F)],
        title: 'Reminders',
        sub: '24h before, SMS and email',
        onTap: () => context.go('/account?section=notifications'),
      ),
    ];
    return Column(
      children: [
        for (var row = 0; row < 2; row++) ...[
          if (row > 0) const SizedBox(height: 12),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: tiles[row * 2]),
                const SizedBox(width: 12),
                Expanded(child: tiles[row * 2 + 1]),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _Quick extends StatelessWidget {
  const _Quick({required this.icon, required this.tone, required this.title, required this.sub, required this.onTap});
  final String icon;
  final List<Color> tone;
  final String title;
  final String sub;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Glass(
    radius: 24,
    padding: const EdgeInsets.all(14),
    semanticLabel: '$title, $sub',
    onTap: onTap,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 42,
          height: 42,
          decoration: BoxDecoration(
            gradient: cssGradient(145, tone),
            borderRadius: BorderRadius.circular(15),
            boxShadow: [BoxShadow(offset: const Offset(0, 6), blurRadius: 14, color: tone.last.withValues(alpha: .3))],
          ),
          child: Center(child: AtriaIcon(icon, size: 19, color: Colors.white)),
        ),
        const SizedBox(height: 12),
        Text(title, style: AtriaType.display(size: 15, weight: FontWeight.w600)),
        const SizedBox(height: 2),
        Text(
          sub,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: AtriaType.body(size: 12, color: AtriaColors.inkSoft, height: 1.3),
        ),
      ],
    ),
  );
}

/// The next three visits, each opening its page (the web's "Upcoming visits").
class _Upcoming extends StatelessWidget {
  const _Upcoming({required this.data});
  final PatientData data;

  @override
  Widget build(BuildContext context) {
    final ahead = upcoming(data.appointments).take(3).toList();
    return Glass(
      radius: 28,
      padding: const EdgeInsets.fromLTRB(16, 12, 12, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHead(title: 'Upcoming visits', link: 'See all', onLink: () => context.go('/visits')),
          const SizedBox(height: 6),
          if (ahead.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                'Nothing booked yet. Your visits will be listed here.',
                style: AtriaType.body(size: 13, color: AtriaColors.inkMuted),
              ),
            )
          else
            for (var i = 0; i < ahead.length; i++) ...[
              if (i > 0) const Divider(height: 1, color: AtriaColors.lineHairline),
              HomeVisitRow(appointment: ahead[i], data: data),
            ],
        ],
      ),
    );
  }
}

/// A visit as a row: the date tile, who and where, its state, and Manage.
class HomeVisitRow extends StatelessWidget {
  const HomeVisitRow({super.key, required this.appointment, required this.data});
  final Appointment appointment;
  final PatientData data;

  @override
  Widget build(BuildContext context) {
    final clinician = data.clinicianOf(appointment);
    final clinic = data.clinicOf(appointment);
    final (label, tone) = stateLabel(appointment.state);
    final general = appointment.sessionId != null;
    return Pressable(
      onTap: () => context.go('/visits/${appointment.id}'),
      radius: 16,
      semanticLabel: 'Manage the visit on ${ClinicClock.long(appointment.startAt)}',
      builder: (context, _) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 2),
        child: Row(
          children: [
            Container(
              width: 50,
              height: 54,
              decoration: BoxDecoration(color: AtriaColors.blue100, borderRadius: BorderRadius.circular(16)),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    ClinicClock.month(appointment.startAt),
                    style: AtriaType.body(size: 10.5, weight: FontWeight.w700, color: AtriaColors.blue600),
                  ),
                  Text(
                    ClinicClock.date(appointment.startAt),
                    style: AtriaType.display(size: 19, color: AtriaColors.blue800).copyWith(height: 1.1),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    clinician?.name ?? (general ? 'Outpatient queue' : 'Your visit'),
                    overflow: TextOverflow.ellipsis,
                    style: AtriaType.display(size: 14.5, weight: FontWeight.w600),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    [
                      clinician?.specialty,
                      clinic?.name,
                      '${ClinicClock.time(appointment.startAt)} to ${ClinicClock.time(appointment.endAt)}',
                    ].whereType<String>().join(' · '),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: AtriaType.body(size: 12, color: AtriaColors.inkSoft, height: 1.3),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
              decoration: BoxDecoration(
                color: toneColour(tone).withValues(alpha: .12),
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                label,
                style: AtriaType.body(size: 11, weight: FontWeight.w700, color: toneColour(tone)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Recent activity: the reminder due before the next visit, then the latest
/// bookings and cancellations (the web's panel, built from the same data).
class _Activity extends StatelessWidget {
  const _Activity({required this.data});
  final PatientData data;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final next = upcoming(data.appointments, now).firstOrNull;
    final reminder = next?.startAt.subtract(const Duration(days: 1));
    final items = <({String icon, List<Color> tone, String title, String body, String foot})>[];
    if (reminder != null && reminder.isAfter(now)) {
      items.add((
        icon: 'bell',
        tone: const [Color(0xFFF2B24C), Color(0xFFD1850F)],
        title: 'Reminder scheduled',
        body: 'SMS and email ${ClinicClock.day(reminder)} at ${ClinicClock.time(reminder)}',
        foot: '24 hours before your visit',
      ));
    }
    final recent = [...data.appointments]..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    for (final a in recent) {
      if (items.length >= 3) break;
      final cancelled = a.state.endsWith('CANCELLED');
      items.add((
        icon: cancelled ? 'calendar' : 'mail',
        tone: cancelled ? const [Color(0xFFF07A7A), Color(0xFFC93C3C)] : const [Color(0xFF5B8DF2), Color(0xFF2A62DC)],
        title: cancelled ? 'Visit cancelled' : 'Visit booked',
        body: '${a.reference} for ${ClinicClock.day(a.startAt)} at ${ClinicClock.time(a.startAt)}',
        foot: 'Booked ${ClinicClock.day(a.createdAt)}, ${ClinicClock.time(a.createdAt)}',
      ));
    }
    return Glass(
      radius: 28,
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SectionHead(title: 'Recent activity'),
          const SizedBox(height: 10),
          if (items.isEmpty)
            Text(
              'Bookings, cancellations and reminders will show here.',
              style: AtriaType.body(size: 13, color: AtriaColors.inkMuted),
            )
          else
            for (var i = 0; i < items.length; i++) ...[
              if (i > 0) const SizedBox(height: 14),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      gradient: cssGradient(145, items[i].tone),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Center(child: AtriaIcon(items[i].icon, size: 16, color: Colors.white)),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(items[i].title, style: AtriaType.body(size: 13.5, weight: FontWeight.w700)),
                        const SizedBox(height: 2),
                        Text(items[i].body, style: AtriaType.body(size: 12.5, color: AtriaColors.ink700)),
                        const SizedBox(height: 2),
                        Text(items[i].foot, style: AtriaType.body(size: 11.5, color: AtriaColors.inkMuted)),
                      ],
                    ),
                  ),
                ],
              ),
            ],
        ],
      ),
    );
  }
}

/// Where the next visit is: its unit, hours today, and directions (the web's
/// clinic card; the map is a drawing, not a live map).
class _UnitCard extends StatelessWidget {
  const _UnitCard({required this.data});
  final PatientData data;

  @override
  Widget build(BuildContext context) {
    final next = upcoming(data.appointments).firstOrNull;
    final clinic = (next == null ? null : data.clinicOf(next)) ?? data.clinics.firstOrNull;
    if (clinic == null) return const SizedBox.shrink();
    final today = clinic.hoursOn();
    return Glass(
      radius: 28,
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(18),
            child: const SizedBox(height: 86, child: CustomPaint(painter: _MapDrawing())),
          ),
          const SizedBox(height: 12),
          Text(clinic.name, style: AtriaType.display(size: 16, weight: FontWeight.w600)),
          const SizedBox(height: 3),
          Text(
            [
              if (clinic.whereInside.isNotEmpty) clinic.whereInside,
              today == null ? 'closed today' : 'open ${today.start} to ${today.end} today',
            ].join(' · '),
            style: AtriaType.body(size: 12.5, color: AtriaColors.inkSoft),
          ),
          const SizedBox(height: 12),
          SecondaryButton(
            label: 'Get directions',
            leading: const AtriaIcon('pin', size: 16, color: AtriaColors.blue600),
            onPressed: () => launchUrl(clinic.directions, mode: LaunchMode.externalApplication),
          ),
        ],
      ),
    );
  }
}

/// Roads and a route drawn to a pin, in the Rev A blues.
class _MapDrawing extends CustomPainter {
  const _MapDrawing();

  @override
  void paint(Canvas canvas, Size size) {
    final sx = size.width / 312;
    final sy = size.height / 86;
    Offset p(double x, double y) => Offset(x * sx, y * sy);
    canvas.drawRect(Offset.zero & size, Paint()..color = const Color(0xFFE6EEFD));
    final road = Paint()
      ..color = Colors.white
      ..strokeWidth = 10
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;
    canvas.drawPath(
      Path()
        ..moveTo(p(-10, 56).dx, p(-10, 56).dy)
        ..lineTo(p(120, 56).dx, p(120, 56).dy)
        ..lineTo(p(160, 26).dx, p(160, 26).dy)
        ..lineTo(p(330, 26).dx, p(330, 26).dy),
      road,
    );
    canvas.drawLine(p(60, -5), p(60, 100), road..strokeWidth = 6);
    canvas.drawLine(p(210, -5), p(240, 100), road);
    final route = Paint()
      ..color = AtriaColors.blue600
      ..strokeWidth = 3.5
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;
    canvas.drawPath(
      Path()
        ..moveTo(p(40, 74).dx, p(40, 74).dy)
        ..lineTo(p(60, 56).dx, p(60, 56).dy)
        ..lineTo(p(120, 56).dx, p(120, 56).dy)
        ..lineTo(p(160, 26).dx, p(160, 26).dy)
        ..lineTo(p(232, 26).dx, p(232, 26).dy),
      route,
    );
    canvas.drawCircle(p(232, 26), 8, Paint()..color = AtriaColors.blue600);
    canvas.drawCircle(p(232, 26), 3.5, Paint()..color = Colors.white);
  }

  @override
  bool shouldRepaint(_MapDrawing old) => false;
}
