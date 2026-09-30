import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/theme.dart';
import '../theme/tokens.dart';
import 'expressive.dart';
import 'icons.dart';
import '../ui/loading.dart';

/// Rises into place on a Material spring, 30 ms apart per row (ADR 0019).
/// Reduced motion skips it.
class Rise extends StatelessWidget {
  const Rise({super.key, required this.child, this.index = 0});
  final Widget child;
  final int index;

  // Each part of a screen rises 12 on the default spatial spring and fades
  // on the effects spring, 30ms after the one above it; past the sixth, all
  // arrive together, so a long screen is never still waiting to appear.
  static const _step = 30;
  static const _travel = 12.0;

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) return child;
    final delay = _step * index.clamp(0, 6);
    final run = AtriaMotion.spatialDefaultDuration.inMilliseconds;
    final total = Duration(milliseconds: run + delay);
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: total,
      builder: (context, t, child) {
        final local = ((t * total.inMilliseconds - delay) / run).clamp(0.0, 1.0);
        final move = AtriaMotion.spatialDefault.transform(local);
        // The fade is done in the first half, while the spring does its travel.
        final fade = AtriaMotion.effects.transform((local * 2).clamp(0.0, 1.0));
        return Opacity(
          opacity: fade,
          child: Transform.translate(offset: Offset(0, _travel * (1 - move)), child: child),
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
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: cssGradient(163, const [Color(0xFFDDE9FE), Color(0xFFF2F6FE), Color(0xFFE4EDFD)], [.057, .465, .943]),
      ),
      child: Stack(
        children: [
          // The three orbs of 32:3 to 32:5, drifting slowly behind the glass.
          Positioned.fill(
            child: LayoutBuilder(
              builder: (context, box) => DriftingLight(
                orbs: [
                  const Orb(left: -100, top: -110, size: 300, color: Color(0x996098FF)),
                  Orb(left: box.maxWidth - 160, top: 230, size: 260, color: const Color(0x998CB6FF), drift: 34),
                  Orb(left: -40, top: box.maxHeight - 160, size: 320, color: const Color(0x426EA0FA)),
                ],
              ),
            ),
          ),
          Positioned.fill(child: BackdropGroup(child: child)),
        ],
      ),
    );
  }
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
      gradient: cssGradient(145, const [AtriaColors.blue500, Color(0xFF2159D2)], [.141, .859]),
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
    this.prefixText,
    this.formatters,
    this.trailing,
    this.readOnly = false,
  });
  final String label;
  final String icon;

  /// Fixed text before what is typed, such as the country's dial code.
  final String? prefixText;
  final List<TextInputFormatter>? formatters;

  /// A button at the end of the field, such as a calendar.
  final Widget? trailing;

  /// Shown but not changed here; the field greys to say so.
  final bool readOnly;

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
  late bool hidden = widget.obscure;

  @override
  Widget build(BuildContext context) {
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(17),
      borderSide: const BorderSide(color: AtriaColors.lineHairline, width: 1.5),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          widget.label,
          style: AtriaType.body(size: 12, weight: FontWeight.w600, color: AtriaColors.inkSoft),
        ),
        const SizedBox(height: 7),
        SizedBox(
          height: 54,
          child: TextField(
            onTapOutside: (_) => FocusManager.instance.primaryFocus?.unfocus(),
            controller: widget.controller,
            readOnly: widget.readOnly,
            obscureText: hidden,
            keyboardType: widget.keyboard,
            autofillHints: widget.autofill,
            textInputAction: widget.action,
            onSubmitted: widget.onSubmitted,
            textCapitalization: widget.capitalization,
            inputFormatters: widget.formatters,
            textAlignVertical: TextAlignVertical.center,
            style: AtriaType.body(size: 14.5, color: AtriaColors.inkPrimary, height: 1.2),
            decoration: InputDecoration(
              isDense: true,
              hintText: widget.hint,
              hintStyle: AtriaType.body(size: 14.5, color: const Color(0xFF9AA9C4), height: 1.2),
              filled: true,
              fillColor: widget.readOnly ? AtriaColors.surfaceField : AtriaColors.surfaceWhite,
              contentPadding: const EdgeInsets.symmetric(horizontal: 15, vertical: 17),
              prefixIconConstraints: const BoxConstraints(minWidth: 42),
              prefixIcon: Padding(
                padding: const EdgeInsets.only(left: 15, right: 10),
                child: AtriaIcon(widget.icon, color: AtriaColors.blue600),
              ),
              prefixText: widget.prefixText,
              prefixStyle: AtriaType.body(size: 14.5, weight: FontWeight.w700, color: AtriaColors.ink800, height: 1.2),
              suffixIcon:
                  widget.trailing ??
                  (widget.obscure
                      ? IconButton(
                          tooltip: hidden ? 'Show password' : 'Hide password',
                          icon: AtriaIcon(hidden ? 'eye' : 'eyeOff', color: AtriaColors.blue600),
                          onPressed: () => setState(() => hidden = !hidden),
                        )
                      : null),
              enabledBorder: widget.error == null
                  ? border
                  : border.copyWith(borderSide: const BorderSide(color: AtriaColors.cancelled, width: 1.5)),
              focusedBorder: border.copyWith(
                borderSide: BorderSide(
                  color: widget.error == null ? AtriaColors.blue500 : AtriaColors.cancelled,
                  width: 1.5,
                ),
              ),
            ),
          ),
        ),
        if (widget.error != null) ...[
          const SizedBox(height: 6),
          Semantics(
            liveRegion: true,
            child: Text(
              widget.error!,
              style: AtriaType.body(size: 11.5, color: AtriaColors.cancelledInk, height: 1.35),
            ),
          ),
        ] else if (widget.help != null) ...[
          const SizedBox(height: 6),
          Text(
            widget.help!,
            style: AtriaType.body(size: 10.5, color: const Color(0xFF8497B8), height: 15 / 10.5),
          ),
        ],
      ],
    );
  }
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
  Widget build(BuildContext context) {
    final enabled = widget.onPressed != null && !widget.busy;
    return Pressable(
      onTap: enabled ? widget.onPressed : null,
      radius: 19,
      ink: Colors.white,
      semanticLabel: widget.label,
      builder: (context, pressed) => AnimatedContainer(
        duration: AtriaMotion.spatialFastDuration,
        curve: AtriaMotion.spatialFast,
        height: 56,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          gradient: !(enabled || widget.busy)
              ? AtriaGradients.disabled
              : widget.danger
              ? cssGradient(160, const [Color(0xFFE8606F), Color(0xFFC33C4E)])
              : cssGradient(171, const [AtriaColors.blue500, AtriaColors.blue700], [.145, .855]),
          borderRadius: BorderRadius.circular(pressed ? 12 : 19),
          // Always one shadow, faded out rather than removed: removing it
          // lerps the blur towards nothing, and the spring's overshoot then
          // asks for a negative blur, which Flutter refuses.
          boxShadow: [
            BoxShadow(
              offset: Offset(0, pressed ? 5 : 10),
              blurRadius: pressed ? 14 : 22,
              color: !enabled
                  ? const Color(0x002461DB)
                  : widget.danger
                  ? const Color(0x4DC8384A)
                  : const Color(0x572461DB),
            ),
          ],
        ),
        child: AnimatedSwitcher(
          duration: AtriaMotion.effectsDefaultDuration,
          child: widget.busy
              ? LoadingIndicator(key: const ValueKey('busy'), size: 24, color: Colors.white, label: widget.label)
              : ExcludeSemantics(
                  key: const ValueKey('label'),
                  child: Text(
                    widget.label,
                    style: AtriaType.body(size: 15, weight: FontWeight.w600, color: Colors.white),
                  ),
                ),
        ),
      ),
    );
  }
}

/// A white outlined action (32:53), 56 high, radius 19.
class SecondaryButton extends StatelessWidget {
  const SecondaryButton({super.key, required this.label, required this.onPressed, this.leading});
  final String label;
  final VoidCallback? onPressed;
  final Widget? leading;

  @override
  Widget build(BuildContext context) => Pressable(
    onTap: onPressed,
    radius: 19,
    ink: AtriaColors.blue700,
    semanticLabel: label,
    builder: (context, pressed) => AnimatedContainer(
      duration: AtriaMotion.spatialFastDuration,
      curve: AtriaMotion.spatialFast,
      height: 56,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(pressed ? 12 : 19),
        border: Border.all(color: AtriaColors.lineHairline, width: 1.5),
      ),
      child: ExcludeSemantics(
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const SizedBox(width: 12),
            if (leading != null) ...[leading!, const SizedBox(width: 11)],
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AtriaType.body(
                  size: 14.5,
                  weight: FontWeight.w600,
                  color: onPressed == null ? AtriaColors.inkSoft : const Color(0xFF22304D),
                ),
              ),
            ),
            const SizedBox(width: 12),
          ],
        ),
      ),
    ),
  );
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
        gradient: cssGradient(172, const [Color(0xE6FFFFFF), Color(0x9EFFFFFF)], [.145, .855]),
        borderRadius: BorderRadius.circular(19),
        border: Border.all(color: Colors.white),
        boxShadow: const [BoxShadow(offset: Offset(0, 2), blurRadius: 10, color: Color(0x120F295E))],
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
                      gradient: cssGradient(167, const [AtriaColors.blue500, AtriaColors.blue700], [.145, .855]),
                      borderRadius: BorderRadius.circular(22),
                      boxShadow: const [BoxShadow(offset: Offset(0, 6), blurRadius: 16, color: Color(0x522461DB))],
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
                                  color: i == selected ? Colors.white : const Color(0xFF4B5D80),
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
  Widget build(BuildContext context) {
    final (colour, ink, icon) = switch (tone) {
      NoticeTone.error => (AtriaColors.cancelled, AtriaColors.cancelledInk, 'alert'),
      NoticeTone.success => (AtriaColors.confirmed, AtriaColors.confirmedInk, 'check'),
      NoticeTone.info => (AtriaColors.blue600, AtriaColors.bookedInk, 'info'),
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
            AtriaIcon(icon, size: 18, color: ink),
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

/// The white glass card that holds a form (32:22): radius 30, padding 20.
class FormCard extends StatelessWidget {
  const FormCard({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      gradient: cssGradient(147, const [Color(0xF2FFFFFF), Color(0xBDFFFFFF)], [.134, .866]),
      borderRadius: BorderRadius.circular(30),
      border: Border.all(color: Colors.white),
      boxShadow: const [BoxShadow(offset: Offset(0, 8), blurRadius: 28, color: Color(0x1F102A5E))],
    ),
    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
  );
}
