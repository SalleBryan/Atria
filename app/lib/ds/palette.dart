import 'package:flutter/painting.dart';

import '../theme/tokens.dart';

/// The app's palette (2026-09-30 redesign): one blue family and its neutrals,
/// the colours of the web landing page. A small screen reads calm when every
/// accent is the same hue, so state is told by weight and fill (solid, soft,
/// quiet) and by words, never by a second colour. Red is kept for the one
/// thing that must stand out: an action that cannot be undone, or an error.
abstract final class P {
  static const navy = Color(0xFF0B2462);
  static const blue900 = Color(0xFF123A8C);
  static const blue800 = Color(0xFF1B4FB8);
  static const blue700 = Color(0xFF2461DB);
  static const blue600 = Color(0xFF2F6BE4);
  static const blue500 = Color(0xFF4A83F0);
  static const blue400 = Color(0xFF6D9EF4);
  static const blue300 = Color(0xFF9EC0F8);
  static const blue200 = Color(0xFFC6DAFB);
  static const blue100 = Color(0xFFDCE8FD);
  static const blue50 = Color(0xFFEEF3FD);

  static const white = Color(0xFFFFFFFF);
  static const ground = Color(0xFFF1F5FD);

  static const ink = Color(0xFF0D1B34);
  static const ink2 = Color(0xFF3C4E72);
  static const ink3 = Color(0xFF66779A);
  static const ink4 = Color(0xFF9AA7C0);
  static const line = Color(0xFFE2E9F6);

  static const danger = Color(0xFFC23A4E);
  static const dangerSoft = Color(0xFFFCEBEE);

  /// The hero field, as the landing page's (landing.css, .landing-field).
  static final hero = cssGradient(166, const [Color(0xFF0E2E78), blue700, blue500, blue400], [0, .42, .8, 1]);

  /// A deeper field for full-screen moments (onboarding, sign-in).
  static final deep = cssGradient(170, const [navy, blue900, blue700, blue500], [0, .3, .72, 1]);

  static const cardShadow = [BoxShadow(offset: Offset(0, 8), blurRadius: 28, color: Color(0x14133A8C))];
  static const liftShadow = [BoxShadow(offset: Offset(0, 14), blurRadius: 30, spreadRadius: -8, color: Color(0x40123A8C))];
}
