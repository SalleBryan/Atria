import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';

import '../theme/tokens.dart';
import 'expressive.dart';

/// Glass, as the web's `.glass` draws it (web/src/styles/patient.css): white
/// from 93% to 70% on a slant, a white hairline, a bright inner top edge, a
/// soft blue-cast shadow, and the page behind blurred by 26. Pressable glass
/// shrinks and tightens its corners while held and springs back (Pressable).
class Glass extends StatelessWidget {
  const Glass({
    super.key,
    required this.child,
    this.radius = 24,
    this.padding = EdgeInsets.zero,
    this.onTap,
    this.from = 0.93,
    this.to = 0.70,
    this.height,
    this.semanticLabel,
    this.blur = 26,
  });
  final Widget child;
  final double radius;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final double from;
  final double to;
  final double? height;
  final String? semanticLabel;
  final double blur;

  Widget _surface(double r) {
    final shape = BorderRadius.circular(r);
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: shape,
        boxShadow: const [BoxShadow(offset: Offset(0, 4), blurRadius: 22, color: Color(0x1A102A5E))],
      ),
      child: ClipRRect(
        borderRadius: shape,
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: blur / 2, sigmaY: blur / 2),
          child: Container(
            height: height,
            padding: padding,
            decoration: BoxDecoration(
              gradient: cssGradient(150, [Colors.white.withValues(alpha: from), Colors.white.withValues(alpha: to)]),
              borderRadius: shape,
              border: Border.all(color: Colors.white),
            ),
            foregroundDecoration: BoxDecoration(
              borderRadius: shape,
              // The inner top edge: inset 0 1px 0 rgba(255,255,255,.97).
              gradient: const LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Color(0x80FFFFFF), Color(0x00FFFFFF)],
                stops: [0, .04],
              ),
            ),
            child: child,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (onTap == null) return _surface(radius);
    return Pressable(
      onTap: onTap,
      radius: radius,
      semanticLabel: semanticLabel,
      builder: (context, pressed) => AnimatedRadius(radius: pressed ? radius * .66 : radius, builder: _surface),
    );
  }
}

/// Animates a corner radius on the fast spatial spring for a builder.
class AnimatedRadius extends StatelessWidget {
  const AnimatedRadius({super.key, required this.radius, required this.builder});
  final double radius;
  final Widget Function(double radius) builder;

  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
    tween: Tween(end: radius),
    duration: AtriaMotion.spatialFastDuration,
    curve: AtriaMotion.spatialFast,
    builder: (context, r, _) => builder(r),
  );
}

/// Glass on the blue accent (28:40): white from 30% to 12%, white hairline.
BoxDecoration glassOnAccent(double radius) => BoxDecoration(
  gradient: cssGradient(169, [Colors.white.withValues(alpha: .3), Colors.white.withValues(alpha: .12)], [.145, .855]),
  borderRadius: BorderRadius.circular(radius),
  border: Border.all(color: Colors.white.withValues(alpha: .7)),
);

/// The accent gradient on a chip or indicator (28:62).
LinearGradient accentGradient([double degrees = 145]) =>
    cssGradient(degrees, const [AtriaColors.blue500, Color(0xFF2565DE)], [.145, .855]);
