import 'package:flutter/material.dart';

import '../ui/expressive.dart';
import 'tokens.dart';

/// Atria's type: Outfit for display, Plus Jakarta Sans for everything else,
/// as the Rev A text styles set them. Both are bundled (assets/fonts, OFL) as
/// variable fonts, so a weight is also set on the wght axis.
abstract final class AtriaType {
  static TextStyle _font(
    String family,
    double size,
    FontWeight weight,
    Color color, {
    double? height,
    double? spacing,
  }) => TextStyle(
    fontFamily: family,
    fontSize: size,
    fontWeight: weight,
    fontVariations: [FontVariation.weight(weight.value.toDouble())],
    color: color,
    height: height,
    letterSpacing: spacing,
  );

  static TextStyle display({
    double size = 30,
    FontWeight weight = FontWeight.w700,
    Color color = AtriaColors.inkPrimary,
  }) => _font('Outfit', size, weight, color, spacing: -0.022 * size, height: 1.1);

  static TextStyle body({
    double size = 14,
    FontWeight weight = FontWeight.w500,
    Color color = AtriaColors.ink700,
    double height = 1.55,
  }) => _font('PlusJakartaSans', size, weight, color, height: height);

  static TextStyle label({Color color = AtriaColors.ink800}) => _font('PlusJakartaSans', 12.5, FontWeight.w600, color);
}

ThemeData atriaTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: AtriaColors.blue600,
    primary: AtriaColors.blue600,
    surface: AtriaColors.surfaceWhite,
    error: const Color(0xFFBA1A1A),
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: AtriaColors.surfaceGround,
    fontFamily: 'PlusJakartaSans',
    // The state layer and the press morph are Pressable's; no ink splash.
    splashFactory: NoSplash.splashFactory,
    pageTransitionsTheme: const PageTransitionsTheme(
      builders: {
        // Screens rise in on the default spatial spring (ui/expressive.dart).
        TargetPlatform.android: ExpressivePageTransitions(),
        TargetPlatform.iOS: ExpressivePageTransitions(),
      },
    ),
  );
}
