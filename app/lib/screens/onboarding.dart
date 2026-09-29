import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/expressive.dart';
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

const _steps = [
  _Step(
    'Welcome to Atria',
    'Care that keeps time with you.',
    "Find a clinician, join today's queue or book ahead, and let Atria carry the calendar for you.",
  ),
  _Step(
    'Today or ahead',
    'A place in the queue, or a time that is yours.',
    'Take a place in the outpatient session from your phone, or book a specialist at a time that suits you.',
  ),
  _Step(
    'Reminded, not chased',
    'We tell you before it matters.',
    'A text the day before every visit, and word straight away if anything about it changes.',
  ),
];

class _OnboardingScreenState extends State<OnboardingScreen> {
  int step = 0;

  void leave(String to) {
    widget.onSeen?.call();
    context.go(to);
  }

  @override
  Widget build(BuildContext context) {
    final current = _steps[step];
    final last = step == _steps.length - 1;
    return Scaffold(
      body: DecoratedBox(
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
                SafeArea(
                  bottom: false,
                  child: SizedBox(
                    height: field,
                    child: Stack(
                      children: [
                        const Positioned(left: 26, top: 16, child: _Brand()),
                        Positioned(
                          left: 46,
                          top: field * 106 / 478,
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
                          top: field * 204 / 478,
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
                          top: field * 284 / 478,
                          child: const Rise(
                            index: 2,
                            child: _GlassCard(
                              width: 132,
                              height: 82,
                              padding: 14,
                              label: 'CONFIRMED',
                              sub: '4 upcoming',
                            ),
                          ),
                        ),
                      ],
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
