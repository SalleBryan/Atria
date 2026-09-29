import 'dart:math' as math;
import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';

import '../theme/theme.dart';
import '../theme/tokens.dart';
import 'expressive.dart';
import 'icons.dart';

/// A search field that guesses as you type (web/src/components/SearchSuggest.tsx).
///
/// Each search bar says which categories it searches and what picking a
/// suggestion does. As the person types, every category is matched and the
/// best few of each are offered under the field, grouped and labelled.
/// Matching forgives what people type: case and accents are ignored, any word
/// of a name can be the one they start with ("mbar" finds Esther Mbarga), and
/// from four letters on one slip is allowed ("cardoilogy" finds Cardiology).
class Suggestion {
  const Suggestion({
    required this.id,
    required this.label,
    required this.onPick,
    this.hint,
    this.match,
    this.also = const [],
  });
  final String id;
  final String label;

  /// A second line, such as a specialty under a clinician's name.
  final String? hint;

  /// What is matched, where the label carries more, such as a name without its "Dr".
  final String? match;

  /// Other words the suggestion answers to, such as a clinic's town.
  final List<String> also;
  final VoidCallback onPick;
}

class SuggestionGroup {
  const SuggestionGroup({required this.id, required this.label, required this.items, this.icon});
  final String id;
  final String label;
  final String? icon;
  final List<Suggestion> items;
}

const _accents = {
  'à': 'a', 'á': 'a', 'â': 'a', 'ä': 'a', 'ã': 'a', 'ç': 'c', 'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', //
  'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ñ': 'n', 'ò': 'o', 'ó': 'o', 'ô': 'o', 'ö': 'o', 'õ': 'o', //
  'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u', 'ý': 'y', 'ÿ': 'y',
};

String fold(String text) => text.toLowerCase().split('').map((c) => _accents[c] ?? c).join();

/// One slip allowed: whether [a] and [b] differ by at most one edit.
bool _nearly(String a, String b) {
  if ((a.length - b.length).abs() > 1) return false;
  var i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] == b[j]) {
      i++;
      j++;
      continue;
    }
    edits++;
    if (edits > 1) return false;
    if (a.length > b.length) {
      i++;
    } else if (b.length > a.length) {
      j++;
    } else {
      // A swap of two neighbouring letters counts as the one slip.
      if (i + 1 < a.length && j + 1 < b.length && a[i + 1] == b[j] && a[i] == b[j + 1]) {
        i += 2;
        j += 2;
        continue;
      }
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/// How well [query] matches [text], higher is better, 0 for no match:
/// 4 the text starts with it, 3 a word does, 2 it is inside, 1 a word starts
/// with it but for one slip (four letters or more). Several words must all
/// match, scored by the weakest.
int rank(String text, String query) {
  final words = fold(query).split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
  if (words.isEmpty) return 0;
  final haystack = fold(text);
  final parts = haystack.split(RegExp(r'[^a-z0-9+@.]+')).where((p) => p.isNotEmpty).toList();
  var worst = 4;
  for (final word in words) {
    var best = 0;
    if (haystack.startsWith(word)) {
      best = 4;
    } else if (parts.any((p) => p.startsWith(word))) {
      best = 3;
    } else if (haystack.contains(word)) {
      best = 2;
    } else if (word.length >= 4 &&
        parts.any((p) => _nearly(p.substring(0, math.min(p.length, word.length)), word) || _nearly(p, word))) {
      best = 1;
    }
    if (best == 0) return 0;
    worst = math.min(worst, best);
  }
  return worst;
}

/// The best matches of each group, most likely first, empty groups left out.
List<SuggestionGroup> suggest(List<SuggestionGroup> groups, String query, [int perGroup = 4]) {
  if (query.trim().isEmpty) return [];
  final out = <SuggestionGroup>[];
  for (final g in groups) {
    final scored =
        [
          for (final item in g.items)
            (
              item: item,
              score: [
                rank(item.match ?? item.label, query).toDouble(),
                for (final a in item.also) rank(a, query) - .5,
              ].reduce(math.max),
            ),
        ].where((s) => s.score > 0).toList()..sort((a, b) {
          final by = b.score.compareTo(a.score);
          return by != 0 ? by : a.item.label.compareTo(b.item.label);
        });
    final items = scored.take(perGroup).map((s) => s.item).toList();
    if (items.isNotEmpty) out.add(SuggestionGroup(id: g.id, label: g.label, icon: g.icon, items: items));
  }
  return out;
}

/// The search field, with its suggestions dropped under it in a layer of
/// their own, so no pane clips them.
class SearchSuggest extends StatefulWidget {
  const SearchSuggest({
    super.key,
    required this.controller,
    required this.groups,
    required this.placeholder,
    this.onSubmit,
    this.onChanged,
    this.trailing,
    this.height = 52,
    this.autofocus = false,
  });
  final TextEditingController controller;
  final List<SuggestionGroup> groups;
  final String placeholder;

  /// Search with nothing picked (the keyboard's search key).
  final ValueChanged<String>? onSubmit;
  final ValueChanged<String>? onChanged;

  /// Drawn inside the field after the input, such as a filter button.
  final Widget? trailing;
  final double height;
  final bool autofocus;

  @override
  State<SearchSuggest> createState() => _SearchSuggestState();
}

class _SearchSuggestState extends State<SearchSuggest> {
  final _link = LayerLink();
  final _portal = OverlayPortalController();
  final _focus = FocusNode();
  final _box = GlobalKey();

  @override
  void initState() {
    super.initState();
    _focus.addListener(_sync);
    widget.controller.addListener(_sync);
  }

  @override
  void didUpdateWidget(SearchSuggest old) {
    super.didUpdateWidget(old);
    if (old.controller != widget.controller) {
      old.controller.removeListener(_sync);
      widget.controller.addListener(_sync);
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_sync);
    _focus.dispose();
    super.dispose();
  }

  List<SuggestionGroup> get _shown => _focus.hasFocus ? suggest(widget.groups, widget.controller.text) : const [];

  void _sync() {
    if (!mounted) return;
    final want = _shown.isNotEmpty;
    if (want && !_portal.isShowing) _portal.show();
    if (!want && _portal.isShowing) _portal.hide();
    setState(() {});
  }

  void _pick(Suggestion item) {
    _focus.unfocus();
    _portal.hide();
    item.onPick();
  }

  @override
  Widget build(BuildContext context) {
    return CompositedTransformTarget(
      link: _link,
      child: OverlayPortal(
        controller: _portal,
        overlayChildBuilder: (context) {
          final box = _box.currentContext?.findRenderObject() as RenderBox?;
          final width = box?.size.width ?? 320;
          final top = box == null ? 0.0 : box.localToGlobal(Offset.zero).dy + (box.size.height) + 8;
          final room = MediaQuery.sizeOf(context).height - MediaQuery.viewInsetsOf(context).bottom - top - 16;
          return Positioned(
            width: math.max(width, 260),
            child: CompositedTransformFollower(
              link: _link,
              targetAnchor: Alignment.bottomLeft,
              offset: const Offset(0, 8),
              child: TapRegion(
                groupId: _focus,
                child: _SuggestList(
                  groups: _shown,
                  query: widget.controller.text,
                  maxHeight: math.max(120, room),
                  onPick: _pick,
                ),
              ),
            ),
          );
        },
        child: TapRegion(
          groupId: _focus,
          onTapOutside: (_) => _focus.unfocus(),
          child: Container(
            key: _box,
            height: widget.height,
            padding: const EdgeInsets.only(left: 16, right: 6),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(widget.height * .34),
              border: Border.all(color: _focus.hasFocus ? AtriaColors.blue500 : AtriaColors.lineHairline, width: 1.5),
              boxShadow: [
                if (_focus.hasFocus) const BoxShadow(color: Color(0x244A83F0), spreadRadius: 4),
                const BoxShadow(offset: Offset(0, 4), blurRadius: 14, color: Color(0x0F102A5E)),
              ],
            ),
            child: Row(
              children: [
                const AtriaIcon('search', size: 18, color: AtriaColors.blue600),
                const SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    controller: widget.controller,
                    focusNode: _focus,
                    autofocus: widget.autofocus,
                    textInputAction: TextInputAction.search,
                    onChanged: widget.onChanged,
                    onSubmitted: (v) {
                      _portal.hide();
                      widget.onSubmit?.call(v);
                    },
                    style: AtriaType.body(size: 14, weight: FontWeight.w500, color: AtriaColors.inkPrimary),
                    decoration: InputDecoration.collapsed(
                      hintText: widget.placeholder,
                      hintStyle: AtriaType.body(size: 14, color: AtriaColors.inkMuted),
                    ),
                  ),
                ),
                if (widget.controller.text.isNotEmpty)
                  Pressable(
                    onTap: () {
                      widget.controller.clear();
                      widget.onChanged?.call('');
                    },
                    radius: 12,
                    semanticLabel: 'Clear the search',
                    builder: (context, _) => const Padding(
                      padding: EdgeInsets.all(8),
                      child: AtriaIcon('close', size: 16, color: AtriaColors.inkMuted),
                    ),
                  ),
                if (widget.trailing != null) ...[const SizedBox(width: 4), widget.trailing!],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SuggestList extends StatelessWidget {
  const _SuggestList({required this.groups, required this.query, required this.maxHeight, required this.onPick});
  final List<SuggestionGroup> groups;
  final String query;
  final double maxHeight;
  final ValueChanged<Suggestion> onPick;

  @override
  Widget build(BuildContext context) {
    var index = 0;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: AtriaMotion.spatialFastDuration,
      curve: AtriaMotion.spatialFast,
      builder: (context, t, child) => Opacity(
        opacity: t.clamp(0, 1),
        child: Transform.translate(
          offset: Offset(0, -8 * (1 - t)),
          child: Transform.scale(scale: .92 + .08 * t, alignment: Alignment.topCenter, child: child),
        ),
      ),
      child: Material(
        type: MaterialType.transparency,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(20),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 13, sigmaY: 13),
            child: Container(
              constraints: BoxConstraints(maxHeight: maxHeight),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: Colors.white),
                gradient: cssGradient(150, const [Color(0xFAFFFFFF), Color(0xEBFFFFFF)]),
                boxShadow: const [
                  BoxShadow(offset: Offset(0, 20), blurRadius: 48, color: Color(0x33102A5E)),
                  BoxShadow(offset: Offset(0, 3), blurRadius: 10, color: Color(0x14102A5E)),
                ],
              ),
              child: ListView(
                padding: const EdgeInsets.all(8),
                shrinkWrap: true,
                children: [
                  for (var g = 0; g < groups.length; g++) ...[
                    if (g > 0) const Divider(height: 9, color: AtriaColors.lineHairline),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(10, 6, 10, 4),
                      child: ExcludeSemantics(
                        child: Text(
                          groups[g].label.toUpperCase(),
                          style: AtriaType.body(
                            size: 10.5,
                            weight: FontWeight.w700,
                            color: AtriaColors.inkMuted,
                          ).copyWith(letterSpacing: .84),
                        ),
                      ),
                    ),
                    for (final item in groups[g].items)
                      _SuggestRow(item: item, icon: groups[g].icon, query: query, index: index++, onPick: onPick),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SuggestRow extends StatelessWidget {
  const _SuggestRow({
    required this.item,
    required this.icon,
    required this.query,
    required this.index,
    required this.onPick,
  });
  final Suggestion item;
  final String? icon;
  final String query;
  final int index;
  final ValueChanged<Suggestion> onPick;

  @override
  Widget build(BuildContext context) {
    final word = fold(query).trim().split(RegExp(r'\s+')).first;
    final at = word.isEmpty ? -1 : fold(item.label).indexOf(word);
    final main = AtriaType.body(size: 13.5, weight: FontWeight.w600, color: AtriaColors.inkPrimary);
    return Pressable(
      onTap: () => onPick(item),
      radius: 13,
      ink: AtriaColors.blue600,
      semanticLabel: [item.label, item.hint].whereType<String>().join(', '),
      builder: (context, pressed) => Container(
        constraints: const BoxConstraints(minHeight: 46),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        child: Row(
          children: [
            if (icon != null) ...[
              Container(
                width: 30,
                height: 30,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: const Color(0x1A2F6BE4), borderRadius: BorderRadius.circular(10)),
                child: AtriaIcon(icon!, size: 15, color: AtriaColors.blue600),
              ),
              const SizedBox(width: 11),
            ],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text.rich(
                    at < 0
                        ? TextSpan(text: item.label)
                        : TextSpan(
                            children: [
                              TextSpan(text: item.label.substring(0, at)),
                              TextSpan(
                                text: item.label.substring(at, math.min(item.label.length, at + word.length)),
                                style: main.copyWith(color: AtriaColors.blue600),
                              ),
                              TextSpan(text: item.label.substring(math.min(item.label.length, at + word.length))),
                            ],
                          ),
                    style: main,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (item.hint != null && item.hint!.isNotEmpty)
                    Text(
                      item.hint!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AtriaType.body(size: 11.5, weight: FontWeight.w500, color: AtriaColors.inkMuted),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
