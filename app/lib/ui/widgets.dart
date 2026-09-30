import 'package:flutter/material.dart';

import '../theme/theme.dart';
import '../theme/tokens.dart';
import 'expressive.dart';
import '../ds/kit.dart';
import '../ds/palette.dart';

/// Rises into place on a Material spring, 60 ms apart per row, the way the
/// design system's motion card specifies (ADR 0019). Reduced motion skips it.
class Rise extends StatelessWidget {
  const Rise({super.key, required this.child, this.index = 0});
  final Widget child;
  final int index;

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) return child;
    final delay = 60 * index;
    final total = AtriaMotion.spatialSlowDuration + Duration(milliseconds: delay);
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: total,
      builder: (context, t, child) {
        final local = ((t * total.inMilliseconds - delay) / AtriaMotion.spatialSlowDuration.inMilliseconds).clamp(
          0.0,
          1.0,
        );
        final move = AtriaMotion.spatialDefault.transform(local);
        final fade = AtriaMotion.effects.transform(local);
        return Opacity(
          opacity: fade,
          child: Transform.translate(offset: Offset(0, 22 * (1 - move)), child: child),
        );
      },
      child: child,
    );
  }
}

/// The blue field every mobile frame sits on: the page gradient and three
/// blurred orbs (Mobile · Sign in, 32:3 to 32:5).
class PageBackground extends StatelessWidget {
  const PageBackground({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => ColoredBox(color: P.ground, child: child);
}

/// The Atria mark (32:8): the pulse on the blue gradient, 56 square.
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 56});
  final double size;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(
      color: P.blue700,
      borderRadius: BorderRadius.circular(size * 19 / 56),
      boxShadow: const [BoxShadow(offset: Offset(0, 10), blurRadius: 24, color: Color(0x572159D2))],
    ),
    child: CustomPaint(painter: _Pulse(), size: Size.square(size)),
  );
}

/// The pulse from 32:9, on its 27 unit grid inside the 56 square.
class _Pulse extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final unit = size.width / 56;
    final origin = Offset(14.5 * unit, 14.5 * unit);
    const points = [
      (3.375, 13.5),
      (7.875, 13.5),
      (10.125, 7.875),
      (13.5, 19.125),
      (16.3125, 12.375),
      (18.3375, 15.75),
      (23.625, 15.75),
    ];
    final path = Path();
    for (var i = 0; i < points.length; i++) {
      final p = origin + Offset(points[i].$1 * unit, points[i].$2 * unit);
      i == 0 ? path.moveTo(p.dx, p.dy) : path.lineTo(p.dx, p.dy);
    }
    canvas.drawPath(
      path,
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.475 * unit
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
  }

  @override
  bool shouldRepaint(_Pulse old) => false;
}

/// A labelled field (32:23): 12 px label, 54 high, 17 radius, 17 px icon.
class AtriaField extends StatefulWidget {
  const AtriaField({
    super.key,
    required this.label,
    required this.icon,
    required this.controller,
    this.hint,
    this.obscure = false,
    this.keyboard,
    this.autofill,
    this.onSubmitted,
    this.action,
    this.error,
    this.help,
    this.capitalization = TextCapitalization.none,
  });
  final String label;
  final String icon;

  /// Says what is wrong under the field, which turns red.
  final String? error;

  /// A quiet line under the field (32:101).
  final String? help;
  final TextCapitalization capitalization;
  final TextEditingController controller;
  final String? hint;
  final bool obscure;
  final TextInputType? keyboard;
  final Iterable<String>? autofill;
  final ValueChanged<String>? onSubmitted;
  final TextInputAction? action;

  @override
  State<AtriaField> createState() => _AtriaFieldState();
}

class _AtriaFieldState extends State<AtriaField> {
  @override
  Widget build(BuildContext context) => Field(
    label: widget.label,
    controller: widget.controller,
    hint: widget.hint,
    obscure: widget.obscure,
    keyboard: widget.keyboard,
    autofill: widget.autofill,
    onSubmitted: widget.onSubmitted,
    action: widget.action,
    error: widget.error,
    help: widget.help,
  );
}

/// The primary action (32:45): 56 high, radius 19, the blue gradient; greyed
/// while it cannot act. Pressing moves it one step up the corner scale.
class PrimaryButton extends StatefulWidget {
  const PrimaryButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.busy = false,
    this.danger = false,
  });
  final String label;
  final VoidCallback? onPressed;
  final bool busy;

  /// Red, for an action that takes something away (delete, give up a place).
  final bool danger;

  @override
  State<PrimaryButton> createState() => _PrimaryButtonState();
}

class _PrimaryButtonState extends State<PrimaryButton> {
  @override
  Widget build(BuildContext context) => Btn(
    widget.label,
    onPressed: widget.onPressed,
    busy: widget.busy,
    kind: widget.danger ? BtnKind.danger : BtnKind.primary,
  );
}

/// A white outlined action.
class SecondaryButton extends StatelessWidget {
  const SecondaryButton({super.key, required this.label, required this.onPressed, this.leading});
  final String label;
  final VoidCallback? onPressed;
  final Widget? leading;

  @override
  Widget build(BuildContext context) => Btn(label, onPressed: onPressed, kind: BtnKind.outline, leading: leading);
}

/// Two choices on the glass switch (32:16): radius 19 around, the selected
/// one on a 46 high pill of radius 22 that slides on a spring.
class Segmented extends StatelessWidget {
  const Segmented({super.key, required this.labels, required this.selected, required this.onChanged});
  final List<String> labels;
  final int selected;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(5),
      decoration: BoxDecoration(
        color: P.blue50,
        borderRadius: BorderRadius.circular(24),
      ),
      child: SizedBox(
        height: 46,
        child: LayoutBuilder(
          builder: (context, box) {
            final width = (box.maxWidth - 5 * (labels.length - 1)) / labels.length;
            return Stack(
              children: [
                AnimatedPositioned(
                  duration: AtriaMotion.spatialDefaultDuration,
                  curve: AtriaMotion.spatialDefault,
                  left: (width + 5) * selected,
                  width: width,
                  top: 0,
                  bottom: 0,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: P.blue700,
                      borderRadius: BorderRadius.circular(22),
                    ),
                  ),
                ),
                Row(
                  children: [
                    for (var i = 0; i < labels.length; i++) ...[
                      if (i > 0) const SizedBox(width: 5),
                      Expanded(
                        child: Semantics(
                          button: true,
                          selected: i == selected,
                          child: Pressable(
                            radius: 22,
                            ink: AtriaColors.blue700,
                            onTap: () => onChanged(i),
                            builder: (context, _) => Center(
                              child: AnimatedDefaultTextStyle(
                                duration: AtriaMotion.effectsDefaultDuration,
                                style: AtriaType.body(
                                  size: 14,
                                  weight: FontWeight.w600,
                                  color: i == selected ? Colors.white : P.ink2,
                                ),
                                child: Text(labels[i]),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

enum NoticeTone { info, error, success }

class Notice extends StatelessWidget {
  const Notice(this.text, {super.key, this.tone = NoticeTone.info});
  final String text;
  final NoticeTone tone;

  @override
  Widget build(BuildContext context) =>
      Note(text, error: tone == NoticeTone.error, icon: tone == NoticeTone.success ? 'check' : null);
}

/// The white glass card that holds a form (32:22): radius 30, padding 20.
class FormCard extends StatelessWidget {
  const FormCard({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children);
}
