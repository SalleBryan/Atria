import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../auth/session.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/expressive.dart';
import '../ui/glass.dart';
import '../ui/icons.dart';
import '../ui/layout.dart';
import '../ui/sheets.dart';
import '../ui/widgets.dart';
import 'data.dart';

/// One place in the staff console.
class StaffPlace {
  const StaffPlace(this.path, this.label, this.icon, this.matches);
  final String path;
  final String label;
  final String icon;
  final bool Function(String location) matches;
}

/// The console's places for a role, as the web's StaffShell decides them.
List<StaffPlace> staffPlaces(StaffStore store) {
  final role = store.role;
  bool under(String p, String l) => l == p || l.startsWith('$p/') || l.startsWith('$p?');
  return [
    StaffPlace(
      '/console',
      'Schedule',
      'calendar',
      (l) => l == '/console' || l.startsWith('/console?') || under('/console/week', l) || under('/console/visits', l),
    ),
    StaffPlace(
      '/console/patients',
      'Patients',
      'users',
      (l) => under('/console/patients', l) || under('/console/book', l),
    ),
    if (store.runsQueue) StaffPlace('/console/queue', 'Queue', 'listOrdered', (l) => under('/console/queue', l)),
    if (store.takesRequests) StaffPlace('/console/requests', 'Requests', 'inbox', (l) => under('/console/requests', l)),
    if (role == StaffRole.receptionist || role == StaffRole.manager)
      StaffPlace('/console/roster', 'Roster', 'stethoscope', (l) => under('/console/roster', l)),
    StaffPlace('/console/availability', 'Availability', 'clock', (l) => under('/console/availability', l)),
    if (role != StaffRole.clinician)
      StaffPlace('/console/messages', 'Messages', 'mail', (l) => under('/console/messages', l)),
    if (role == StaffRole.manager) ...[
      StaffPlace('/console/reports', 'Reports', 'chart', (l) => under('/console/reports', l)),
      StaffPlace('/console/audit', 'Audit log', 'shield', (l) => under('/console/audit', l)),
    ],
  ];
}

/// The staff console's frame: the Rev A glass bar on a phone (four places
/// and More), the glass rail on a tablet, as the patient app has them.
class StaffShell extends StatelessWidget {
  const StaffShell({
    super.key,
    required this.child,
    required this.store,
    required this.session,
    required this.location,
  });
  final Widget child;
  final StaffStore store;
  final Session session;
  final String location;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: store,
    builder: (context, _) {
      final places = staffPlaces(store);
      final selected = places.indexWhere((p) => p.matches(location));
      if (context.isTablet) {
        return Scaffold(
          body: PageBackground(
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 18, 0, 18),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _Rail(places: places, selected: selected, store: store, session: session),
                    Expanded(
                      child: FadeThrough(id: selected, child: child),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      }
      const bar = 4;
      final fits = places.length <= bar;
      final shown = fits ? places : places.take(bar - 1).toList();
      final hiddenOn = !fits && selected >= bar - 1;
      if (hiddenOn) shown[bar - 2] = places[selected];
      final rest = places.where((p) => !shown.contains(p)).toList();
      return Scaffold(
        extendBody: true,
        body: PageBackground(
          child: SafeArea(
            bottom: false,
            child: FadeThrough(id: selected, child: child),
          ),
        ),
        bottomNavigationBar: SafeArea(
          minimum: const EdgeInsets.fromLTRB(20, 0, 20, 22),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(26),
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
              child: Container(
                constraints: const BoxConstraints(minHeight: 70),
                padding: const EdgeInsets.symmetric(horizontal: 8),
                decoration: BoxDecoration(
                  gradient: cssGradient(
                    170,
                    [Colors.white.withValues(alpha: .86), Colors.white.withValues(alpha: .6)],
                    [.145, .855],
                  ),
                  borderRadius: BorderRadius.circular(26),
                  border: Border.all(color: Colors.white),
                ),
                child: Row(
                  children: [
                    for (final p in shown)
                      Expanded(
                        child: _Item(
                          label: p.label,
                          icon: p.icon,
                          on: places.indexOf(p) == selected,
                          onTap: () => context.go(p.path),
                        ),
                      ),
                    Expanded(
                      child: _Item(
                        label: fits ? 'Sign out' : 'More',
                        icon: fits ? 'signOut' : 'sliders',
                        on: false,
                        onTap: () => fits ? _signOut(context, session) : _more(context, rest, session, store),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    },
  );
}

Future<void> _signOut(BuildContext context, Session session) async {
  await session.signOut();
}

Future<void> _more(BuildContext context, List<StaffPlace> rest, Session session, StaffStore store) => showGlassSheet(
  context,
  title: '${store.me.name} · ${roleLabel[store.role]}',
  children: [
    for (final p in rest)
      SheetChoice(
        icon: p.icon,
        title: p.label,
        sub: _subs[p.path] ?? '',
        onTap: () {
          Navigator.pop(context);
          context.go(p.path);
        },
      ),
    SheetChoice(
      icon: 'signOut',
      title: 'Sign out',
      sub: 'Leave the console on this device',
      onTap: () {
        Navigator.pop(context);
        _signOut(context, session);
      },
    ),
  ],
);

class _Item extends StatelessWidget {
  const _Item({required this.label, required this.icon, required this.on, required this.onTap});
  final String label;
  final String icon;
  final bool on;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ink = on ? AtriaColors.blue800 : const Color(0xFF7C8CAB);
    return Semantics(
      selected: on,
      child: Pressable(
        onTap: onTap,
        radius: 18,
        scale: .92,
        ink: AtriaColors.blue700,
        semanticLabel: label,
        builder: (context, pressed) => ExcludeSemantics(
          child: Padding(
            padding: const EdgeInsets.only(top: 8, bottom: 6),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                AnimatedContainer(
                  duration: AtriaMotion.spatialDefaultDuration,
                  curve: AtriaMotion.spatialDefault,
                  width: 44,
                  height: 32,
                  decoration: BoxDecoration(
                    gradient: on ? accentGradient(149) : null,
                    borderRadius: BorderRadius.circular(12),
                    // Always one shadow, faded rather than removed: the spring's
                    // overshoot would otherwise ask for a negative blur.
                    boxShadow: [
                      BoxShadow(
                        offset: const Offset(0, 4),
                        blurRadius: 12,
                        color: on ? const Color(0x5C2F6BE4) : const Color(0x002F6BE4),
                      ),
                    ],
                  ),
                  child: Center(child: AtriaIcon(icon, size: 19, color: on ? Colors.white : ink)),
                ),
                const SizedBox(height: 4),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AtriaType.body(size: 10.5, weight: FontWeight.w600, color: ink, height: 1.2),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The tablet rail: the brand, every place with its name, and the person.
class _Rail extends StatelessWidget {
  const _Rail({required this.places, required this.selected, required this.store, required this.session});
  final List<StaffPlace> places;
  final int selected;
  final StaffStore store;
  final Session session;

  @override
  Widget build(BuildContext context) => Glass(
    radius: 28,
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 18),
    child: SizedBox(
      width: 84,
      child: Column(
        children: [
          const BrandMark(size: 48),
          const SizedBox(height: 24),
          Expanded(
            child: ListView(
              children: [
                for (var i = 0; i < places.length; i++)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Semantics(
                      selected: i == selected,
                      child: Pressable(
                        onTap: () => context.go(places[i].path),
                        radius: 16,
                        ink: AtriaColors.blue700,
                        semanticLabel: places[i].label,
                        builder: (context, _) => ExcludeSemantics(
                          child: Column(
                            children: [
                              AnimatedContainer(
                                duration: AtriaMotion.spatialDefaultDuration,
                                curve: AtriaMotion.spatialDefault,
                                width: 52,
                                height: 40,
                                decoration: BoxDecoration(
                                  gradient: i == selected ? accentGradient(149) : null,
                                  borderRadius: BorderRadius.circular(15),
                                ),
                                child: Center(
                                  child: AtriaIcon(
                                    places[i].icon,
                                    size: 19,
                                    color: i == selected ? Colors.white : const Color(0xFF6B7FA6),
                                  ),
                                ),
                              ),
                              const SizedBox(height: 3),
                              Text(
                                places[i].label,
                                textAlign: TextAlign.center,
                                style: AtriaType.body(
                                  size: 10.5,
                                  weight: FontWeight.w600,
                                  color: i == selected ? AtriaColors.blue800 : const Color(0xFF6B7FA6),
                                  height: 1.2,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          Pressable(
            onTap: () => _signOut(context, session),
            radius: 16,
            semanticLabel: 'Sign out',
            builder: (context, _) => Column(
              children: [
                Container(
                  width: 46,
                  height: 46,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(gradient: accentGradient(149), borderRadius: BorderRadius.circular(16)),
                  child: Text(
                    store.me.name.split(' ').where((s) => s.isNotEmpty).map((s) => s[0]).take(2).join(),
                    style: AtriaType.display(size: 15, weight: FontWeight.w600, color: Colors.white),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Sign out',
                  style: AtriaType.body(size: 10.5, weight: FontWeight.w600, color: AtriaColors.inkSoft),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

const _subs = {
  '/console/queue': "Today's outpatient queue",
  '/console/requests': 'Procedure requests to size and place',
  '/console/roster': "Who works in the unit, and when",
  '/console/availability': 'Weekly hours and time off',
  '/console/messages': 'Reminders and notices sent, failures first',
  '/console/reports': "The unit's figures",
  '/console/audit': 'Who opened and changed what',
};
