import 'dart:math' as math;

import 'package:flutter/animation.dart';
import 'package:flutter/painting.dart';

/// Atria's design tokens, the same values as web/src/styles/tokens.css, which
/// reads them from the Figma file "Atria - Product UI" (ZDPTMHC5AD5LgZH7lDx2lO).
/// Rev A's look is signed off: change a value only when the design changes.
abstract final class AtriaColors {
  static const blue100 = Color(0xFFE3EDFE);
  static const blue200 = Color(0xFFBFD5FE);
  static const blue500 = Color(0xFF4A83F0);
  static const blue600 = Color(0xFF2F6BE4);
  static const blue700 = Color(0xFF2461DB);
  static const blue800 = Color(0xFF1B4FB8);
  static const blue900 = Color(0xFF0B2B6B);

  static const surfaceWhite = Color(0xFFFFFFFF);
  static const surfaceGround = Color(0xFFE9F0FD);
  static const surfacePanel = Color(0xFFF6F9FF);
  static const surfaceField = Color(0xFFEDF2FB);

  static const inkPrimary = Color(0xFF0D1B34);
  static const ink900 = Color(0xFF16233F);
  static const ink800 = Color(0xFF2C3D60);
  static const ink700 = Color(0xFF41547C);
  static const inkMuted = Color(0xFF5A6C8E);
  static const inkSoft = Color(0xFF7181A0);
  static const ink400 = Color(0xFF8B97AE);

  static const lineHairline = Color(0xFFE3EAF8);
  static const lineSoft = Color(0xFFC8D5EC);

  static const confirmed = Color(0xFF0E9C6B);
  static const confirmedInk = Color(0xFF0B7A53);
  static const awaiting = Color(0xFFD98324);
  static const awaitingInk = Color(0xFF9B5E0E);
  static const cancelled = Color(0xFFD6485A);
  static const cancelledInk = Color(0xFFB93B4C);
  static const bookedInk = Color(0xFF2A5BC2);
}

abstract final class AtriaRadius {
  static const s = 14.0;
  static const m = 22.0;
  static const l = 30.0;
  static const xl = 38.0;
}

abstract final class AtriaSpace {
  static const s1 = 4.0;
  static const s2 = 8.0;
  static const s3 = 12.0;
  static const s4 = 16.0;
  static const s5 = 20.0;
  static const s6 = 24.0;
  static const touchTarget = 46.0;
  static const controlM = 46.0;
  static const controlL = 54.0;
}

abstract final class AtriaShadows {
  static const panel = [BoxShadow(offset: Offset(0, 4), blurRadius: 22, color: Color(0x1A102A5E))];
  static const raised = [BoxShadow(offset: Offset(0, 10), blurRadius: 30, color: Color(0x29102A5E))];
  static const primary = [BoxShadow(offset: Offset(0, 10), blurRadius: 22, color: Color(0x522461DB))];
}

/// A CSS gradient angle as begin and end points: 0deg points up and turns clockwise.
Alignment _from(double degrees) {
  final radians = (degrees - 90) * math.pi / 180;
  return Alignment(-math.cos(radians), -math.sin(radians));
}

LinearGradient cssGradient(double degrees, List<Color> colors, [List<double>? stops]) {
  final begin = _from(degrees);
  return LinearGradient(begin: begin, end: Alignment(-begin.x, -begin.y), colors: colors, stops: stops);
}

abstract final class AtriaGradients {
  static final page = cssGradient(150, const [Color(0xFFDBE7FE), Color(0xFFEFF4FE), Color(0xFFE2EBFD)], [0, .42, 1]);
  static final brand = cssGradient(
    164,
    const [Color(0xFF123A8C), Color(0xFF2C63DE), Color(0xFF4A83F0), Color(0xFF6D9EF4)],
    [0, .4, .78, 1],
  );
  static final primary = cssGradient(140, const [AtriaColors.blue500, AtriaColors.blue700]);
  static final disabled = cssGradient(140, const [Color(0xFFC2CFE6), Color(0xFFA9B9D6)]);
  static final glassCard = cssGradient(150, const [Color(0xF5FFFFFF), Color(0xC7FFFFFF)]);
  static final glassSwitch = cssGradient(140, const [Color(0xEBFFFFFF), Color(0xA8FFFFFF)]);
}

/// Material 3 Expressive motion (ADR 0019), as real springs: each token is
/// the spec's damping ratio and stiffness (the "expressive" scheme for
/// movement, the effects springs for colour and opacity), run for as long as
/// the spring takes to settle. Springs are front-loaded, so movement reads as
/// finished well before its duration; nothing crawls in.
abstract final class AtriaMotion {
  /// Presses, pops and small things: lively, a 9.5% overshoot.
  static const spatialFast = SpringCurve(.6, 800, .348);
  static const spatialFastDuration = Duration(milliseconds: 350);

  /// Screens, sheets and anything that travels: a 1.5% overshoot.
  static const spatialDefault = SpringCurve(.8, 380, .412);
  static const spatialDefaultDuration = Duration(milliseconds: 410);

  static const spatialSlow = SpringCurve(.8, 200, .567);
  static const spatialSlowDuration = Duration(milliseconds: 570);

  /// Opacity and colour: critically damped, never past the target.
  static const effects = SpringCurve(1, 1600, .212);
  static const effectsFastDuration = Duration(milliseconds: 140);
  static const effectsDefaultDuration = Duration(milliseconds: 210);
  static const effectsSlowDuration = Duration(milliseconds: 300);
}

/// A damped spring from rest at 0 to 1 (unit mass), as a curve over
/// [settle] seconds. [damping] is the ratio (1 is critical, below it
/// overshoots) and [stiffness] the spring constant, the two numbers Material 3
/// Expressive gives for each motion token.
class SpringCurve extends Curve {
  const SpringCurve(this.damping, this.stiffness, this.settle);
  final double damping;
  final double stiffness;
  final double settle;

  @override
  double transformInternal(double t) {
    final w = math.sqrt(stiffness);
    final time = t * settle;
    if (damping >= 1) return 1 - math.exp(-w * time) * (1 + w * time);
    final wd = w * math.sqrt(1 - damping * damping);
    return 1 - math.exp(-damping * w * time) * (math.cos(wd * time) + damping * w / wd * math.sin(wd * time));
  }
}
