import 'dart:math' as math;
import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/tokens.dart';

/// Material 3 Expressive motion for the app, the same as the web's
/// (web/src/styles/motion.css, ADR 0019): every pressable thing has a state
/// layer, shrinks a little and tightens its corners while held, and springs
/// back past its size on release; screens rise in; light drifts behind the
/// glass. Reduced motion (the platform setting) keeps the state layer only.
bool reduceMotion(BuildContext context) => MediaQuery.maybeDisableAnimationsOf(context) ?? false;

/// Anything that can be pressed. [builder] is told whether it is held, so a
/// button can morph its corner radius on the fast spatial spring, as the web's
/// `:active { border-radius }` does; the scale and the state layer are
/// Pressable's own.
class Pressable extends StatefulWidget {
  const Pressable({
    super.key,
    required this.builder,
    this.onTap,
    this.onLongPress,
    this.radius = 18,
    this.scale = .97,
    this.ink = AtriaColors.inkPrimary,
    this.semanticLabel,
    this.haptic = true,
  });

  final Widget Function(BuildContext context, bool pressed) builder;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  /// The resting radius of the state layer; it follows the pressed morph.
  final double radius;
  final double scale;

  /// The colour of the state layer: the element's own ink, at 10% held.
  final Color ink;
  final String? semanticLabel;
  final bool haptic;

  @override
  State<Pressable> createState() => _PressableState();
}

class _PressableState extends State<Pressable> {
  bool pressed = false;

  void _set(bool value) {
    if (pressed != value) setState(() => pressed = value);
  }

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onTap != null || widget.onLongPress != null;
    final still = reduceMotion(context);
    final radius = pressed ? widget.radius * .66 : widget.radius;
    return Semantics(
      // Its own node, sized to itself: a label never merges into the row it
      // sits in, so a screen reader activates the control, not empty space.
      container: true,
      button: enabled,
      enabled: enabled,
      label: widget.semanticLabel,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: enabled ? (_) => _set(true) : null,
        onTapCancel: () => _set(false),
        onTapUp: enabled ? (_) => _set(false) : null,
        onTap: enabled
            ? () {
                if (widget.haptic) HapticFeedback.selectionClick();
                widget.onTap?.call();
              }
            : null,
        onLongPress: widget.onLongPress,
        child: AnimatedScale(
          scale: pressed && !still ? widget.scale : 1,
          duration: AtriaMotion.spatialFastDuration,
          curve: AtriaMotion.spatialFast,
          child: Stack(
            // The content keeps the constraints it was given: a tab fills its slot.
            fit: StackFit.passthrough,
            children: [
              widget.builder(context, pressed && !still),
              Positioned.fill(
                child: IgnorePointer(
                  child: AnimatedContainer(
                    duration: AtriaMotion.spatialFastDuration,
                    curve: AtriaMotion.spatialFast,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(radius),
                      color: widget.ink.withValues(alpha: pressed ? .1 : 0),
                    ),
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

/// The light that drifts behind the glass (motion.css, "light that drifts
/// behind glass"): soft blurred orbs, each on its own slow loop, so the glass
/// above always has something moving to blur. Still under reduced motion.
class DriftingLight extends StatefulWidget {
  const DriftingLight({super.key, required this.orbs});
  final List<Orb> orbs;

  @override
  State<DriftingLight> createState() => _DriftingLightState();
}

class Orb {
  const Orb({required this.left, required this.top, required this.size, required this.color, this.drift = 26});
  final double left;
  final double top;
  final double size;
  final Color color;

  /// How far the orb wanders from where it rests.
  final double drift;
}

class _DriftingLightState extends State<DriftingLight> with SingleTickerProviderStateMixin {
  late final AnimationController loop = AnimationController(vsync: this, duration: const Duration(seconds: 22));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (reduceMotion(context)) {
      loop.stop();
    } else if (!loop.isAnimating) {
      loop.repeat();
    }
  }

  @override
  void dispose() {
    loop.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: loop,
    builder: (context, _) {
      final t = loop.value * 2 * math.pi;
      return Stack(
        clipBehavior: Clip.none,
        children: [
          for (var i = 0; i < widget.orbs.length; i++)
            Positioned(
              left: widget.orbs[i].left + widget.orbs[i].drift * math.sin(t + i * 2.1),
              top: widget.orbs[i].top + widget.orbs[i].drift * .7 * math.cos(t * (i.isEven ? 1 : -1) + i),
              child: ImageFiltered(
                imageFilter: ImageFilter.blur(sigmaX: 26, sigmaY: 26, tileMode: TileMode.decal),
                child: Container(
                  width: widget.orbs[i].size,
                  height: widget.orbs[i].size,
                  decoration: BoxDecoration(shape: BoxShape.circle, color: widget.orbs[i].color),
                ),
              ),
            ),
        ],
      );
    },
  );
}

/// A screen arriving: it rises 22 and fades in on the default spatial
/// spring, as the web's screens do; leaving, it fades on the effects spring.
class ExpressivePageTransitions extends PageTransitionsBuilder {
  const ExpressivePageTransitions();

  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    if (reduceMotion(context)) return FadeTransition(opacity: animation, child: child);
    final rise = CurvedAnimation(
      parent: animation,
      curve: AtriaMotion.spatialDefault,
      reverseCurve: AtriaMotion.effects,
    );
    final fade = CurvedAnimation(parent: animation, curve: AtriaMotion.effects);
    final under = CurvedAnimation(parent: secondaryAnimation, curve: AtriaMotion.effects);
    return FadeTransition(
      opacity: Tween(begin: 1.0, end: .6).animate(under),
      child: ScaleTransition(
        scale: Tween(begin: 1.0, end: .97).animate(under),
        child: FadeTransition(
          opacity: fade,
          child: AnimatedBuilder(
            animation: rise,
            builder: (context, child) => Transform.translate(offset: Offset(0, 22 * (1 - rise.value)), child: child),
            child: child,
          ),
        ),
      ),
    );
  }

  @override
  Duration get transitionDuration => AtriaMotion.spatialDefaultDuration;
}

/// Swapping one tab's screen for another inside the shell: Material's fade
/// through, the old one fading out and the new one scaling up from 96%.
class FadeThrough extends StatelessWidget {
  const FadeThrough({super.key, required this.id, required this.child});
  final Object id;
  final Widget child;

  @override
  Widget build(BuildContext context) => AnimatedSwitcher(
    duration: AtriaMotion.spatialDefaultDuration,
    switchInCurve: AtriaMotion.spatialDefault,
    switchOutCurve: AtriaMotion.effects,
    transitionBuilder: (child, animation) => FadeTransition(
      opacity: CurvedAnimation(
        parent: animation,
        curve: const Interval(.3, 1, curve: AtriaMotion.effects),
      ),
      child: ScaleTransition(scale: Tween(begin: .96, end: 1.0).animate(animation), child: child),
    ),
    layoutBuilder: (current, previous) => Stack(children: [...previous, ?current]),
    child: KeyedSubtree(key: ValueKey(id), child: child),
  );
}

/// A number or badge that pops when it changes (motion.css, digits that pop).
class Pop extends StatelessWidget {
  const Pop({super.key, required this.value, required this.child});
  final Object value;
  final Widget child;

  @override
  Widget build(BuildContext context) => AnimatedSwitcher(
    duration: AtriaMotion.spatialFastDuration,
    switchInCurve: AtriaMotion.spatialFast,
    transitionBuilder: (child, animation) => ScaleTransition(scale: animation, child: child),
    child: KeyedSubtree(key: ValueKey(value), child: child),
  );
}

/// A pressable surface: its colour or gradient, border and shadow, with the
/// corners tightening while held and the shadow settling closer (the web's
/// active-state morph), on the fast spatial spring.
class PressableSurface extends StatelessWidget {
  const PressableSurface({
    super.key,
    required this.child,
    required this.onTap,
    this.radius = 16,
    this.color,
    this.gradient,
    this.border,
    this.shadow,
    this.ink = AtriaColors.inkPrimary,
    this.height,
    this.width,
    this.padding,
    this.semanticLabel,
  });
  final Widget child;
  final VoidCallback? onTap;
  final double radius;
  final Color? color;
  final Gradient? gradient;
  final BoxBorder? border;
  final BoxShadow? shadow;
  final Color ink;
  final double? height;
  final double? width;
  final EdgeInsetsGeometry? padding;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) => Pressable(
    onTap: onTap,
    radius: radius,
    ink: ink,
    semanticLabel: semanticLabel,
    builder: (context, pressed) => AnimatedContainer(
      duration: AtriaMotion.spatialFastDuration,
      curve: AtriaMotion.spatialFast,
      height: height,
      width: width,
      padding: padding,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: color,
        gradient: gradient,
        border: border,
        borderRadius: BorderRadius.circular(pressed ? radius * .66 : radius),
        boxShadow: shadow == null
            ? null
            : [
                pressed
                    ? BoxShadow(offset: shadow!.offset / 2, blurRadius: shadow!.blurRadius * .6, color: shadow!.color)
                    : shadow!,
              ],
      ),
      child: semanticLabel == null ? child : ExcludeSemantics(child: child),
    ),
  );
}

/// A gentle bob, for glass that floats over the field (Onboarding, 31:10):
/// up and down by [distance] on a slow effects curve, each at its own phase.
class Float extends StatefulWidget {
  const Float({super.key, required this.child, this.phase = 0, this.distance = 6});
  final Widget child;
  final double phase;
  final double distance;

  @override
  State<Float> createState() => _FloatState();
}

class _FloatState extends State<Float> with SingleTickerProviderStateMixin {
  late final AnimationController loop = AnimationController(vsync: this, duration: const Duration(seconds: 6));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (reduceMotion(context)) {
      loop.stop();
    } else if (!loop.isAnimating) {
      loop.repeat();
    }
  }

  @override
  void dispose() {
    loop.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: loop,
    builder: (context, child) => Transform.translate(
      offset: Offset(0, widget.distance * math.sin((loop.value + widget.phase) * 2 * math.pi)),
      child: child,
    ),
    child: widget.child,
  );
}

/// A short confirmation, floating above the bottom bar on the fast spring,
/// as the web's snackbar: dark, rounded, dismissed on its own.
void say(BuildContext context, String text) {
  final messenger = ScaffoldMessenger.of(context);
  messenger.hideCurrentSnackBar();
  messenger.showSnackBar(
    SnackBar(
      content: Text(text),
      behavior: SnackBarBehavior.floating,
      margin: const EdgeInsets.fromLTRB(20, 0, 20, 108),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      backgroundColor: const Color(0xF20D1B34),
      duration: const Duration(seconds: 4),
    ),
  );
}
