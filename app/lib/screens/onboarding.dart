import 'dart:math' as math;
import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/expressive.dart';
import '../ui/icons.dart';
import '../ui/widgets.dart';

/// "Mobile · Onboarding" (Figma 31:2): the blue field with three glass cards
/// over the pulse, and the white sheet with its three steps. Get started opens
/// the sign-up; the arrow turns to the next step; Sign in for the registered.
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

/// The first screen is the frame's own (31:2); the five after it say what
/// Atria is and how to use it (feedback 2026-09-29), each over its own glass
/// scene, in the words the website's front page uses.
const _steps = [
  _Step(
    'Welcome to Atria',
    'Care that keeps time with you.',
    "Find a clinician, join today's queue or book ahead, and let Atria carry the calendar for you.",
  ),
  _Step(
    'What Atria is',
    'Three ways to be seen.',
    "Book a specialist, join the outpatient department's queue for today, or ask a unit for a minor procedure. One calendar for every unit, so the time you see is the time you get.",
  ),
  _Step(
    'Find care',
    'Search as you would say it.',
    'A name, a specialty, a unit. Filter by unit and the language a clinician consults in, and see who has an opening today.',
  ),
  _Step(
    'Book, or join the queue',
    'A time that is yours, or a place today.',
    'Pick a free time and it is held once you confirm, or take a place in the queue with a window to arrive in. Some visits ask a few questions first.',
  ),
  _Step(
    'Be reminded',
    'A text and an email, the day before.',
    'Move or cancel from the app if your plans change, and the time goes to someone else. If anything changes on our side, you hear at once.',
  ),
  _Step(
    'Your data',
    'Your answers stay with your clinician.',
    'Only you and your clinician read what you write before a visit, deleted 90 days after it. Your record stays with the hospital, and your account is yours to delete.',
  ),
];

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
    final current = _steps[step];
    final last = step == _steps.length - 1;
    return Scaffold(
      // Swipe left for the next step, right for the one before.
      body: GestureDetector(
        behavior: HitTestBehavior.translucent,
        onHorizontalDragEnd: (drag) {
          final speed = drag.primaryVelocity ?? 0;
          if (speed < -250) go(step + 1);
          if (speed > 250) go(step - 1);
        },
        child: DecoratedBox(
          decoration: BoxDecoration(
            gradient: cssGradient(
              159,
              const [Color(0xFF2C63DE), Color(0xFF3D78EC), Color(0xFF7FA9F6), Color(0xFFDCE8FD)],
              [.068, .362, .655, .932],
            ),
          ),
          child: LayoutBuilder(
            builder: (context, box) {
              // The sheet takes the lower 404 of the 844 frame; a shorter phone
              // gives the cards less room, never the sheet.
              final sheet = (box.maxHeight * 404 / 844).clamp(360.0, 440.0);
              final field = box.maxHeight - sheet + 38;
              return Stack(
                // Sized to the screen: the only unpositioned child is the card field.
                fit: StackFit.expand,
                children: [
                  // The two orbs of 31:3 and 31:4: white light, blurred by 50 as
                  // the frame's filter does (Flutter's SVG renderer drops the
                  // filter, so they are drawn here), drifting behind the glass.
                  const Positioned.fill(
                    child: DriftingLight(
                      orbs: [
                        Orb(left: 200, top: -80, size: 300, color: Color(0x99FFFFFF), drift: 30),
                        Orb(left: -90, top: 170, size: 240, color: Color(0x80FFFFFF), drift: 24),
                      ],
                    ),
                  ),
                  Positioned(
                    left: 0,
                    right: 0,
                    top: field * 198 / 478,
                    child: SvgPicture.asset('assets/onboarding/pulse.svg', height: 64, fit: BoxFit.fill),
                  ),
                  // Positioned, so the field keeps its own height; the stack
                  // would otherwise stretch it to the whole screen.
                  Positioned(
                    left: 0,
                    right: 0,
                    top: 0,
                    child: SafeArea(
                      bottom: false,
                      child: SizedBox(
                        height: field,
                        child: Stack(
                          children: [
                            const Positioned(left: 26, top: 16, child: _Brand()),
                            if (!last) Positioned(right: 18, top: 12, child: _Skip(onTap: () => go(_steps.length - 1))),
                            Positioned.fill(
                              top: 60,
                              child: AnimatedSwitcher(
                                duration: AtriaMotion.spatialSlowDuration,
                                switchInCurve: AtriaMotion.spatialDefault,
                                switchOutCurve: Curves.easeOut,
                                transitionBuilder: (child, animation) => FadeTransition(
                                  opacity: animation,
                                  child: ScaleTransition(
                                    scale: Tween(begin: .92, end: 1.0).animate(animation),
                                    child: child,
                                  ),
                                ),
                                child: KeyedSubtree(key: ValueKey(step), child: _scene(step, field - 60)),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  // The sheet is at least its frame height and grows with its
                  // words (larger system text, a narrow phone), never clipping them.
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 0,
                    child: ClipRRect(
                      borderRadius: const BorderRadius.vertical(top: Radius.circular(38)),
                      child: BackdropFilter(
                        filter: ImageFilter.blur(sigmaX: 15, sigmaY: 15),
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            gradient: cssGradient(159, const [Color(0xF5FFFFFF), Color(0xE0FFFFFF)], [.11, .89]),
                            boxShadow: const [
                              BoxShadow(offset: Offset(0, -14), blurRadius: 44, color: Color(0x2E0E2C6E)),
                            ],
                          ),
                          child: SafeArea(
                            top: false,
                            child: ConstrainedBox(
                              constraints: BoxConstraints(minHeight: sheet - MediaQuery.paddingOf(context).bottom),
                              child: Padding(
                                padding: const EdgeInsets.fromLTRB(26, 30, 26, 22),
                                child: Column(
                                  // Its own height, at least the frame's; spare room goes between.
                                  mainAxisSize: MainAxisSize.min,
                                  crossAxisAlignment: CrossAxisAlignment.stretch,
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    AnimatedSwitcher(
                                      duration: AtriaMotion.spatialDefaultDuration,
                                      switchInCurve: AtriaMotion.spatialDefault,
                                      transitionBuilder: (child, animation) => FadeTransition(
                                        opacity: animation,
                                        child: SlideTransition(
                                          position: Tween(
                                            begin: const Offset(.08, 0),
                                            end: Offset.zero,
                                          ).animate(animation),
                                          child: child,
                                        ),
                                      ),
                                      child: Column(
                                        key: ValueKey(step),
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          _Dots(count: _steps.length, at: step),
                                          const SizedBox(height: 22),
                                          Text(
                                            current.kicker,
                                            style: AtriaType.body(
                                              size: 12.5,
                                              weight: FontWeight.w600,
                                              color: AtriaColors.blue600,
                                            ).copyWith(letterSpacing: .25),
                                          ),
                                          const SizedBox(height: 9),
                                          Text(
                                            current.title,
                                            style: AtriaType.display(size: 33)
                                                .copyWith(height: 35.6 / 33, letterSpacing: -.825),
                                          ),
                                          const SizedBox(height: 13),
                                          SizedBox(
                                            width: 300,
                                            child: Text(
                                              current.body,
                                              style: AtriaType.body(
                                                size: 14.5,
                                                color: const Color(0xFF54658A),
                                                height: 21.75 / 14.5,
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    Column(
                                      crossAxisAlignment: CrossAxisAlignment.stretch,
                                      children: [
                                        Row(
                                          children: [
                                            Expanded(
                                              child: PrimaryButton(
                                                label: 'Get started',
                                                onPressed: () => leave('/create-account'),
                                              ),
                                            ),
                                            const SizedBox(width: 11),
                                            _NextButton(
                                              label: last ? 'Sign in' : 'Next',
                                              onPressed: () => last ? leave('/sign-in') : setState(() => step += 1),
                                            ),
                                          ],
                                        ),
                                        const SizedBox(height: 16),
                                        Center(
                                          child: GestureDetector(
                                            onTap: () => leave('/sign-in'),
                                            behavior: HitTestBehavior.opaque,
                                            child: Padding(
                                              padding: const EdgeInsets.symmetric(vertical: 6),
                                              child: Text.rich(
                                                TextSpan(
                                                  style: AtriaType.body(size: 13.5, color: const Color(0xFF6B7C9C)),
                                                  children: [
                                                    const TextSpan(text: 'Already registered? '),
                                                    TextSpan(
                                                      text: 'Sign in',
                                                      style: AtriaType.body(
                                                        size: 13.5,
                                                        weight: FontWeight.w700,
                                                        color: AtriaColors.blue600,
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
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

/// The mark on glass and the word, white on the blue field (31:5).
class _Brand extends StatelessWidget {
  const _Brand();

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(
        width: 32,
        height: 32,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(11),
          gradient: cssGradient(140, const [Color(0xF2FFFFFF), Color(0xB3FFFFFF)], [.145, .855]),
          boxShadow: const [BoxShadow(offset: Offset(0, 4), blurRadius: 12, color: Color(0x3D0A2460))],
        ),
        child: Center(child: SvgPicture.asset('assets/onboarding/brand.svg', width: 17, height: 17)),
      ),
      const SizedBox(width: 9),
      Text(
        'ATRIA',
        style: AtriaType.display(size: 17, weight: FontWeight.w600, color: Colors.white).copyWith(letterSpacing: 1.02),
      ),
    ],
  );
}

/// One of the three glass cards over the pulse (31:10, 31:16, 31:22).
class _GlassCard extends StatelessWidget {
  const _GlassCard({
    required this.width,
    required this.height,
    required this.padding,
    required this.label,
    required this.sub,
    this.value,
    this.valueSize = 24,
    this.phase = 0,
  });
  final double phase;
  final double width;
  final double height;
  final double padding;
  final String label;
  final String? value;
  final double valueSize;
  final String sub;

  @override
  Widget build(BuildContext context) {
    final white = AtriaType.body(size: 12, weight: FontWeight.w600, color: Colors.white, height: 1.2);
    return Float(
      phase: phase,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(26),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 9, sigmaY: 9),
          child: Container(
            width: width,
            // The frame's height as a floor; larger text makes the card taller.
            constraints: BoxConstraints(minHeight: height),
            padding: EdgeInsets.all(padding),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(26),
              border: Border.all(color: Colors.white.withValues(alpha: .7)),
              gradient: cssGradient(150, const [Color(0x6BFFFFFF), Color(0x24FFFFFF)], [.144, .856]),
              boxShadow: const [BoxShadow(offset: Offset(0, 12), blurRadius: 34, color: Color(0x380C286E))],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: white.copyWith(fontSize: 11, letterSpacing: .44)),
                SizedBox(height: value == null ? 9 : 6),
                if (value != null) ...[
                  Text(
                    value!,
                    style: AtriaType.display(size: valueSize, color: Colors.white).copyWith(height: 1),
                  ),
                  const SizedBox(height: 6),
                ],
                Text(sub, style: white.copyWith(fontSize: value == null ? 13 : 12)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Where the steps are: the current one long and blue (31:30).
class _Dots extends StatelessWidget {
  const _Dots({required this.count, required this.at});
  final int count;
  final int at;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      for (var i = 0; i < count; i++) ...[
        AnimatedContainer(
          duration: AtriaMotion.spatialFastDuration,
          curve: AtriaMotion.spatialFast,
          width: i == at ? 26 : 7,
          height: 7,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(99),
            color: i == at ? null : AtriaColors.lineSoft,
            gradient: i == at ? cssGradient(90, const [AtriaColors.blue500, Color(0xFF2565DE)]) : null,
          ),
        ),
        const SizedBox(width: 7),
      ],
    ],
  );
}

/// The 60 square glass button with the arrow (31:44): the next step.
class _NextButton extends StatelessWidget {
  const _NextButton({required this.label, required this.onPressed});
  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => PressableSurface(
    semanticLabel: label,
    radius: 20,
    width: 60,
    height: 60,
    border: Border.all(color: Colors.white),
    gradient: cssGradient(140, const [Color(0xF5FFFFFF), Color(0xB3FFFFFF)], [.145, .855]),
    shadow: const BoxShadow(offset: Offset(0, 4), blurRadius: 14, color: Color(0x1F102A5E)),
    ink: AtriaColors.blue700,
    onTap: onPressed,
    // On the last step the arrow turns to point on, into sign-in.
    child: AnimatedRotation(
      turns: label == 'Sign in' ? .125 : 0,
      duration: AtriaMotion.spatialFastDuration,
      curve: AtriaMotion.spatialFast,
      child: SvgPicture.asset('assets/onboarding/arrow.svg', width: 21, height: 21),
    ),
  );
}

/// The glass scene over the blue field for each step. [height] is the room
/// between the brand and the sheet.
Widget _scene(int step, double height) {
  switch (step) {
    case 0:
      // The frame's three cards, where 31:2 puts them.
      final field = height + 60;
      return Stack(
        children: [
          Positioned(
            left: 46,
            top: field * 106 / 478 - 60,
            child: const Rise(
              child: _GlassCard(
                width: 214,
                height: 154,
                padding: 20,
                label: 'NEXT VISIT',
                value: '10:00',
                valueSize: 30,
                sub: 'Wed 10 Sept · Dr. Roberts',
              ),
            ),
          ),
          Positioned(
            left: 206,
            top: field * 204 / 478 - 60,
            child: const Rise(
              index: 1,
              child: _GlassCard(
                width: 150,
                height: 130,
                padding: 16,
                phase: .33,
                label: 'REMINDER',
                value: '24h',
                valueSize: 24,
                sub: 'before you go',
              ),
            ),
          ),
          Positioned(
            left: 78,
            top: field * 284 / 478 - 60,
            child: const Rise(
              index: 2,
              child: _GlassCard(width: 132, height: 82, padding: 14, label: 'CONFIRMED', sub: '4 upcoming'),
            ),
          ),
        ],
      );
    case 1:
      return const _Centred(
        children: [
          _WayRow(icon: 'stethoscope', title: 'Book a specialist', sub: 'A time held once you confirm'),
          _WayRow(icon: 'users', title: 'See a doctor today', sub: 'Place A-14 · arrive 10:40 to 11:10', index: 1),
          _WayRow(icon: 'clipboard', title: 'Request a procedure', sub: 'The unit offers you a time', index: 2),
        ],
      );
    case 2:
      return const _Centred(
        children: [
          _SearchBar(),
          _ChipLine(labels: ['All units', 'English', 'French'], on: 0, index: 1),
          _PersonRow(initials: 'EM', name: 'Dr Esther Mbarga', sub: 'Paediatrics', today: true, index: 2),
          _PersonRow(initials: 'DT', name: 'Dr Divine Tanyi', sub: 'Paediatrics', index: 3),
        ],
      );
    case 3:
      return const _Centred(children: [_WeekStrip(), _SlotGrid(), _QuestionsNote()]);
    case 4:
      return const _Centred(
        children: [
          _Clock(),
          _Notice(
            icon: 'phone',
            app: 'SMS · now',
            title: 'Reminder: Dr Esther Mbarga',
            sub: 'Tomorrow, 10:00 · Paediatrics Unit',
          ),
          _Notice(
            icon: 'mail',
            app: 'Email · now',
            title: 'Your visit tomorrow',
            sub: 'Move or cancel in Atria',
            index: 1,
          ),
        ],
      );
    default:
      return const _PrivacyScene();
  }
}

/// Skip to the last step, on glass (the last step has Sign in instead).
class _Skip extends StatelessWidget {
  const _Skip({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => PressableSurface(
    semanticLabel: 'Skip',
    radius: 18,
    height: 36,
    border: Border.all(color: Colors.white.withValues(alpha: .6)),
    gradient: cssGradient(150, const [Color(0x40FFFFFF), Color(0x1FFFFFFF)]),
    ink: Colors.white,
    onTap: onTap,
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Text(
        'Skip',
        style: AtriaType.body(size: 13, weight: FontWeight.w700, color: Colors.white),
      ),
    ),
  );
}

/// A column of scene parts in the middle of the field, rising in turn.
class _Centred extends StatelessWidget {
  const _Centred({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Center(
    child: SingleChildScrollView(
      physics: const NeverScrollableScrollPhysics(),
      padding: const EdgeInsets.symmetric(horizontal: 26),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 340),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var i = 0; i < children.length; i++) ...[if (i > 0) const SizedBox(height: 10), children[i]],
          ],
        ),
      ),
    ),
  );
}

/// Frosted glass on the blue field, the look of the frame's cards.
class _Glass extends StatelessWidget {
  const _Glass({required this.child, this.padding = const EdgeInsets.all(14), this.radius = 22, this.solid = false});
  final Widget child;
  final EdgeInsets padding;
  final double radius;

  /// Near-white, for things that stand for the app's own screens.
  final bool solid;

  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(radius),
    child: BackdropFilter(
      filter: ImageFilter.blur(sigmaX: 9, sigmaY: 9),
      child: Container(
        padding: padding,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(radius),
          border: Border.all(color: Colors.white.withValues(alpha: solid ? .9 : .7)),
          gradient: solid
              ? cssGradient(150, const [Color(0xF5FFFFFF), Color(0xE6FFFFFF)])
              : cssGradient(150, const [Color(0x6BFFFFFF), Color(0x24FFFFFF)], [.144, .856]),
          boxShadow: const [BoxShadow(offset: Offset(0, 12), blurRadius: 30, color: Color(0x330C286E))],
        ),
        child: child,
      ),
    ),
  );
}

TextStyle _white(double size, {FontWeight weight = FontWeight.w600, double alpha = 1}) => AtriaType.body(
  size: size,
  weight: weight,
  color: Colors.white.withValues(alpha: alpha),
  height: 1.25,
);

/// A white square badge with a blue icon.
class _Badge extends StatelessWidget {
  const _Badge(this.icon);
  final String icon;

  @override
  Widget build(BuildContext context) => Container(
    width: 38,
    height: 38,
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(13)),
    child: Center(child: AtriaIcon(icon, size: 18, color: AtriaColors.blue600)),
  );
}

class _WayRow extends StatelessWidget {
  const _WayRow({required this.icon, required this.title, required this.sub, this.index = 0});
  final String icon;
  final String title;
  final String sub;
  final int index;

  @override
  Widget build(BuildContext context) => Rise(
    index: index * 2,
    child: Float(
      phase: index * .3,
      child: _Glass(
        child: Row(
          children: [
            _Badge(icon),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: _white(15, weight: FontWeight.w700)),
                  const SizedBox(height: 3),
                  Text(sub, style: _white(12, alpha: .85)),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class _SearchBar extends StatelessWidget {
  const _SearchBar();

  @override
  Widget build(BuildContext context) => Rise(
    child: _Glass(
      solid: true,
      radius: 18,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          const AtriaIcon('search', size: 16, color: AtriaColors.blue600),
          const SizedBox(width: 10),
          Text('Paediatrics', style: AtriaType.body(size: 14, weight: FontWeight.w600)),
          const _Caret(),
        ],
      ),
    ),
  );
}

/// A blinking text caret, as if someone is typing.
class _Caret extends StatefulWidget {
  const _Caret();

  @override
  State<_Caret> createState() => _CaretState();
}

class _CaretState extends State<_Caret> with SingleTickerProviderStateMixin {
  late final AnimationController blink = AnimationController(vsync: this, duration: const Duration(milliseconds: 600));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) {
      blink.value = 1;
    } else if (!blink.isAnimating) {
      blink.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    blink.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FadeTransition(
    opacity: blink,
    child: Container(width: 2, height: 17, margin: const EdgeInsets.only(left: 2), color: AtriaColors.blue600),
  );
}

class _ChipLine extends StatelessWidget {
  const _ChipLine({required this.labels, required this.on, this.index = 0});
  final List<String> labels;
  final int on;
  final int index;

  @override
  Widget build(BuildContext context) => Rise(
    index: index * 2,
    child: Row(
      children: [
        for (var i = 0; i < labels.length; i++) ...[
          if (i > 0) const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 8),
            decoration: BoxDecoration(
              color: i == on ? Colors.white : Colors.white.withValues(alpha: .18),
              borderRadius: BorderRadius.circular(i == on ? 10 : 16),
              border: Border.all(color: Colors.white.withValues(alpha: .7)),
            ),
            child: Text(
              labels[i],
              style: AtriaType.body(
                size: 12.5,
                weight: FontWeight.w700,
                color: i == on ? AtriaColors.blue700 : Colors.white,
              ),
            ),
          ),
        ],
      ],
    ),
  );
}

class _PersonRow extends StatelessWidget {
  const _PersonRow({required this.initials, required this.name, required this.sub, this.today = false, this.index = 0});
  final String initials;
  final String name;
  final String sub;
  final bool today;
  final int index;

  @override
  Widget build(BuildContext context) => Rise(
    index: index * 2,
    child: Float(
      phase: index * .25,
      child: _Glass(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(13)),
              child: Center(
                child: Text(initials, style: AtriaType.display(size: 13, color: AtriaColors.blue600)),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(name, style: _white(14, weight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Text(sub, style: _white(12, alpha: .85)),
                ],
              ),
            ),
            if (today)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                decoration: BoxDecoration(color: const Color(0xFFD9F5E8), borderRadius: BorderRadius.circular(10)),
                child: Text(
                  'Today',
                  style: AtriaType.body(size: 11, weight: FontWeight.w700, color: const Color(0xFF0E7A53)),
                ),
              ),
          ],
        ),
      ),
    ),
  );
}

class _WeekStrip extends StatelessWidget {
  const _WeekStrip();

  @override
  Widget build(BuildContext context) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    return Rise(
      child: Row(
        children: [
          for (var i = 0; i < days.length; i++) ...[
            if (i > 0) const SizedBox(width: 7),
            Expanded(
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 9),
                decoration: BoxDecoration(
                  color: i == 2 ? Colors.white : Colors.white.withValues(alpha: .18),
                  borderRadius: BorderRadius.circular(i == 2 ? 20 : 14),
                  border: Border.all(color: Colors.white.withValues(alpha: .7)),
                ),
                child: Column(
                  children: [
                    Text(
                      days[i],
                      style: AtriaType.body(
                        size: 11,
                        weight: FontWeight.w600,
                        color: i == 2 ? AtriaColors.blue600 : Colors.white.withValues(alpha: .85),
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${7 + i}',
                      style: AtriaType.display(size: 17, color: i == 2 ? AtriaColors.blue700 : Colors.white),
                    ),
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

class _SlotGrid extends StatelessWidget {
  const _SlotGrid();

  @override
  Widget build(BuildContext context) {
    const times = ['09:30', '10:00', '10:15', '11:30', '14:00', '15:10'];
    return Rise(
      index: 2,
      child: GridView.count(
        crossAxisCount: 3,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        mainAxisSpacing: 8,
        crossAxisSpacing: 8,
        childAspectRatio: 2.6,
        padding: EdgeInsets.zero,
        children: [for (final t in times) _Slot(time: t, on: t == '10:00')],
      ),
    );
  }
}

/// A free time; the chosen one fills white as its corners round up, on the
/// fast spatial spring, a beat after the scene arrives.
class _Slot extends StatelessWidget {
  const _Slot({required this.time, required this.on});
  final String time;
  final bool on;

  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
    tween: Tween(begin: 0, end: on ? 1 : 0),
    duration: AtriaMotion.spatialSlowDuration + const Duration(milliseconds: 400),
    curve: const Interval(.4, 1, curve: AtriaMotion.spatialFast),
    builder: (context, t, _) {
      final k = t.clamp(0.0, 1.0);
      return Container(
        decoration: BoxDecoration(
          color: Color.lerp(Colors.white.withValues(alpha: .18), Colors.white, k),
          borderRadius: BorderRadius.circular(12 + 8 * t),
          border: Border.all(color: Colors.white.withValues(alpha: .7)),
        ),
        child: Center(
          child: Text(
            time,
            style: AtriaType.body(
              size: 13,
              weight: FontWeight.w700,
              color: Color.lerp(Colors.white, AtriaColors.blue700, k)!,
            ),
          ),
        ),
      );
    },
  );
}

class _QuestionsNote extends StatelessWidget {
  const _QuestionsNote();

  @override
  Widget build(BuildContext context) => Rise(
    index: 4,
    child: _Glass(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      radius: 16,
      child: Row(
        children: [
          const AtriaIcon('clipboard', size: 15, color: Colors.white),
          const SizedBox(width: 8),
          Expanded(child: Text('2 short questions, so your clinician knows why', style: _white(12.5))),
        ],
      ),
    ),
  );
}

class _Clock extends StatelessWidget {
  const _Clock();

  @override
  Widget build(BuildContext context) => Rise(
    child: Column(
      children: [
        Text(
          '09:58',
          style: AtriaType.display(size: 46, weight: FontWeight.w600, color: Colors.white).copyWith(height: 1),
        ),
        const SizedBox(height: 4),
        Text('Tuesday', style: _white(13, alpha: .85)),
        const SizedBox(height: 6),
      ],
    ),
  );
}

class _Notice extends StatelessWidget {
  const _Notice({required this.icon, required this.app, required this.title, required this.sub, this.index = 0});
  final String icon;
  final String app;
  final String title;
  final String sub;
  final int index;

  @override
  Widget build(BuildContext context) => Rise(
    index: 3 + index * 4,
    child: _Glass(
      solid: true,
      radius: 20,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              AtriaIcon(icon, size: 12, color: AtriaColors.inkMuted),
              const SizedBox(width: 5),
              Text(
                app,
                style: AtriaType.body(size: 11, weight: FontWeight.w700, color: AtriaColors.inkMuted),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(title, style: AtriaType.body(size: 14, weight: FontWeight.w700)),
          const SizedBox(height: 2),
          Text(sub, style: AtriaType.body(size: 12, color: AtriaColors.inkMuted)),
        ],
      ),
    ),
  );
}

/// A lock in an M3 Expressive shape that morphs between a nine-sided cookie
/// and a four-leaf clover, with the two promises beside it.
class _PrivacyScene extends StatelessWidget {
  const _PrivacyScene();

  @override
  Widget build(BuildContext context) => const Center(
    child: SizedBox(
      width: 320,
      height: 280,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Rise(child: _MorphingLock(size: 190)),
          Positioned(
            left: 0,
            top: 18,
            child: Rise(
              index: 3,
              child: Float(
                child: _PromiseChip(icon: 'lock', text: 'Only you and your clinician'),
              ),
            ),
          ),
          Positioned(
            right: 0,
            bottom: 14,
            child: Rise(
              index: 5,
              child: Float(
                phase: .5,
                child: _PromiseChip(icon: 'clock', text: 'Deleted 90 days after'),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

class _PromiseChip extends StatelessWidget {
  const _PromiseChip({required this.icon, required this.text});
  final String icon;
  final String text;

  @override
  Widget build(BuildContext context) => _Glass(
    solid: true,
    radius: 18,
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        AtriaIcon(icon, size: 13, color: AtriaColors.blue600),
        const SizedBox(width: 6),
        Text(text, style: AtriaType.body(size: 12, weight: FontWeight.w700)),
      ],
    ),
  );
}

class _MorphingLock extends StatefulWidget {
  const _MorphingLock({required this.size});
  final double size;

  @override
  State<_MorphingLock> createState() => _MorphingLockState();
}

class _MorphingLockState extends State<_MorphingLock> with SingleTickerProviderStateMixin {
  late final AnimationController turn = AnimationController(vsync: this, duration: const Duration(seconds: 8));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Still under reduced motion: the cookie, not moving.
    if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) {
      turn.stop();
    } else if (!turn.isAnimating) {
      turn.repeat();
    }
  }

  @override
  void dispose() {
    turn.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: turn,
    builder: (context, child) {
      // There and back, eased: 0 is the cookie, 1 the clover.
      final t = Curves.easeInOut.transform(1 - (2 * turn.value - 1).abs());
      return ClipPath(clipper: _MorphClipper(t, turn.value), child: child);
    },
    child: Container(
      width: widget.size,
      height: widget.size,
      decoration: BoxDecoration(
        gradient: cssGradient(150, const [Color(0xFF4A83F0), Color(0xFF1E52C4), Color(0xFF1E9A6C)], [0, .45, 1]),
      ),
      child: const Center(child: AtriaIcon('lock', size: 64, color: Colors.white, stroke: 1.6)),
    ),
  );
}

/// The morph: both shapes sampled at the same 120 angles and blended, turning
/// slowly as they change.
class _MorphClipper extends CustomClipper<Path> {
  _MorphClipper(this.t, this.spin);
  final double t;
  final double spin;

  static double _radius(double a, int lobes, double depth, double turn) => 1 + depth * math.cos(lobes * (a + turn));

  @override
  Path getClip(Size size) {
    final path = Path();
    final centre = size.center(Offset.zero);
    final r = size.shortestSide * .46;
    final rotate = spin * math.pi * 2 / 9;
    for (var i = 0; i < 120; i++) {
      final a = i / 120 * math.pi * 2;
      final cookie = _radius(a, 9, .055, 0);
      final clover = _radius(a, 4, .09, math.pi / 4);
      final k = r * (cookie + (clover - cookie) * t);
      final point = centre + Offset(math.cos(a + rotate), math.sin(a + rotate)) * k;
      if (i == 0) {
        path.moveTo(point.dx, point.dy);
      } else {
        path.lineTo(point.dx, point.dy);
      }
    }
    return path..close();
  }

  @override
  bool shouldReclip(_MorphClipper old) => old.t != t || old.spin != spin;
}
