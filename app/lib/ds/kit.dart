import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/expressive.dart';
import '../ui/icons.dart';
import '../ui/loading.dart';
import 'palette.dart';

/// The app's parts (2026-09-30 redesign). Every screen is built from these,
/// so a screen cannot drift into a colour or a shape of its own.

// ------------------------------------------------------------------ type
abstract final class T {
  static TextStyle hero({Color color = P.white, double size = 34}) =>
      AtriaType.display(size: size, weight: FontWeight.w700, color: color);
  static TextStyle title({Color color = P.ink, double size = 24}) =>
      AtriaType.display(size: size, weight: FontWeight.w700, color: color);
  static TextStyle heading({Color color = P.ink, double size = 17}) =>
      AtriaType.display(size: size, weight: FontWeight.w600, color: color);
  static TextStyle body({Color color = P.ink2, double size = 14.5, FontWeight weight = FontWeight.w500}) =>
      AtriaType.body(size: size, color: color, weight: weight, height: 1.5);
  static TextStyle strong({Color color = P.ink, double size = 14.5}) =>
      AtriaType.body(size: size, color: color, weight: FontWeight.w700, height: 1.35);
  static TextStyle small({Color color = P.ink3, double size = 12.5, FontWeight weight = FontWeight.w500}) =>
      AtriaType.body(size: size, color: color, weight: weight, height: 1.4);
  static TextStyle eyebrow({Color color = P.blue600}) =>
      AtriaType.body(size: 11.5, color: color, weight: FontWeight.w700, height: 1.2).copyWith(letterSpacing: 1.6);
}

/// "— SECTION": the landing page's eyebrow, a short rule and spaced capitals.
class Eyebrow extends StatelessWidget {
  const Eyebrow(this.text, {super.key, this.onDark = false});
  final String text;
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    final color = onDark ? P.blue300 : P.blue600;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 22,
          height: 2,
          decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(2)),
        ),
        const SizedBox(width: 10),
        Flexible(
          child: Text(text.toUpperCase(), style: T.eyebrow(color: color)),
        ),
      ],
    );
  }
}

// --------------------------------------------------------------- buttons
enum BtnKind { primary, light, tonal, outline, ghost, danger, glass, clear }

/// A pill button. Held, it shrinks and its corners tighten on the fast
/// spring, then it springs back past its size (M3 Expressive).
class Btn extends StatelessWidget {
  const Btn(
    this.label, {
    super.key,
    this.onPressed,
    this.kind = BtnKind.primary,
    this.icon,
    this.busy = false,
    this.expand = true,
    this.compact = false,
    this.leading,
  });
  final String label;
  final VoidCallback? onPressed;
  final BtnKind kind;
  final String? icon;
  final Widget? leading;
  final bool busy;
  final bool expand;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final off = onPressed == null && !busy;
    final (Color fill, Color ink, Color? edge) = switch (kind) {
      BtnKind.primary => (P.blue700, P.white, null),
      BtnKind.light => (P.white, P.blue800, null),
      BtnKind.tonal => (P.blue100, P.blue800, null),
      BtnKind.outline => (P.white, P.blue800, P.blue200),
      BtnKind.ghost => (const Color(0x00FFFFFF), P.blue700, null),
      BtnKind.danger => (P.white, P.danger, const Color(0xFFF1C3CB)),
      BtnKind.glass => (const Color(0x26FFFFFF), P.white, const Color(0x80FFFFFF)),
      BtnKind.clear => (const Color(0x00FFFFFF), P.white, null),
    };
    final height = compact ? 44.0 : 54.0;
    final lifted = kind == BtnKind.primary || kind == BtnKind.light;
    return Opacity(
      opacity: off ? .45 : 1,
      child: Pressable(
        onTap: busy ? null : onPressed,
        radius: height / 2,
        ink: ink,
        semanticLabel: label,
        builder: (context, pressed) => AnimatedContainer(
          duration: AtriaMotion.spatialFastDuration,
          curve: AtriaMotion.spatialFast,
          height: height,
          width: expand ? double.infinity : null,
          padding: EdgeInsets.symmetric(horizontal: compact ? 18 : 24),
          decoration: BoxDecoration(
            color: fill,
            borderRadius: BorderRadius.circular(pressed ? 16 : height / 2),
            border: edge == null ? null : Border.all(color: edge, width: 1.4),
            boxShadow: [
              BoxShadow(
                offset: const Offset(0, 10),
                blurRadius: 22,
                spreadRadius: -6,
                color: lifted && !off ? const Color(0x55123A8C) : const Color(0x00123A8C),
              ),
            ],
          ),
          child: ExcludeSemantics(
            child: Row(
              mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (busy)
                  SizedBox.square(dimension: 22, child: LoadingIndicator(size: 22, color: ink))
                else ...[
                  if (leading != null) ...[leading!, const SizedBox(width: 10)],
                  if (icon != null) ...[AtriaIcon(icon!, size: 17, color: ink), const SizedBox(width: 9)],
                  Flexible(
                    child: Text(
                      label,
                      overflow: TextOverflow.ellipsis,
                      style: AtriaType.body(
                        size: compact ? 13.5 : 15,
                        weight: FontWeight.w700,
                        color: ink,
                        height: 1.2,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A round icon button: back, close, more.
class RoundBtn extends StatelessWidget {
  const RoundBtn(this.icon, {super.key, required this.label, this.onPressed, this.onDark = false, this.size = 44});
  final String icon;
  final String label;
  final VoidCallback? onPressed;
  final bool onDark;
  final double size;

  @override
  Widget build(BuildContext context) => Pressable(
    onTap: onPressed,
    radius: size / 2,
    semanticLabel: label,
    ink: onDark ? P.white : P.ink,
    builder: (context, pressed) => AnimatedContainer(
      duration: AtriaMotion.spatialFastDuration,
      curve: AtriaMotion.spatialFast,
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: onDark ? const Color(0x24FFFFFF) : P.white,
        borderRadius: BorderRadius.circular(pressed ? size * .32 : size / 2),
        border: Border.all(color: onDark ? const Color(0x55FFFFFF) : P.line),
      ),
      child: Center(child: AtriaIcon(icon, size: 18, color: onDark ? P.white : P.ink)),
    ),
  );
}

// -------------------------------------------------------------- surfaces
/// A white card. The one surface the app uses; pressable when [onTap] is set.
class Surface extends StatelessWidget {
  const Surface({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(18),
    this.radius = 26,
    this.onTap,
    this.color = P.white,
    this.semanticLabel,
    this.shadow = true,
  });
  final Widget child;
  final EdgeInsetsGeometry padding;
  final double radius;
  final VoidCallback? onTap;
  final Color color;
  final String? semanticLabel;
  final bool shadow;

  @override
  Widget build(BuildContext context) {
    Widget box(bool pressed) => AnimatedContainer(
      duration: AtriaMotion.spatialFastDuration,
      curve: AtriaMotion.spatialFast,
      padding: padding,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(pressed ? radius * .7 : radius),
        border: Border.all(color: color == P.white ? const Color(0xFFE8EEF9) : color),
        boxShadow: shadow ? P.cardShadow : null,
      ),
      child: child,
    );
    if (onTap == null) return box(false);
    return Pressable(
      onTap: onTap,
      radius: radius,
      scale: .98,
      semanticLabel: semanticLabel,
      builder: (context, pressed) => box(pressed),
    );
  }
}

/// An icon in a soft blue circle, or a solid one when [solid].
class IconBubble extends StatelessWidget {
  const IconBubble(this.icon, {super.key, this.size = 42, this.solid = false, this.onDark = false});
  final String icon;
  final double size;
  final bool solid;
  final bool onDark;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(
      color: onDark
          ? const Color(0x26FFFFFF)
          : solid
          ? P.blue700
          : P.blue50,
      borderRadius: BorderRadius.circular(size * .36),
    ),
    child: Center(
      child: AtriaIcon(icon, size: size * .44, color: solid || onDark ? P.white : P.blue700),
    ),
  );
}

/// A row in a list: an icon, what it is, a line under it, and what is at its end.
class Item extends StatelessWidget {
  const Item({
    super.key,
    this.icon,
    this.leading,
    required this.title,
    this.sub,
    this.trailing,
    this.onTap,
    this.chevron,
    this.danger = false,
  });
  final String? icon;
  final Widget? leading;
  final String title;
  final String? sub;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool? chevron;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final row = Padding(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
      child: Row(
        children: [
          if (leading != null) ...[leading!, const SizedBox(width: 14)],
          if (icon != null && leading == null) ...[
            danger
                ? Container(
                    width: 42,
                    height: 42,
                    decoration: BoxDecoration(color: P.dangerSoft, borderRadius: BorderRadius.circular(15)),
                    child: Center(child: AtriaIcon(icon!, size: 18, color: P.danger)),
                  )
                : IconBubble(icon!),
            const SizedBox(width: 14),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: T.strong(color: danger ? P.danger : P.ink)),
                if (sub != null && sub!.isNotEmpty) ...[const SizedBox(height: 2), Text(sub!, style: T.small())],
              ],
            ),
          ),
          if (trailing != null) ...[const SizedBox(width: 10), trailing!],
          if (chevron ?? onTap != null) ...[
            const SizedBox(width: 8),
            const AtriaIcon('chevronRight', size: 16, color: P.ink4),
          ],
        ],
      ),
    );
    if (onTap == null) return Semantics(container: true, child: row);
    return Pressable(onTap: onTap, radius: 18, scale: .985, semanticLabel: title, builder: (_, _) => row);
  }
}

/// A hairline between rows of one card.
class Rule extends StatelessWidget {
  const Rule({super.key, this.indent = 56});
  final double indent;

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.only(left: indent),
    child: const Divider(height: 1, thickness: 1, color: P.line),
  );
}

// ------------------------------------------------------------------ pills
enum PillKind { solid, soft, quiet, alert, onDark }

/// A small label for state. Blue by weight: solid for what is live, soft for
/// what is set, quiet for what is over; red only for what needs attention.
class Pill extends StatelessWidget {
  const Pill(this.text, {super.key, this.kind = PillKind.soft, this.icon});
  final String text;
  final PillKind kind;
  final String? icon;

  @override
  Widget build(BuildContext context) {
    final (Color fill, Color ink) = switch (kind) {
      PillKind.solid => (P.blue700, P.white),
      PillKind.soft => (P.blue100, P.blue800),
      PillKind.quiet => (P.ground, P.ink3),
      PillKind.alert => (P.dangerSoft, P.danger),
      PillKind.onDark => (const Color(0x2EFFFFFF), P.white),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: fill,
        borderRadius: BorderRadius.circular(99),
        border: kind == PillKind.quiet ? Border.all(color: P.line) : null,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[AtriaIcon(icon!, size: 12, color: ink), const SizedBox(width: 5)],
          Text(
            text,
            style: AtriaType.body(size: 11.5, weight: FontWeight.w700, color: ink, height: 1.2),
          ),
        ],
      ),
    );
  }
}

// ------------------------------------------------------------- sections
class SectionHead extends StatelessWidget {
  const SectionHead(this.title, {super.key, this.action, this.onAction});
  final String title;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 12, top: 6),
    child: Row(
      children: [
        Expanded(child: Text(title, style: T.heading(size: 18))),
        if (action != null)
          Pressable(
            onTap: onAction,
            radius: 12,
            semanticLabel: action,
            builder: (_, _) => Padding(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
              child: Text(
                action!,
                style: T.small(color: P.blue700, weight: FontWeight.w700, size: 13),
              ),
            ),
          ),
      ],
    ),
  );
}

/// Nothing to show yet, and what to do about it.
class Empty extends StatelessWidget {
  const Empty({super.key, required this.icon, required this.title, this.sub, this.action, this.onAction});
  final String icon;
  final String title;
  final String? sub;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 12),
    child: Column(
      children: [
        IconBubble(icon, size: 58),
        const SizedBox(height: 14),
        Text(title, textAlign: TextAlign.center, style: T.heading()),
        if (sub != null) ...[
          const SizedBox(height: 6),
          Text(sub!, textAlign: TextAlign.center, style: T.small(size: 13.5)),
        ],
        if (action != null) ...[
          const SizedBox(height: 16),
          Btn(action!, onPressed: onAction, kind: BtnKind.tonal, expand: false, compact: true),
        ],
      ],
    ),
  );
}

/// A line of news on the page: blue for information, red for an error.
class Note extends StatelessWidget {
  const Note(this.text, {super.key, this.error = false, this.icon});
  final String text;
  final bool error;
  final String? icon;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: error ? P.dangerSoft : P.blue50, borderRadius: BorderRadius.circular(18)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AtriaIcon(icon ?? (error ? 'alert' : 'info'), size: 17, color: error ? P.danger : P.blue700),
          const SizedBox(width: 10),
          Expanded(
            child: Text(text, style: T.small(size: 13, color: error ? P.danger : P.ink2)),
          ),
        ],
      ),
    ),
  );
}

/// Centred loading, the M3 Expressive shape and what is loading.
class Loading extends StatelessWidget {
  const Loading(this.label, {super.key});
  final String label;

  @override
  Widget build(BuildContext context) => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        LoadingIndicator(label: label, color: P.blue600),
        const SizedBox(height: 14),
        Text(label, style: T.small()),
      ],
    ),
  );
}

// ---------------------------------------------------------------- fields
/// A text field: its label above, a soft blue well, a blue edge when focused.
class Field extends StatefulWidget {
  const Field({
    super.key,
    required this.label,
    this.controller,
    this.hint,
    this.keyboard,
    this.obscure = false,
    this.help,
    this.error,
    this.onChanged,
    this.onSubmitted,
    this.action,
    this.lines = 1,
    this.maxLength,
    this.autofill,
    this.formatters,
    this.prefix,
    this.enabled = true,
  });
  final String label;
  final TextEditingController? controller;
  final String? hint;
  final TextInputType? keyboard;
  final bool obscure;
  final String? help;
  final String? error;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final TextInputAction? action;
  final int lines;
  final int? maxLength;
  final Iterable<String>? autofill;
  final List<TextInputFormatter>? formatters;
  final String? prefix;
  final bool enabled;

  @override
  State<Field> createState() => _FieldState();
}

class _FieldState extends State<Field> {
  final focus = FocusNode();
  bool hidden = true;

  @override
  void initState() {
    super.initState();
    focus.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final on = focus.hasFocus;
    final bad = widget.error != null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          widget.label,
          style: T.small(color: P.ink2, weight: FontWeight.w700, size: 13),
        ),
        const SizedBox(height: 8),
        AnimatedContainer(
          duration: AtriaMotion.spatialFastDuration,
          curve: AtriaMotion.spatialFast,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          decoration: BoxDecoration(
            color: on ? P.white : P.blue50,
            borderRadius: BorderRadius.circular(on ? 20 : 18),
            border: Border.all(
              color: bad
                  ? P.danger
                  : on
                  ? P.blue600
                  : P.blue50,
              width: on ? 1.8 : 1.2,
            ),
          ),
          child: Row(
            children: [
              if (widget.prefix != null) ...[
                Text(widget.prefix!, style: T.strong(color: P.ink2)),
                const SizedBox(width: 8),
              ],
              Expanded(
                child: TextField(
                  controller: widget.controller,
                  focusNode: focus,
                  enabled: widget.enabled,
                  keyboardType: widget.keyboard,
                  obscureText: widget.obscure && hidden,
                  onChanged: widget.onChanged,
                  onSubmitted: widget.onSubmitted,
                  textInputAction: widget.action,
                  minLines: widget.lines,
                  maxLines: widget.obscure ? 1 : (widget.lines == 1 ? 1 : widget.lines + 3),
                  maxLength: widget.maxLength,
                  autofillHints: widget.autofill,
                  inputFormatters: widget.formatters,
                  onTapOutside: (_) => FocusManager.instance.primaryFocus?.unfocus(),
                  style: T.body(color: P.ink, size: 15),
                  cursorColor: P.blue700,
                  decoration: InputDecoration(
                    isDense: true,
                    border: InputBorder.none,
                    counterText: '',
                    contentPadding: const EdgeInsets.symmetric(vertical: 16),
                    hintText: widget.hint,
                    hintStyle: T.body(color: P.ink4, size: 15),
                  ),
                ),
              ),
              if (widget.obscure)
                Pressable(
                  onTap: () => setState(() => hidden = !hidden),
                  radius: 14,
                  semanticLabel: hidden ? 'Show password' : 'Hide password',
                  builder: (_, _) => Padding(
                    padding: const EdgeInsets.all(8),
                    child: AtriaIcon(hidden ? 'eye' : 'eyeOff', size: 18, color: P.ink3),
                  ),
                ),
            ],
          ),
        ),
        if (bad || widget.help != null) ...[
          const SizedBox(height: 6),
          Text(widget.error ?? widget.help!, style: T.small(color: bad ? P.danger : P.ink3, size: 12)),
        ],
      ],
    );
  }
}

// ------------------------------------------------------------- choosers
/// One row of choices that scrolls sideways. The chosen one fills blue and
/// its corners soften; the rest are quiet outlines.
class Choices<V> extends StatelessWidget {
  const Choices({super.key, required this.options, required this.value, required this.onChanged, this.onDark = false});
  final List<(V, String)> options;
  final V value;
  final ValueChanged<V> onChanged;
  final bool onDark;

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    scrollDirection: Axis.horizontal,
    clipBehavior: Clip.none,
    child: Row(
      children: [
        for (final (v, label) in options)
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: Semantics(
              selected: v == value,
              child: Pressable(
                onTap: () => onChanged(v),
                radius: 18,
                semanticLabel: label,
                builder: (_, pressed) {
                  final on = v == value;
                  return AnimatedContainer(
                    duration: AtriaMotion.spatialFastDuration,
                    curve: AtriaMotion.spatialFast,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                    decoration: BoxDecoration(
                      color: on ? (onDark ? P.white : P.blue700) : (onDark ? const Color(0x1FFFFFFF) : P.white),
                      borderRadius: BorderRadius.circular(on || pressed ? 14 : 99),
                      border: Border.all(
                        color: on ? (onDark ? P.white : P.blue700) : (onDark ? const Color(0x55FFFFFF) : P.line),
                      ),
                    ),
                    child: Text(
                      label,
                      style: AtriaType.body(
                        size: 13.5,
                        weight: FontWeight.w700,
                        height: 1.2,
                        color: on ? (onDark ? P.blue800 : P.white) : (onDark ? P.white : P.ink2),
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
      ],
    ),
  );
}

/// A choice shown as a card: title, a line, and a check when chosen.
class ChoiceCard extends StatelessWidget {
  const ChoiceCard({super.key, required this.title, this.sub, required this.on, required this.onTap, this.icon});
  final String title;
  final String? sub;
  final bool on;
  final VoidCallback onTap;
  final String? icon;

  @override
  Widget build(BuildContext context) => Semantics(
    selected: on,
    child: Pressable(
      onTap: onTap,
      radius: 22,
      scale: .98,
      semanticLabel: [title, sub].whereType<String>().join(', '),
      builder: (_, pressed) => AnimatedContainer(
        duration: AtriaMotion.spatialFastDuration,
        curve: AtriaMotion.spatialFast,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: on ? P.blue50 : P.white,
          borderRadius: BorderRadius.circular(on || pressed ? 18 : 24),
          border: Border.all(color: on ? P.blue600 : P.line, width: on ? 1.8 : 1.2),
        ),
        child: Row(
          children: [
            if (icon != null) ...[IconBubble(icon!, solid: on, size: 40), const SizedBox(width: 12)],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: T.strong()),
                  if (sub != null) ...[const SizedBox(height: 2), Text(sub!, style: T.small())],
                ],
              ),
            ),
            AnimatedScale(
              scale: on ? 1 : 0,
              duration: AtriaMotion.spatialFastDuration,
              curve: AtriaMotion.spatialFast,
              child: Container(
                width: 24,
                height: 24,
                decoration: const BoxDecoration(color: P.blue700, shape: BoxShape.circle),
                child: const Center(child: AtriaIcon('checkMark', size: 13, color: P.white)),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

/// A tick box with its words beside it.
class Tick extends StatelessWidget {
  const Tick({super.key, required this.value, required this.onChanged, required this.child});
  final bool value;
  final ValueChanged<bool> onChanged;
  final Widget child;

  @override
  Widget build(BuildContext context) => Semantics(
    checked: value,
    child: Pressable(
      onTap: () => onChanged(!value),
      radius: 12,
      builder: (_, _) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AnimatedContainer(
              duration: AtriaMotion.spatialFastDuration,
              curve: AtriaMotion.spatialFast,
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                color: value ? P.blue700 : P.white,
                borderRadius: BorderRadius.circular(value ? 12 : 8),
                border: Border.all(color: value ? P.blue700 : P.ink4, width: 1.6),
              ),
              child: value ? const Center(child: AtriaIcon('checkMark', size: 13, color: P.white)) : null,
            ),
            const SizedBox(width: 12),
            Expanded(child: child),
          ],
        ),
      ),
    ),
  );
}

/// A two-state switch drawn in the palette.
class Toggle extends StatelessWidget {
  const Toggle({super.key, required this.value, required this.onChanged, required this.label});
  final bool value;
  final ValueChanged<bool>? onChanged;
  final String label;

  @override
  Widget build(BuildContext context) => Semantics(
    toggled: value,
    label: label,
    child: Pressable(
      onTap: onChanged == null ? null : () => onChanged!(!value),
      radius: 16,
      builder: (_, pressed) => AnimatedContainer(
        duration: AtriaMotion.spatialFastDuration,
        curve: AtriaMotion.spatialFast,
        width: 52,
        height: 32,
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(color: value ? P.blue700 : P.blue100, borderRadius: BorderRadius.circular(16)),
        child: AnimatedAlign(
          duration: AtriaMotion.spatialFastDuration,
          curve: AtriaMotion.spatialFast,
          alignment: value ? Alignment.centerRight : Alignment.centerLeft,
          child: AnimatedContainer(
            duration: AtriaMotion.spatialFastDuration,
            curve: AtriaMotion.spatialFast,
            width: pressed ? 28 : 24,
            height: 24,
            decoration: BoxDecoration(color: value ? P.white : P.ink4, borderRadius: BorderRadius.circular(12)),
          ),
        ),
      ),
    ),
  );
}

// --------------------------------------------------------- sheets, toasts
/// A sheet from the bottom: white, a handle, a title, its content.
Future<R?> showSheet<R>(
  BuildContext context, {
  required String title,
  String? sub,
  required Widget Function(BuildContext context) builder,
}) => showModalBottomSheet<R>(
  context: context,
  isScrollControlled: true,
  backgroundColor: Colors.transparent,
  barrierColor: const Color(0x660B2462),
  builder: (context) => Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
    child: Container(
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * .9),
      decoration: const BoxDecoration(
        color: P.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                margin: const EdgeInsets.only(top: 10, bottom: 14),
                width: 40,
                height: 5,
                decoration: BoxDecoration(color: P.line, borderRadius: BorderRadius.circular(3)),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(22, 0, 22, 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: T.title(size: 21)),
                  if (sub != null) ...[const SizedBox(height: 6), Text(sub, style: T.body(size: 14))],
                ],
              ),
            ),
            Flexible(
              child: SingleChildScrollView(padding: const EdgeInsets.fromLTRB(22, 14, 22, 18), child: builder(context)),
            ),
          ],
        ),
      ),
    ),
  ),
);

/// Ask before something that matters. Returns true when confirmed.
Future<bool> confirmAction(
  BuildContext context, {
  required String title,
  required String body,
  required String confirm,
  String cancel = 'Keep it',
  bool danger = false,
}) async =>
    await showSheet<bool>(
      context,
      title: title,
      sub: body,
      builder: (context) => Column(
        children: [
          Btn(
            confirm,
            kind: danger ? BtnKind.danger : BtnKind.primary,
            onPressed: () => Navigator.of(context).pop(true),
          ),
          const SizedBox(height: 10),
          Btn(cancel, kind: BtnKind.ghost, onPressed: () => Navigator.of(context).pop(false)),
        ],
      ),
    ) ??
    false;

/// A short message at the bottom of the screen.
void toast(BuildContext context, String text) => say(context, text);
