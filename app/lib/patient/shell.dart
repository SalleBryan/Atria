import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/expressive.dart';
import '../ui/glass.dart';
import '../ui/icons.dart';
import '../ui/widgets.dart';
import 'data.dart';

/// The patient app's frame: the screen on the blue field, and the floating
/// glass navigation bar (Mobile · Home, 28:162) with an M3 badge counting the
/// visits ahead. The frame's placeholder labels are Atria's four places.
class PatientShell extends StatelessWidget {
  const PatientShell({super.key, required this.child, required this.store, required this.location});
  final Widget child;
  final PatientStore store;
  final String location;

  static const destinations = [
    ('/home', 'Home', 'home'),
    ('/find-care', 'Find care', 'search'),
    ('/visits', 'My visits', 'calendar'),
    ('/account', 'Account', 'user'),
  ];

  @override
  Widget build(BuildContext context) {
    final selected = destinations.indexWhere((d) => location.startsWith(d.$1));
    return Scaffold(
      extendBody: true,
      body: PageBackground(
        child: SafeArea(
          bottom: false,
          // Changing tab fades through, as Material swaps top-level screens.
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
              // 70 in the frame; taller when the system text is larger.
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
              child: ListenableBuilder(
                listenable: store,
                builder: (context, _) {
                  final state = store.state;
                  final ahead = state is DataReady ? upcoming(state.data.appointments).length : 0;
                  return LayoutBuilder(
                    builder: (context, box) {
                      final slot = box.maxWidth / destinations.length;
                      return Stack(
                        children: [
                          // The pill slides to the chosen place on the fast spatial spring.
                          if (selected >= 0)
                            AnimatedPositioned(
                              duration: AtriaMotion.spatialDefaultDuration,
                              curve: AtriaMotion.spatialDefault,
                              left: slot * selected + (slot - 44) / 2,
                              top: 8,
                              child: Container(
                                width: 44,
                                height: 32,
                                decoration: BoxDecoration(
                                  gradient: accentGradient(149),
                                  borderRadius: BorderRadius.circular(12),
                                  boxShadow: const [
                                    BoxShadow(offset: Offset(0, 4), blurRadius: 12, color: Color(0x5C2F6BE4)),
                                  ],
                                ),
                              ),
                            ),
                          Row(
                            children: [
                              for (var i = 0; i < destinations.length; i++)
                                Expanded(
                                  child: _Item(
                                    label: destinations[i].$2,
                                    icon: destinations[i].$3,
                                    on: i == selected,
                                    badge: destinations[i].$1 == '/visits' ? ahead : 0,
                                    onTap: () => context.go(destinations[i].$1),
                                  ),
                                ),
                            ],
                          ),
                        ],
                      );
                    },
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Item extends StatelessWidget {
  const _Item({required this.label, required this.icon, required this.on, required this.badge, required this.onTap});
  final String label;
  final String icon;
  final bool on;
  final int badge;
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
        semanticLabel: badge > 0 ? '$label, $badge upcoming' : label,
        builder: (context, pressed) => ExcludeSemantics(
          child: Padding(
            padding: const EdgeInsets.only(top: 8, bottom: 6),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Badge(
                  isLabelVisible: badge > 0,
                  label: Pop(value: badge, child: Text('$badge')),
                  offset: const Offset(4, -4),
                  child: SizedBox(
                    width: 44,
                    height: 32,
                    child: Center(
                      child: AnimatedScale(
                        scale: on ? 1.08 : 1,
                        duration: AtriaMotion.spatialFastDuration,
                        curve: AtriaMotion.spatialFast,
                        child: AtriaIcon(icon, size: 19, color: on ? Colors.white : const Color(0xFF7C8CAB)),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 4),
                AnimatedDefaultTextStyle(
                  duration: AtriaMotion.effectsDefaultDuration,
                  style: AtriaType.body(size: 10.5, weight: FontWeight.w600, color: ink, height: 1.2),
                  child: Text(label),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
