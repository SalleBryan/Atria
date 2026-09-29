import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';

import '../theme/theme.dart';
import '../theme/tokens.dart';
import 'expressive.dart';
import 'icons.dart';
import 'layout.dart';

/// A bottom sheet on glass that rises on the default spatial spring.
Future<void> showGlassSheet(BuildContext context, {required String title, required List<Widget> children}) =>
    showModalBottomSheet<void>(
      useRootNavigator: true,
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      barrierColor: const Color(0x660B1B3A),
      sheetAnimationStyle: const AnimationStyle(
        duration: AtriaMotion.spatialDefaultDuration,
        curve: AtriaMotion.spatialDefault,
        reverseDuration: AtriaMotion.effectsDefaultDuration,
      ),
      // On a tablet the sheet keeps a readable width, centred on the bottom edge.
      constraints: context.isTablet ? const BoxConstraints(maxWidth: 560) : null,
      builder: (context) => GlassSheet(title: title, children: children),
    );

class GlassSheet extends StatelessWidget {
  const GlassSheet({super.key, required this.title, required this.children, this.icon});
  final String title;
  final List<Widget> children;
  final Widget? icon;

  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
    child: BackdropFilter(
      filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
      child: Container(
        decoration: BoxDecoration(
          gradient: cssGradient(160, const [Color(0xF7FFFFFF), Color(0xE6FFFFFF)]),
          border: const Border(top: BorderSide(color: Colors.white)),
        ),
        padding: EdgeInsets.fromLTRB(22, 12, 22, 22 + MediaQuery.paddingOf(context).bottom),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(color: AtriaColors.lineSoft, borderRadius: BorderRadius.circular(9)),
                ),
              ),
              const SizedBox(height: 18),
              if (icon != null) ...[Align(alignment: Alignment.centerLeft, child: icon!), const SizedBox(height: 14)],
              Text(title, style: AtriaType.display(size: 21)),
              const SizedBox(height: 14),
              ...children,
            ],
          ),
        ),
      ),
    ),
  );
}

class SheetChoice extends StatelessWidget {
  const SheetChoice({
    super.key,
    this.icon = '',
    this.leading,
    required this.title,
    required this.sub,
    required this.onTap,
  });
  final String icon;

  /// Drawn in place of the icon tile, such as a calendar's own logo.
  final Widget? leading;
  final String title;
  final String sub;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => PressableSurface(
    color: Colors.white,
    border: Border.all(color: AtriaColors.lineHairline, width: 1.5),
    radius: 18,
    padding: const EdgeInsets.all(14),
    ink: AtriaColors.blue700,
    semanticLabel: '$title, $sub',
    onTap: onTap,
    child: Row(
      children: [
        leading ??
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(color: AtriaColors.blue100, borderRadius: BorderRadius.circular(13)),
              child: Center(child: AtriaIcon(icon, size: 18, color: AtriaColors.blue700)),
            ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: AtriaType.body(size: 14, weight: FontWeight.w600, color: AtriaColors.inkPrimary),
              ),
              Text(sub, style: AtriaType.body(size: 11.5, color: AtriaColors.inkSoft)),
            ],
          ),
        ),
      ],
    ),
  );
}
