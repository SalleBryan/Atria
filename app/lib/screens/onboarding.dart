import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../ds/kit.dart';
import '../ds/motion.dart';
import '../ds/page.dart';
import '../ds/palette.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/expressive.dart';
import '../ui/icons.dart';

/// What Atria is and how to use it (2026-09-30 redesign), in the landing
/// page's words, on its deep blue field. One shape carries the whole tour: it
/// morphs on a spring from step to step (cookie, clover, flower, round) and
/// holds each step's scene, the way the landing page's shapes do.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key, this.onSeen});

  /// Called once the person leaves for sign-up or sign-in, so the app opens
  /// on sign-in from then on.
  final VoidCallback? onSeen;

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _Step {
  const _Step(this.kicker, this.title, this.body);
  final String kicker;
  final String title;
  final String body;
}

const _steps = [
  _Step(
    'Welcome to Atria',
    'Care that keeps time with you.',
    "Find a clinician, join today's queue or book ahead, and let Atria carry the calendar from there.",
  ),
  _Step(
    'What Atria is',
    'Three ways to be seen.',
    'One calendar for every unit of the hospital, so the time you see is the time you get.',
  ),
  _Step(
    'Find care',
    'Search as you would say it.',
    'A name, a specialty, a unit. Filter by the language a clinician consults in, and see who has an opening today.',
  ),
  _Step(
    'Book, or join the queue',
    'A time that is yours, or a place today.',
    'A time is held once you confirm it. In the queue you get a window to arrive in, and a text if it moves.',
  ),
  _Step(
    'Be reminded',
    'A text and an email, the day before.',
    'Move or cancel from the app if your plans change, and the time goes to someone else.',
  ),
  _Step(
    'Your data',
    'Who sees what, in plain words.',
    'What you write before a visit is read only by you and your clinician. Your account is yours to delete.',
  ),
];

/// The shape each step settles into: (lobes, depth).
const _shapes = [(9, .05), (4, .12), (6, .09), (12, .035), (5, .1), (0, 0.0)];

class _OnboardingScreenState extends State<OnboardingScreen> {
  int step = 0;

  void leave(String to) {
    widget.onSeen?.call();
    context.go(to);
  }

  void go(int to) {
    if (to < 0 || to >= _steps.length || to == step) return;
    setState(() => step = to);
  }

  @override
  Widget build(BuildContext context) {
    final last = step == _steps.length - 1;
    final s = _steps[step];
    final size = MediaQuery.sizeOf(context);
    final stage = (size.height * .36).clamp(220.0, 360.0);
    return Scaffold(
      backgroundColor: P.navy,
      body: GestureDetector(
        behavior: HitTestBehavior.translucent,
        onHorizontalDragEnd: (d) {
          final v = d.primaryVelocity ?? 0;
          if (v < -250) go(step + 1);
          if (v > 250) go(step - 1);
        },
        child: Stack(
          children: [
            const Positioned.fill(child: HeroField(deep: true)),
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 12, 24, 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const _Brand(),
                        const Spacer(),
                        AnimatedOpacity(
                          opacity: last ? 0 : 1,
                          duration: AtriaMotion.effectsDefaultDuration,
                          child: IgnorePointer(
                            ignoring: last,
                            child: Btn(
                              'Skip',
                              kind: BtnKind.glass,
                              compact: true,
                              expand: false,
                              onPressed: () => go(_steps.length - 1),
                            ),
                          ),
                        ),
                      ],
                    ),
                    Expanded(
                      child: Center(
                        child: SizedBox(
                          width: stage,
                          height: stage,
                          child: _Stage(step: step, size: stage),
                        ),
                      ),
                    ),
                    Eyebrow(s.kicker, onDark: true),
                    const SizedBox(height: 12),
                    SizedBox(
                      height: 84,
                      child: Align(
                        alignment: Alignment.topLeft,
                        child: WordRise(s.title, key: ValueKey(step), style: T.hero(size: 32)),
                      ),
                    ),
                    SizedBox(
                      height: 66,
                      child: AnimatedSwitcher(
                        duration: AtriaMotion.effectsSlowDuration,
                        child: Text(
                          s.body,
                          key: ValueKey(step),
                          style: T.body(color: const Color(0xD9FFFFFF), size: 15),
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),
                    _Dots(count: _steps.length, at: step, onTap: go),
                    const SizedBox(height: 18),
                    if (last) ...[
                      Btn('Create an account', kind: BtnKind.light, onPressed: () => leave('/create-account')),
                      const SizedBox(height: 10),
                      Btn('I already have an account', kind: BtnKind.glass, onPressed: () => leave('/sign-in')),
                    ] else ...[
                      Btn('Next', kind: BtnKind.light, icon: null, onPressed: () => go(step + 1)),
                      const SizedBox(height: 10),
                      Btn('I already have an account', kind: BtnKind.clear, onPressed: () => leave('/sign-in')),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Brand extends StatelessWidget {
  const _Brand();

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Container(
        width: 38,
        height: 38,
        decoration: BoxDecoration(color: P.white, borderRadius: BorderRadius.circular(13)),
        child: const Center(child: AtriaIcon('pulse', size: 20, color: P.blue700)),
      ),
      const SizedBox(width: 10),
      Text('Atria', style: T.heading(color: P.white, size: 20)),
    ],
  );
}

/// The page marker: the current step stretches into a pill.
class _Dots extends StatelessWidget {
  const _Dots({required this.count, required this.at, required this.onTap});
  final int count;
  final int at;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'Step ${at + 1} of $count',
    child: Row(
      children: [
        for (var i = 0; i < count; i++)
          GestureDetector(
            onTap: () => onTap(i),
            child: AnimatedContainer(
              duration: AtriaMotion.spatialDefaultDuration,
              curve: AtriaMotion.spatialDefault,
              margin: const EdgeInsets.only(right: 6),
              width: i == at ? 28 : 8,
              height: 8,
              decoration: BoxDecoration(
                color: i == at ? P.white : const Color(0x55FFFFFF),
                borderRadius: BorderRadius.circular(4),
              ),
            ),
          ),
      ],
    ),
  );
}

/// The shape and the scene inside it.
class _Stage extends StatelessWidget {
  const _Stage({required this.step, required this.size});
  final int step;
  final double size;

  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
    tween: Tween(end: step.toDouble()),
    duration: AtriaMotion.spatialSlowDuration,
    curve: AtriaMotion.spatialDefault,
    builder: (context, at, _) => Turning(
      builder: (context, turn) => Stack(
        clipBehavior: Clip.none,
        children: [
          // A halo, then the shape: the photo on the first step, glass after.
          Positioned.fill(
            child: Transform.scale(
              scale: 1.14,
              child: ClipPath(
                clipper: BlobClipper(at, _shapes, -turn * .6),
                child: const ColoredBox(color: Color(0x14FFFFFF)),
              ),
            ),
          ),
          Positioned.fill(
            child: ClipPath(
              clipper: BlobClipper(at, _shapes, turn),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  const ColoredBox(color: Color(0x1FFFFFFF)),
                  Opacity(
                    opacity: (1 - at).clamp(0.0, 1.0),
                    child: Image.asset(
                      'assets/photos/doctor-coat.webp',
                      fit: BoxFit.cover,
                      alignment: Alignment.topCenter,
                    ),
                  ),
                ],
              ),
            ),
          ),
          Positioned.fill(
            child: AnimatedSwitcher(
              duration: AtriaMotion.effectsSlowDuration,
              child: KeyedSubtree(key: ValueKey(step), child: _scene(step, size)),
            ),
          ),
        ],
      ),
    ),
  );

  Widget _scene(int step, double size) => switch (step) {
    0 => const _Welcome(),
    1 => const _ThreeWays(),
    2 => const _Search(),
    3 => const _Book(),
    4 => const _Remind(),
    _ => const _Privacy(),
  };
}

/// A small white card, the only thing that sits on the shape.
class _Card extends StatelessWidget {
  const _Card({required this.child, this.padding = const EdgeInsets.symmetric(horizontal: 12, vertical: 10)});
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => Container(
    padding: padding,
    decoration: BoxDecoration(
      color: P.white,
      borderRadius: BorderRadius.circular(18),
      boxShadow: const [BoxShadow(offset: Offset(0, 12), blurRadius: 26, color: Color(0x40081C50))],
    ),
    child: child,
  );
}

class _Welcome extends StatelessWidget {
  const _Welcome();

  @override
  Widget build(BuildContext context) => Stack(
    clipBehavior: Clip.none,
    children: [
      Positioned(
        left: -18,
        bottom: 18,
        child: PopIn(
          delay: 250,
          child: Float(
            child: _Card(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const IconBubble('calendar', size: 32, solid: true),
                  const SizedBox(width: 10),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Tomorrow, 10:00', style: T.strong(size: 13)),
                      Text('Paediatrics', style: T.small(size: 11.5)),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
      Positioned(
        right: -14,
        top: 22,
        child: PopIn(
          delay: 420,
          child: Float(
            phase: 2,
            child: _Card(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const AtriaIcon('bell', size: 15, color: P.blue700),
                  const SizedBox(width: 7),
                  Text('Reminder set', style: T.strong(size: 12.5, color: P.blue800)),
                ],
              ),
            ),
          ),
        ),
      ),
    ],
  );
}

class _ThreeWays extends StatefulWidget {
  const _ThreeWays();

  @override
  State<_ThreeWays> createState() => _ThreeWaysState();
}

class _ThreeWaysState extends State<_ThreeWays> {
  int on = 0;
  late final Timer tick = Timer.periodic(const Duration(milliseconds: 1500), (_) => setState(() => on = (on + 1) % 3));

  @override
  void initState() {
    super.initState();
    tick;
  }

  @override
  void dispose() {
    tick.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const ways = [
      ('stethoscope', 'Book a specialist', 'Pick a day and a free time'),
      ('listOrdered', 'See a doctor today', 'A place in the queue'),
      ('clipboard', 'Request a procedure', 'The unit offers a time'),
    ];
    return Center(
      child: FractionallySizedBox(
        widthFactor: .92,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (var i = 0; i < 3; i++)
              PopIn(
                delay: 120 + 110 * i,
                child: AnimatedScale(
                  scale: on == i ? 1.04 : .96,
                  duration: AtriaMotion.spatialDefaultDuration,
                  curve: AtriaMotion.spatialDefault,
                  child: AnimatedOpacity(
                    opacity: on == i ? 1 : .8,
                    duration: AtriaMotion.effectsDefaultDuration,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: _Card(
                        child: Row(
                          children: [
                            IconBubble(ways[i].$1, size: 34, solid: on == i),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(ways[i].$2, style: T.strong(size: 13)),
                                  Text(ways[i].$3, style: T.small(size: 11)),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _Search extends StatefulWidget {
  const _Search();

  @override
  State<_Search> createState() => _SearchState();
}

class _SearchState extends State<_Search> {
  static const word = 'Paediatrics';
  int typed = 0;
  late final Timer tick = Timer.periodic(const Duration(milliseconds: 110), (_) {
    if (typed < word.length + 12) setState(() => typed++);
  });

  @override
  void initState() {
    super.initState();
    tick;
  }

  @override
  void dispose() {
    tick.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final shown = word.substring(0, typed.clamp(0, word.length));
    final done = typed >= word.length;
    return Center(
      child: FractionallySizedBox(
        widthFactor: .9,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            PopIn(
              child: _Card(
                child: Row(
                  children: [
                    const AtriaIcon('search', size: 16, color: P.ink3),
                    const SizedBox(width: 8),
                    Text(shown, style: T.strong(size: 13.5)),
                    Container(width: 1.6, height: 16, margin: const EdgeInsets.only(left: 2), color: P.blue600),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 10),
            for (final (i, (name, sub)) in const [
              ('Dr Esther Mbarga', 'Paediatrics · English, French'),
              ('Dr Paul Etoa', 'Paediatrics · French'),
            ].indexed)
              AnimatedOpacity(
                opacity: done ? 1 : 0,
                duration: AtriaMotion.effectsSlowDuration,
                child: AnimatedSlide(
                  offset: done ? Offset.zero : const Offset(0, .3),
                  duration: Duration(milliseconds: 435 + 120 * i),
                  curve: AtriaMotion.spatialDefault,
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: _Card(
                      child: Row(
                        children: [
                          CircleAvatar(
                            radius: 16,
                            backgroundColor: P.blue100,
                            child: Text(name.split(' ')[1][0], style: T.strong(size: 12, color: P.blue800)),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(name, style: T.strong(size: 12.5)),
                                Text(sub, style: T.small(size: 10.5)),
                              ],
                            ),
                          ),
                          if (i == 0) const Pill('Today', kind: PillKind.solid),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _Book extends StatefulWidget {
  const _Book();

  @override
  State<_Book> createState() => _BookState();
}

class _BookState extends State<_Book> {
  int slot = -1;
  late final Timer tick = Timer(const Duration(milliseconds: 900), () => setState(() => slot = 4));

  @override
  void initState() {
    super.initState();
    tick;
  }

  @override
  void dispose() {
    tick.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const days = [('Mon', '5'), ('Tue', '6'), ('Wed', '7'), ('Thu', '8')];
    const times = ['08:30', '09:00', '09:40', '10:10', '10:50', '11:30'];
    return Center(
      child: FractionallySizedBox(
        widthFactor: .9,
        child: PopIn(
          child: _Card(
            padding: const EdgeInsets.all(12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    for (final (i, (d, n)) in days.indexed)
                      Expanded(
                        child: Container(
                          margin: const EdgeInsets.symmetric(horizontal: 2),
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          decoration: BoxDecoration(
                            color: i == 1 ? P.blue700 : P.blue50,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Column(
                            children: [
                              Text(d, style: T.small(size: 10, color: i == 1 ? P.blue100 : P.ink3)),
                              Text(n, style: T.strong(size: 13, color: i == 1 ? P.white : P.ink)),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                GridView.count(
                  crossAxisCount: 3,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  mainAxisSpacing: 6,
                  crossAxisSpacing: 6,
                  childAspectRatio: 2.3,
                  children: [
                    for (final (i, t) in times.indexed)
                      AnimatedContainer(
                        duration: AtriaMotion.spatialFastDuration,
                        curve: AtriaMotion.spatialFast,
                        decoration: BoxDecoration(
                          color: slot == i ? P.blue700 : P.white,
                          borderRadius: BorderRadius.circular(slot == i ? 10 : 99),
                          border: Border.all(color: slot == i ? P.blue700 : P.line),
                        ),
                        child: Center(
                          child: Text(t, style: T.strong(size: 11.5, color: slot == i ? P.white : P.ink2)),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                AnimatedOpacity(
                  opacity: slot >= 0 ? 1 : 0,
                  duration: AtriaMotion.effectsSlowDuration,
                  child: const Pill('Held for you once you confirm', kind: PillKind.soft, icon: 'lock'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Remind extends StatelessWidget {
  const _Remind();

  @override
  Widget build(BuildContext context) {
    Widget notice(String icon, String app, String text, int delay) => PopIn(
      delay: delay,
      from: const Offset(0, -30),
      child: Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: _Card(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              IconBubble(icon, size: 32, solid: true),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      app,
                      style: T.small(size: 10.5, weight: FontWeight.w700, color: P.blue700),
                    ),
                    Text(text, style: T.strong(size: 12)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
    return Center(
      child: FractionallySizedBox(
        widthFactor: .92,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            notice('phone', 'SMS · NOW', 'Reminder: Paediatrics tomorrow at 10:00.', 150),
            notice('mail', 'EMAIL · NOW', 'Your visit tomorrow, and how to find the unit.', 420),
            notice('repeat', 'IN THE APP', 'Plans changed? Move it in two taps.', 690),
          ],
        ),
      ),
    );
  }
}

class _Privacy extends StatelessWidget {
  const _Privacy();

  @override
  Widget build(BuildContext context) => Stack(
    alignment: Alignment.center,
    children: [
      PopIn(
        child: Container(
          width: 96,
          height: 96,
          decoration: BoxDecoration(
            color: P.white,
            borderRadius: BorderRadius.circular(34),
            boxShadow: const [BoxShadow(offset: Offset(0, 16), blurRadius: 30, color: Color(0x55081C50))],
          ),
          child: const Center(child: AtriaIcon('lock', size: 42, color: P.blue700, stroke: 1.6)),
        ),
      ),
      for (final (i, (text, align)) in const [
        ('You and your clinician', Alignment(-.95, -.95)),
        ('Only your hospital', Alignment(1.1, .42)),
        ('Yours to delete', Alignment(-.85, 1)),
      ].indexed)
        Align(
          alignment: align,
          child: PopIn(
            delay: 250 + 150 * i,
            child: Float(
              phase: i.toDouble(),
              child: _Card(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const AtriaIcon('checkMark', size: 13, color: P.blue700),
                    const SizedBox(width: 6),
                    Text(
                      text,
                      style: AtriaType.body(size: 12, weight: FontWeight.w700, color: P.ink),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
    ],
  );
}
