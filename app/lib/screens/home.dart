import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api.dart';
import '../patient/data.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/glass.dart';
import '../ui/icons.dart';
import '../ui/widgets.dart';
import '../ui/expressive.dart';
import 'queue.dart';
import '../ui/loading.dart';

/// "Mobile · Home" (Figma 28:2): the greeting, search, the next appointment,
/// and who has an opening left today (FR-VIS-01, FR-DIR-02).
///
/// Where the frame shows something Atria does not have, the space holds the
/// nearest true thing: "5 nearby" counts the openings today, and the arrow on
/// the next appointment opens directions to its unit.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key, required this.me, required this.store});
  final Me me;
  final PatientStore store;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        final state = store.state;
        return RefreshIndicator(
          onRefresh: store.reload,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 26, 20, 132),
            children: [
              Rise(child: _TopBar(me: me)),
              const SizedBox(height: 22),
              Rise(index: 1, child: _SearchBar(onTap: () => context.go('/find-care'))),
              const SizedBox(height: 12),
              const Rise(index: 1, child: QueueEntry()),
              const SizedBox(height: 22),
              if (state is DataFailed)
                Notice(state.message, tone: NoticeTone.error)
              else if (state is DataReady) ...[
                Rise(
                  index: 2,
                  child: _SectionHead(title: 'Next appointment', link: 'See all', onTap: () => context.go('/visits')),
                ),
                const SizedBox(height: 12),
                Rise(index: 3, child: _NextAppointment(data: state.data)),
                const SizedBox(height: 22),
                Rise(
                  index: 4,
                  child: AvailableToday(data: state.data, api: store.api),
                ),
              ] else
                // Loading: the M3 indicator centred where the content will be.
                const LoadingPane(label: 'Loading your visits'),
            ],
          ),
        );
      },
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.me});
  final Me me;

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

class _SearchBar extends StatelessWidget {
  const _SearchBar({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Glass(
      radius: 20,
      height: 56,
      padding: const EdgeInsets.only(left: 16, right: 8),
      semanticLabel: 'Search clinicians or specialties',
      onTap: onTap,
      child: Row(
        children: [
          const AtriaIcon('search', size: 19, color: AtriaColors.blue600),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Search clinicians or specialties',
              style: AtriaType.body(size: 14.5, color: const Color(0xFF8497B8)),
            ),
          ),
          Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AtriaColors.blue600,
              borderRadius: BorderRadius.circular(14),
              boxShadow: const [BoxShadow(offset: Offset(0, 4), blurRadius: 12, color: Color(0x572F6BE4))],
            ),
            child: const AtriaIcon('sliders', size: 18, color: Colors.white),
          ),
        ],
      ),
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
