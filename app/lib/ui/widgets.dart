import 'package:flutter/material.dart';

import '../theme/theme.dart';
import '../theme/tokens.dart';

/// Rises into place on a Material spring, the way every web screen enters
/// (ADR 0019). [index] staggers siblings.
class Rise extends StatelessWidget {
  const Rise({super.key, required this.child, this.index = 0});
  final Widget child;
  final int index;

  @override
  Widget build(BuildContext context) {
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

/// The Atria mark: the pulse on the brand gradient.
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 46});
  final double size;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(
      gradient: AtriaGradients.primary,
      borderRadius: BorderRadius.circular(size * 0.33),
      boxShadow: AtriaShadows.primary,
    ),
    child: CustomPaint(painter: _Pulse(), size: Size.square(size)),
  );
}

/// The pulse from web/src/components/icons.tsx: M2 12h4.5l2.5-5 4 10 2.5-5H22.
class _Pulse extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final unit = size.width * 0.46 / 24;
    final origin = Offset(size.width * 0.27, size.height * 0.27);
    Offset at(double x, double y) => origin + Offset(x * unit, y * unit);
    final path = Path()
      ..moveTo(at(2, 12).dx, at(2, 12).dy)
      ..lineTo(at(6.5, 12).dx, at(6.5, 12).dy)
      ..lineTo(at(9, 7).dx, at(9, 7).dy)
      ..lineTo(at(13, 17).dx, at(13, 17).dy)
      ..lineTo(at(15.5, 12).dx, at(15.5, 12).dy)
      ..lineTo(at(22, 12).dx, at(22, 12).dy);
    canvas.drawPath(
      path,
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.2 * unit
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
  }

  @override
  bool shouldRepaint(_Pulse old) => false;
}

/// A labelled text field, from the Rev A sign-in frames.
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
  });
  final String label;
  final IconData icon;
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
  late bool hidden = widget.obscure;

  @override
  Widget build(BuildContext context) {
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(AtriaRadius.s),
      borderSide: const BorderSide(color: AtriaColors.lineHairline, width: 1.5),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(widget.label, style: AtriaType.label()),
        const SizedBox(height: 7),
        TextField(
          controller: widget.controller,
          obscureText: hidden,
          keyboardType: widget.keyboard,
          autofillHints: widget.autofill,
          textInputAction: widget.action,
          onSubmitted: widget.onSubmitted,
          style: AtriaType.body(size: 14.5, color: AtriaColors.inkPrimary),
          decoration: InputDecoration(
            isDense: true,
            hintText: widget.hint,
            hintStyle: AtriaType.body(size: 14.5, color: AtriaColors.ink400),
            filled: true,
            fillColor: AtriaColors.surfaceWhite,
            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            prefixIcon: Icon(widget.icon, size: 18, color: AtriaColors.blue600),
            suffixIcon: widget.obscure
                ? IconButton(
                    tooltip: hidden ? 'Show password' : 'Hide password',
                    icon: Icon(
                      hidden ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                      size: 18,
                      color: AtriaColors.blue600,
                    ),
                    onPressed: () => setState(() => hidden = !hidden),
                  )
                : null,
            enabledBorder: border,
            focusedBorder: border.copyWith(borderSide: const BorderSide(color: AtriaColors.blue500, width: 1.5)),
          ),
        ),
      ],
    );
  }
}

/// The primary action: a gradient button that greys out while it cannot act.
class PrimaryButton extends StatelessWidget {
  const PrimaryButton({super.key, required this.label, required this.onPressed, this.busy = false});
  final String label;
  final VoidCallback? onPressed;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !busy;
    return AnimatedContainer(
      duration: AtriaMotion.effectsDefaultDuration,
      curve: AtriaMotion.effects,
      height: AtriaSpace.controlL,
      decoration: BoxDecoration(
        gradient: enabled || busy ? AtriaGradients.primary : AtriaGradients.disabled,
        borderRadius: BorderRadius.circular(AtriaRadius.s + 2),
        boxShadow: enabled ? AtriaShadows.primary : null,
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(AtriaRadius.s + 2),
          onTap: enabled ? onPressed : null,
          child: Center(
            child: busy
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
                  )
                : Text(
                    label,
                    style: AtriaType.body(size: 15, weight: FontWeight.w700, color: Colors.white),
                  ),
          ),
        ),
      ),
    );
  }
}

/// Two choices on a glass switch, the selected one on a sliding pill.
class Segmented extends StatelessWidget {
  const Segmented({super.key, required this.labels, required this.selected, required this.onChanged});
  final List<String> labels;
  final int selected;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 54,
      padding: const EdgeInsets.all(5),
      decoration: BoxDecoration(
        gradient: AtriaGradients.glassSwitch,
        borderRadius: BorderRadius.circular(AtriaRadius.m),
        border: Border.all(color: Colors.white, width: 1.5),
        boxShadow: AtriaShadows.panel,
      ),
      child: LayoutBuilder(
        builder: (context, box) {
          final width = box.maxWidth / labels.length;
          return Stack(
            children: [
              AnimatedPositioned(
                duration: AtriaMotion.spatialDefaultDuration,
                curve: AtriaMotion.spatialDefault,
                left: width * selected,
                width: width,
                top: 0,
                bottom: 0,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: AtriaGradients.primary,
                    borderRadius: BorderRadius.circular(AtriaRadius.m - 5),
                    boxShadow: AtriaShadows.primary,
                  ),
                ),
              ),
              Row(
                children: [
                  for (var i = 0; i < labels.length; i++)
                    Expanded(
                      child: Semantics(
                        button: true,
                        selected: i == selected,
                        child: InkWell(
                          borderRadius: BorderRadius.circular(AtriaRadius.m - 5),
                          onTap: () => onChanged(i),
                          child: Center(
                            child: AnimatedDefaultTextStyle(
                              duration: AtriaMotion.effectsDefaultDuration,
                              style: AtriaType.body(
                                size: 13.5,
                                weight: FontWeight.w600,
                                color: i == selected ? Colors.white : AtriaColors.ink800,
                              ),
                              child: Text(labels[i]),
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ],
          );
        },
      ),
    );
  }
}

class AtriaCheckbox extends StatelessWidget {
  const AtriaCheckbox({super.key, required this.value, required this.onChanged, required this.label});
  final bool value;
  final ValueChanged<bool> onChanged;
  final String label;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: () => onChanged(!value),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            AnimatedContainer(
              duration: AtriaMotion.spatialFastDuration,
              curve: AtriaMotion.spatialFast,
              width: 20,
              height: 20,
              decoration: BoxDecoration(
                color: value ? AtriaColors.blue600 : Colors.white,
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: value ? AtriaColors.blue600 : AtriaColors.lineSoft, width: 1.5),
              ),
              child: value ? const Icon(Icons.check, size: 14, color: Colors.white) : null,
            ),
            const SizedBox(width: 9),
            Text(
              label,
              style: AtriaType.body(size: 13, weight: FontWeight.w600, color: AtriaColors.ink800),
            ),
          ],
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
  Widget build(BuildContext context) {
    final (colour, ink, icon) = switch (tone) {
      NoticeTone.error => (AtriaColors.cancelled, AtriaColors.cancelledInk, Icons.error_outline),
      NoticeTone.success => (AtriaColors.confirmed, AtriaColors.confirmedInk, Icons.check_circle_outline),
      NoticeTone.info => (AtriaColors.blue600, AtriaColors.bookedInk, Icons.info_outline),
    };
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: colour.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(AtriaRadius.s),
          border: Border.all(color: colour.withValues(alpha: 0.25)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 18, color: ink),
            const SizedBox(width: 10),
            Expanded(
              child: Text(text, style: AtriaType.body(size: 13, color: ink, height: 1.45)),
            ),
          ],
        ),
      ),
    );
  }
}

/// The white glass card that holds a form.
class FormCard extends StatelessWidget {
  const FormCard({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(AtriaSpace.s4),
    decoration: BoxDecoration(
      gradient: AtriaGradients.glassCard,
      borderRadius: BorderRadius.circular(AtriaRadius.m + 2),
      border: Border.all(color: Colors.white, width: 1.5),
      boxShadow: AtriaShadows.raised,
    ),
    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
  );
}
