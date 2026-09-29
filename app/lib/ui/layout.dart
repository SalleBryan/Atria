import 'package:flutter/material.dart';

import '../theme/theme.dart';
import '../theme/tokens.dart';
import 'icons.dart';
import 'expressive.dart';

/// Which frame set a screen gets, as the web decides it (web/src/layout/fit.ts):
/// a phone below 768 wide, a tablet from there up. The app is installed on
/// both, so every screen has both layouts: the phone frames (Patient · Mobile,
/// Staff · Mobile) and, on a tablet, the tablet frames (Patient · Tablet) or,
/// for staff, the desktop frames' panes (Staff · Desktop).
enum Tier { phone, tablet }

const tabletFrom = 768.0;

Tier tierOf(BuildContext context) => MediaQuery.sizeOf(context).width >= tabletFrom ? Tier.tablet : Tier.phone;

extension TierContext on BuildContext {
  bool get isTablet => tierOf(this) == Tier.tablet;
}

/// A page's length on a phone, where the page itself scrolls.
const phonePage = 10;

/// How many rows a box of [height] holds, at [pitch] a row (its height plus
/// the gap under it): a tablet's list is paged to what its pane holds, so it
/// never scrolls and the pager stays in view; a phone's page is [phonePage].
int rowsThatFit(BuildContext context, double height, {required double pitch, double gap = 8, int least = 2}) {
  if (!context.isTablet || !height.isFinite || height <= 0) return phonePage;
  return ((height + gap) / pitch).floor().clamp(least, 999);
}

/// One page of a list held in full on the client (the web's usePages).
class Pages<T> {
  Pages(this.items, this.size, int page) : pages = items.isEmpty ? 1 : (items.length / size).ceil() {
    this.page = page.clamp(0, pages - 1);
  }
  final List<T> items;
  final int size;
  final int pages;
  late final int page;

  List<T> get shown => items.skip(page * size).take(size).toList();
  int get first => items.isEmpty ? 0 : page * size + 1;
  int get last => page * size + shown.length;
  int get total => items.length;

  /// The page holding the item at [index], such as the one selected.
  int pageOf(int index) => index < 0 ? page : index ~/ size;
}

/// "1 to 10 of 23", and the page turners (the web's Pager).
class Pager extends StatelessWidget {
  const Pager({
    super.key,
    required this.first,
    required this.last,
    required this.total,
    required this.page,
    required this.pages,
    required this.onPrevious,
    required this.onNext,
    this.busy = false,
    this.hasNext,
    this.note,
    this.noun = 'visits',
  });

  factory Pager.of(
    Pages<Object?> p, {
    required VoidCallback onPrevious,
    required VoidCallback onNext,
    String noun = 'visits',
    String? note,
  }) => Pager(
    first: p.first,
    last: p.last,
    total: p.total,
    page: p.page,
    pages: p.pages,
    onPrevious: onPrevious,
    onNext: onNext,
    noun: noun,
    note: note,
  );

  final int first;
  final int last;
  final int total;
  final int page;
  final int pages;
  final VoidCallback onPrevious;
  final VoidCallback onNext;
  final bool busy;

  /// For a list paged by the server, which knows whether more follow.
  final bool? hasNext;
  final String? note;
  final String noun;

  @override
  Widget build(BuildContext context) {
    final more = hasNext ?? page < pages - 1;
    final count = busy && total == 0 ? '' : (total > 0 ? '$first to $last of $total' : 'No $noun to show');
    return Container(
      constraints: const BoxConstraints(minHeight: 52),
      padding: const EdgeInsets.fromLTRB(2, 10, 2, 4),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AtriaColors.lineHairline)),
      ),
      child: Wrap(
        alignment: WrapAlignment.spaceBetween,
        crossAxisAlignment: WrapCrossAlignment.center,
        runSpacing: 8,
        spacing: 16,
        children: [
          Semantics(
            liveRegion: true,
            child: Text.rich(
              TextSpan(
                text: count,
                children: [
                  if (note != null)
                    TextSpan(
                      text: ' · $note',
                      style: AtriaType.body(size: 12.5, weight: FontWeight.w500, color: AtriaColors.inkMuted),
                    ),
                ],
              ),
              style: AtriaType.body(size: 12.5, weight: FontWeight.w600, color: AtriaColors.ink700),
            ),
          ),
          if (pages > 1 || (hasNext ?? false))
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Page ${page + 1} of $pages',
                  style: AtriaType.body(size: 12.5, weight: FontWeight.w600, color: AtriaColors.inkMuted),
                ),
                const SizedBox(width: 14),
                SquareIconButton(
                  icon: 'chevronLeft',
                  label: 'Previous page',
                  size: 36,
                  onTap: page == 0 || busy ? null : onPrevious,
                ),
                const SizedBox(width: 8),
                SquareIconButton(
                  icon: 'chevronRight',
                  label: 'Next page',
                  size: 36,
                  onTap: !more || busy ? null : onNext,
                ),
              ],
            ),
        ],
      ),
    );
  }
}

/// A white square with an icon (the web's `.square-button`).
class SquareIconButton extends StatelessWidget {
  const SquareIconButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.size = 44,
    this.color = AtriaColors.blue600,
    this.badge = false,
    this.on = false,
  });
  final String icon;
  final String label;
  final VoidCallback? onTap;
  final double size;
  final Color color;

  /// A dot at the corner, for something waiting (a bell with news).
  final bool badge;

  /// Pressed-in, for a toggle that is set (a filter with filters on).
  final bool on;

  @override
  Widget build(BuildContext context) {
    final radius = size * .32;
    return Opacity(
      opacity: onTap == null ? .4 : 1,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          PressableSurface(
            onTap: onTap,
            radius: radius,
            width: size,
            height: size,
            color: on ? null : Colors.white,
            gradient: on ? AtriaGradients.primary : null,
            border: on ? null : Border.all(color: AtriaColors.lineHairline),
            shadow: const BoxShadow(offset: Offset(0, 4), blurRadius: 12, color: Color(0x14102A5E)),
            ink: color,
            semanticLabel: label,
            child: AtriaIcon(icon, size: size * .42, color: on ? Colors.white : color),
          ),
          if (badge)
            Positioned(
              right: size * .2,
              top: size * .2,
              child: Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: AtriaColors.cancelled,
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white, width: 1.5),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// A section title with an optional link at the end ("Upcoming · See all").
class SectionHead extends StatelessWidget {
  const SectionHead({super.key, required this.title, this.link, this.onLink, this.trailing});
  final String title;
  final String? link;
  final VoidCallback? onLink;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Semantics(
          header: true,
          child: Text(title, style: AtriaType.display(size: 17, weight: FontWeight.w600)),
        ),
      ),
      ?trailing,
      if (link != null) TextLink(link!, onTap: onLink),
    ],
  );
}

/// Blue words that do something ("See all", "Filter").
class TextLink extends StatelessWidget {
  const TextLink(this.text, {super.key, this.onTap, this.size = 13, this.color = AtriaColors.blue600});
  final String text;
  final VoidCallback? onTap;
  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) => Pressable(
    onTap: onTap,
    radius: 10,
    ink: color,
    semanticLabel: text,
    builder: (context, _) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
      child: Text(
        text,
        style: AtriaType.body(size: size, weight: FontWeight.w700, color: onTap == null ? AtriaColors.inkMuted : color),
      ),
    ),
  );
}
