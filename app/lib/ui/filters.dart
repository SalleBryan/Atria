import 'dart:math' as math;
import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';

import '../theme/theme.dart';
import '../theme/tokens.dart';
import 'expressive.dart';
import 'glass.dart';
import 'icons.dart';
import 'layout.dart';
import 'widgets.dart';

/// Filters: the few most popular options inline, the rest in a menu
/// (web/src/components/FilterMenu.tsx). A row shows "All", as many of the
/// most popular options as fit on one line (four at most), then "More".
/// Never a second line. "More" and the filter button open the same menu,
/// which holds every option of every filter: a sheet from the bottom on a
/// phone, a menu dropped from its button on a tablet.
class FilterOption {
  const FilterOption({required this.id, required this.label, this.count, this.dot});
  final String id;
  final String label;

  /// How many results the option leaves, shown beside it in the menu.
  final int? count;

  /// A colour dot before the label, as the week's clinicians have.
  final Color? dot;

  FilterOption relabel(String label) => FilterOption(id: id, label: label, count: count, dot: dot);
}

class FilterSection {
  const FilterSection({
    required this.id,
    required this.label,
    required this.options,
    required this.value,
    required this.onChange,
    this.allLabel = 'All',
  });
  final String id;
  final String label;
  final List<FilterOption> options;
  final String? value;
  final ValueChanged<String?> onChange;
  final String allLabel;
}

/// Options ordered by how many results each has, then by name.
List<FilterOption> byPopularity<T>(Iterable<T> items, String? Function(T) keyOf) {
  final counts = <String, int>{};
  for (final item in items) {
    final key = keyOf(item);
    if (key != null && key.isNotEmpty) counts.update(key, (n) => n + 1, ifAbsent: () => 1);
  }
  final sorted = counts.entries.toList()
    ..sort((a, b) {
      final by = b.value.compareTo(a.value);
      return by != 0 ? by : a.key.compareTo(b.key);
    });
  return [for (final e in sorted) FilterOption(id: e.key, label: e.key, count: e.value)];
}

const _maxInline = 4;
final _chipText = AtriaType.body(size: 13.5, weight: FontWeight.w600);

double _chipWidth(BuildContext context, String label, {bool dot = false, int? badge}) {
  final text = TextPainter(
    text: TextSpan(text: label, style: _chipText),
    maxLines: 1,
    textDirection: TextDirection.ltr,
    textScaler: MediaQuery.textScalerOf(context),
  )..layout();
  return text.width + 36 + (dot ? 16 : 0) + (badge != null ? 26 : 0);
}

/// One chip: glass at rest, the accent when chosen, corners rounding up as it
/// turns on (the web's `.chip` and `.chip-on`).
class FilterChipButton extends StatelessWidget {
  const FilterChipButton({
    super.key,
    required this.label,
    required this.on,
    required this.onTap,
    this.icon,
    this.dot,
    this.badge,
    this.height = 42,
  });
  final String label;
  final bool on;
  final VoidCallback onTap;
  final String? icon;
  final Color? dot;
  final int? badge;
  final double height;

  @override
  Widget build(BuildContext context) => Semantics(
    selected: on,
    child: Pressable(
      onTap: onTap,
      radius: 16,
      ink: AtriaColors.blue700,
      semanticLabel: badge == null ? label : '$label, $badge set',
      builder: (context, _) => AnimatedContainer(
        duration: AtriaMotion.spatialFastDuration,
        curve: AtriaMotion.spatialFast,
        height: height,
        padding: const EdgeInsets.symmetric(horizontal: 18),
        decoration: BoxDecoration(
          gradient: on
              ? accentGradient()
              : cssGradient(
                  160,
                  [Colors.white.withValues(alpha: .9), Colors.white.withValues(alpha: .58)],
                  [.145, .855],
                ),
          borderRadius: BorderRadius.circular(on ? 22 : 15),
          border: Border.all(color: Colors.white),
          boxShadow: [
            on
                ? const BoxShadow(offset: Offset(0, 6), blurRadius: 16, color: Color(0x572F6BE4))
                : const BoxShadow(offset: Offset(0, 1), blurRadius: 6, color: Color(0x0F0F295E)),
          ],
        ),
        child: ExcludeSemantics(
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (dot != null) ...[
                Container(
                  width: 9,
                  height: 9,
                  decoration: BoxDecoration(
                    color: dot,
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(color: on ? const Color(0xD9FFFFFF) : const Color(0x00FFFFFF), spreadRadius: 2),
                    ],
                  ),
                ),
                const SizedBox(width: 7),
              ],
              if (icon != null) ...[
                AtriaIcon(icon!, size: 15, color: on ? Colors.white : AtriaColors.ink700),
                const SizedBox(width: 7),
              ],
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: _chipText.copyWith(color: on ? Colors.white : AtriaColors.ink700),
                ),
              ),
              if (badge != null && badge! > 0) ...[
                const SizedBox(width: 7),
                Container(
                  constraints: const BoxConstraints(minWidth: 18),
                  height: 18,
                  padding: const EdgeInsets.symmetric(horizontal: 5),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: on ? Colors.white : AtriaColors.blue600,
                    borderRadius: BorderRadius.circular(99),
                  ),
                  child: Text(
                    '$badge',
                    style: AtriaType.body(
                      size: 10.5,
                      weight: FontWeight.w700,
                      color: on ? AtriaColors.blue700 : Colors.white,
                      height: 1,
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

/// The inline row: All, what fits of the four most popular, then More.
class ChipRow extends StatelessWidget {
  const ChipRow({
    super.key,
    required this.options,
    required this.value,
    required this.onChange,
    this.allLabel = 'All',
    this.onMore,
    this.moreActive = 0,
    this.moreAlways = false,
    this.allDot,
  });
  final List<FilterOption> options;
  final String? value;
  final ValueChanged<String?> onChange;
  final String allLabel;
  final Color? allDot;

  /// Opens the menu. Without it, "More" is not offered.
  final VoidCallback? onMore;

  /// How many filters are set in the menu but not visible in the row.
  final int moreActive;

  /// Offer "More" even when every option fits, because the menu holds other filters too.
  final bool moreAlways;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, box) {
      const gap = 8.0;
      final candidates = options.take(_maxInline).toList();
      final all = _chipWidth(context, allLabel, dot: allDot != null);
      final chosenHidden = value != null && !candidates.take(_maxInline).any((o) => o.id == value);
      final more = _chipWidth(context, 'More', badge: moreActive + (chosenHidden ? 1 : 0));
      var fits = 0;
      var used = all;
      for (final o in candidates) {
        final w = _chipWidth(context, o.label, dot: o.dot != null);
        final rest = onMore != null && (moreAlways || fits + 1 < options.length) ? gap + more : 0;
        if (used + gap + w + rest > box.maxWidth) break;
        used += gap + w;
        fits++;
      }
      final shown = candidates.take(fits).toList();
      // The chosen option always shows, in place of the last that fits.
      if (value != null && !shown.any((o) => o.id == value) && shown.isNotEmpty) {
        final chosen = options.where((o) => o.id == value).firstOrNull;
        if (chosen != null) shown[shown.length - 1] = chosen;
      }
      final hidden = options.length - shown.length;
      final setInMenu = moreActive + (value != null && !shown.any((o) => o.id == value) ? 1 : 0);
      return SizedBox(
        height: 46,
        child: Row(
          children: [
            FilterChipButton(label: allLabel, dot: allDot, on: value == null, onTap: () => onChange(null)),
            for (final o in shown) ...[
              const SizedBox(width: gap),
              Flexible(
                child: Pop(
                  value: o.id,
                  child: FilterChipButton(
                    label: o.label,
                    dot: o.dot,
                    on: o.id == value,
                    onTap: () => onChange(o.id == value ? null : o.id),
                  ),
                ),
              ),
            ],
            if (onMore != null && (moreAlways || hidden > 0)) ...[
              const SizedBox(width: gap),
              FilterChipButton(
                label: 'More',
                icon: 'filter',
                on: false,
                badge: setInMenu == 0 ? null : setInMenu,
                onTap: onMore!,
              ),
            ],
          ],
        ),
      );
    },
  );
}

/// Opens the menu of every filter. [anchor] is the button it hangs from on a
/// tablet; a phone gets a sheet from the bottom edge.
Future<void> showFilterMenu(
  BuildContext context, {
  required String title,
  required List<FilterSection> Function() sections,
  required String Function() results,
  required VoidCallback onClear,
  GlobalKey? anchor,
}) {
  Widget menu(BuildContext menuContext, {required bool sheet}) => StatefulBuilder(
    builder: (context, setMenu) => _FilterMenuBody(
      title: title,
      sections: sections(),
      results: results(),
      onClear: () {
        onClear();
        setMenu(() {});
      },
      refresh: () => setMenu(() {}),
      sheet: sheet,
    ),
  );

  if (!context.isTablet) {
    return showModalBottomSheet<void>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      barrierColor: const Color(0x52102A5E),
      sheetAnimationStyle: const AnimationStyle(
        duration: AtriaMotion.spatialDefaultDuration,
        curve: AtriaMotion.spatialDefault,
        reverseDuration: AtriaMotion.effectsDefaultDuration,
      ),
      builder: (sheetContext) => ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(sheetContext).height * .82),
        child: menu(sheetContext, sheet: true),
      ),
    );
  }
  final box = anchor?.currentContext?.findRenderObject() as RenderBox?;
  final screen = MediaQuery.sizeOf(context);
  final at = box == null
      ? Offset(screen.width - 24, 120)
      : box.localToGlobal(Offset(box.size.width, box.size.height + 8));
  const width = 380.0;
  return showGeneralDialog<void>(
    context: context,
    useRootNavigator: true,
    barrierDismissible: true,
    barrierLabel: 'Close the filters',
    barrierColor: const Color(0x14102A5E),
    transitionDuration: AtriaMotion.spatialFastDuration,
    pageBuilder: (dialogContext, _, _) => Stack(
      children: [
        Positioned(
          left: (at.dx - width).clamp(16.0, screen.width - width - 16),
          top: at.dy,
          width: width,
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: math.max(260, screen.height - at.dy - 24)),
            child: menu(dialogContext, sheet: false),
          ),
        ),
      ],
    ),
    transitionBuilder: (context, animation, _, child) {
      final t = CurvedAnimation(parent: animation, curve: AtriaMotion.spatialFast, reverseCurve: AtriaMotion.effects);
      return FadeTransition(
        opacity: animation,
        child: AnimatedBuilder(
          animation: t,
          builder: (context, child) => Transform.translate(
            offset: Offset(0, -8 * (1 - t.value)),
            child: Transform.scale(scale: .92 + .08 * t.value, alignment: Alignment.topRight, child: child),
          ),
          child: child,
        ),
      );
    },
  );
}

class _FilterMenuBody extends StatelessWidget {
  const _FilterMenuBody({
    required this.title,
    required this.sections,
    required this.results,
    required this.onClear,
    required this.refresh,
    required this.sheet,
  });
  final String title;
  final List<FilterSection> sections;
  final String results;
  final VoidCallback onClear;
  final VoidCallback refresh;
  final bool sheet;

  @override
  Widget build(BuildContext context) {
    final any = sections.any((s) => s.value != null);
    final radius = sheet ? const BorderRadius.vertical(top: Radius.circular(30)) : BorderRadius.circular(26);
    var index = 0;
    return Material(
      type: MaterialType.transparency,
      child: ClipRRect(
        borderRadius: radius,
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 13, sigmaY: 13),
          child: Container(
            decoration: BoxDecoration(
              borderRadius: radius,
              border: Border.all(color: Colors.white),
              gradient: cssGradient(150, const [Color(0xF7FFFFFF), Color(0xE0FFFFFF)]),
              boxShadow: const [BoxShadow(offset: Offset(0, 24), blurRadius: 60, color: Color(0x38102A5E))],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (sheet)
                  Center(
                    child: Container(
                      width: 40,
                      height: 5,
                      margin: const EdgeInsets.only(top: 10),
                      decoration: BoxDecoration(color: AtriaColors.lineSoft, borderRadius: BorderRadius.circular(99)),
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(22, 14, 12, 4),
                  child: Row(
                    children: [
                      Expanded(
                        child: Semantics(
                          header: true,
                          child: Text(title, style: AtriaType.display(size: 17, weight: FontWeight.w700)),
                        ),
                      ),
                      SquareIconButton(
                        icon: 'close',
                        label: 'Close',
                        size: 38,
                        color: AtriaColors.ink700,
                        onTap: () => Navigator.of(context).pop(),
                      ),
                    ],
                  ),
                ),
                Flexible(
                  child: ListView(
                    shrinkWrap: true,
                    padding: const EdgeInsets.fromLTRB(22, 4, 22, 8),
                    children: [
                      for (var s = 0; s < sections.length; s++)
                        Container(
                          padding: const EdgeInsets.only(top: 12, bottom: 14),
                          decoration: BoxDecoration(
                            border: s == sections.length - 1
                                ? null
                                : const Border(bottom: BorderSide(color: AtriaColors.lineHairline)),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                sections[s].label.toUpperCase(),
                                style: AtriaType.body(
                                  size: 11,
                                  weight: FontWeight.w700,
                                  color: AtriaColors.inkMuted,
                                ).copyWith(letterSpacing: .88),
                              ),
                              const SizedBox(height: 10),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: [
                                  _Option(
                                    label: sections[s].allLabel,
                                    on: sections[s].value == null,
                                    index: index++,
                                    sheet: sheet,
                                    onTap: () {
                                      sections[s].onChange(null);
                                      refresh();
                                    },
                                  ),
                                  for (final o in sections[s].options)
                                    _Option(
                                      label: o.label,
                                      count: o.count,
                                      dot: o.dot,
                                      on: sections[s].value == o.id,
                                      index: index++,
                                      sheet: sheet,
                                      onTap: () {
                                        sections[s].onChange(sections[s].value == o.id ? null : o.id);
                                        refresh();
                                      },
                                    ),
                                ],
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
                Container(
                  padding: EdgeInsets.fromLTRB(22, 14, 18, 18 + (sheet ? MediaQuery.paddingOf(context).bottom : 0)),
                  decoration: const BoxDecoration(
                    border: Border(top: BorderSide(color: AtriaColors.lineHairline)),
                  ),
                  child: Row(
                    children: [
                      TextLink('Clear all', onTap: any ? onClear : null, size: 13.5),
                      const SizedBox(width: 12),
                      if (sheet)
                        Expanded(
                          child: PrimaryButton(label: results, onPressed: () => Navigator.of(context).pop()),
                        )
                      else ...[
                        const Spacer(),
                        SizedBox(
                          width: 190,
                          child: PrimaryButton(label: results, onPressed: () => Navigator.of(context).pop()),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Option extends StatelessWidget {
  const _Option({
    required this.label,
    required this.on,
    required this.onTap,
    required this.index,
    required this.sheet,
    this.count,
    this.dot,
  });
  final String label;
  final bool on;
  final VoidCallback onTap;
  final int index;
  final bool sheet;
  final int? count;
  final Color? dot;

  @override
  Widget build(BuildContext context) => Semantics(
    selected: on,
    child: Pressable(
      onTap: onTap,
      radius: 14,
      ink: AtriaColors.blue700,
      semanticLabel: count == null ? label : '$label, $count',
      builder: (context, _) => AnimatedContainer(
        duration: AtriaMotion.spatialFastDuration,
        curve: AtriaMotion.spatialFast,
        height: sheet ? 42 : 36,
        padding: EdgeInsets.symmetric(horizontal: sheet ? 16 : 13),
        decoration: BoxDecoration(
          color: on ? null : Colors.white,
          gradient: on ? AtriaGradients.primary : null,
          borderRadius: BorderRadius.circular(on ? 18 : (sheet ? 14 : 12)),
          border: Border.all(color: on ? Colors.transparent : AtriaColors.lineHairline, width: 1.5),
          // Faded, never removed: see PrimaryButton.
          boxShadow: [
            BoxShadow(
              offset: const Offset(0, 6),
              blurRadius: 14,
              color: on ? const Color(0x4D2461DB) : const Color(0x002461DB),
            ),
          ],
        ),
        child: ExcludeSemantics(
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (dot != null) ...[
                Container(
                  width: 9,
                  height: 9,
                  decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
                ),
                const SizedBox(width: 8),
              ],
              Text(
                label,
                style: AtriaType.body(
                  size: 12.5,
                  weight: FontWeight.w600,
                  color: on ? Colors.white : AtriaColors.ink700,
                ),
              ),
              if (count != null) ...[
                const SizedBox(width: 8),
                Text(
                  '$count',
                  style: AtriaType.body(
                    size: 11,
                    weight: FontWeight.w700,
                    color: on ? Colors.white.withValues(alpha: .8) : AtriaColors.inkMuted,
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
