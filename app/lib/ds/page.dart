import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../ui/expressive.dart';
import '../ui/widgets.dart' show Rise;
import '../ui/icons.dart';
import 'kit.dart';
import 'palette.dart';

/// The blue field of the landing page's hero: its gradient and light that
/// drifts across it.
class HeroField extends StatelessWidget {
  const HeroField({super.key, this.deep = false});
  final bool deep;

  @override
  Widget build(BuildContext context) => Stack(
    fit: StackFit.expand,
    children: [
      DecoratedBox(decoration: BoxDecoration(gradient: deep ? P.deep : P.hero)),
      const IgnorePointer(
        child: DriftingLight(
          orbs: [
            Orb(left: 190, top: -120, size: 280, color: Color(0x33FFFFFF), drift: 30),
            Orb(left: -110, top: 90, size: 230, color: Color(0x406D9EF4), drift: 24),
          ],
        ),
      ),
    ],
  );
}

/// A top-level screen: a blue hero with the screen's title, and its content
/// on a sheet that rises over the hero's lower edge.
class HeroPage extends StatelessWidget {
  const HeroPage({
    super.key,
    required this.title,
    this.eyebrow,
    this.sub,
    this.trailing,
    this.heroChild,
    required this.children,
    this.onRefresh,
    this.bottomPadding = 120,
    this.leading,
  });
  final String title;
  final String? eyebrow;
  final String? sub;
  final Widget? trailing;
  final Widget? leading;

  /// More in the hero under the title, such as a search bar or the next visit.
  final Widget? heroChild;
  final List<Widget> children;
  final Future<void> Function()? onRefresh;

  /// Room under the content for the floating tab bar.
  final double bottomPadding;

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    final scroll = CustomScrollView(
      physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
      slivers: [
        SliverToBoxAdapter(
          child: Stack(
            children: [
              const Positioned.fill(bottom: -40, child: HeroField()),
              Padding(
                padding: EdgeInsets.fromLTRB(20, top + 14, 20, 56),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        if (leading != null) ...[leading!, const SizedBox(width: 12)],
                        Expanded(
                          child: eyebrow == null ? const SizedBox(height: 44) : Eyebrow(eyebrow!, onDark: true),
                        ),
                        ?trailing,
                      ],
                    ),
                    const SizedBox(height: 14),
                    Rise(child: Text(title, style: T.hero(size: 31))),
                    if (sub != null) ...[
                      const SizedBox(height: 8),
                      Rise(
                        index: 1,
                        child: Text(sub!, style: T.body(color: const Color(0xDDFFFFFF), size: 14.5)),
                      ),
                    ],
                    if (heroChild != null) ...[const SizedBox(height: 18), Rise(index: 2, child: heroChild!)],
                  ],
                ),
              ),
            ],
          ),
        ),
        SliverToBoxAdapter(
          child: Transform.translate(
            offset: const Offset(0, -30),
            child: Container(
              decoration: const BoxDecoration(
                color: P.ground,
                borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
              ),
              padding: EdgeInsets.fromLTRB(20, 24, 20, bottomPadding),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [for (var i = 0; i < children.length; i++) Rise(index: i + 2, child: children[i])],
              ),
            ),
          ),
        ),
      ],
    );
    return Scaffold(
      backgroundColor: P.ground,
      body: onRefresh == null
          ? scroll
          : RefreshIndicator(onRefresh: onRefresh!, color: P.blue700, edgeOffset: top, child: scroll),
    );
  }
}

/// A screen reached from another: a back button, a title, content, and an
/// optional bar at the bottom for the screen's one action.
class SubPage extends StatelessWidget {
  const SubPage({
    super.key,
    required this.title,
    this.sub,
    required this.children,
    this.bottom,
    this.onBack,
    this.trailing,
    this.back = true,
    this.padding = const EdgeInsets.fromLTRB(20, 6, 20, 28),
  });
  final String title;
  final String? sub;
  final List<Widget> children;
  final Widget? bottom;
  final VoidCallback? onBack;
  final Widget? trailing;
  final bool back;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: P.ground,
    body: SafeArea(
      bottom: false,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
            child: Row(
              children: [
                if (back)
                  RoundBtn(
                    'arrowLeft',
                    label: 'Back',
                    onPressed: onBack ?? () => context.canPop() ? context.pop() : context.go('/home'),
                  )
                else
                  const SizedBox(width: 44),
                const Spacer(),
                ?trailing,
              ],
            ),
          ),
          Expanded(
            child: ListView(
              padding: padding,
              physics: const BouncingScrollPhysics(),
              children: [
                Rise(child: Text(title, style: T.title(size: 27))),
                if (sub != null) ...[const SizedBox(height: 8), Rise(index: 1, child: Text(sub!, style: T.body()))],
                const SizedBox(height: 20),
                for (var i = 0; i < children.length; i++) Rise(index: i + 2, child: children[i]),
              ],
            ),
          ),
          if (bottom != null)
            Container(
              padding: EdgeInsets.fromLTRB(20, 12, 20, 12 + MediaQuery.paddingOf(context).bottom),
              decoration: const BoxDecoration(
                color: P.ground,
                border: Border(top: BorderSide(color: P.line)),
              ),
              child: bottom,
            ),
        ],
      ),
    ),
  );
}

/// Vertical space between the blocks of a page.
const gap = SizedBox(height: 14);
const gapL = SizedBox(height: 26);

/// The frame of every account screen (sign in, sign up, codes, passwords):
/// the deep blue field with the screen's title in white, and the form on a
/// white sheet that rises over it.
class AuthFrame extends StatelessWidget {
  const AuthFrame({
    super.key,
    required this.title,
    this.lede,
    this.ledeWidget,
    required this.children,
    this.icon,
    this.back = true,
    this.foot,
    this.onBack,
    this.top,
  });
  final String title;
  final String? lede;
  final Widget? ledeWidget;
  final List<Widget> children;
  final String? icon;
  final bool back;
  final Widget? foot;
  final VoidCallback? onBack;

  /// Something above the title in place of the back button, such as a switch.
  final Widget? top;

  @override
  Widget build(BuildContext context) {
    final inset = MediaQuery.paddingOf(context);
    return Scaffold(
      backgroundColor: P.white,
      body: LayoutBuilder(
        builder: (context, box) => SingleChildScrollView(
          physics: const ClampingScrollPhysics(),
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: box.maxHeight),
            child: IntrinsicHeight(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Stack(
                    children: [
                      const Positioned.fill(bottom: -40, child: HeroField(deep: true)),
                      Padding(
                        padding: EdgeInsets.fromLTRB(22, inset.top + 12, 22, 52),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                if (back)
                                  RoundBtn(
                                    'arrowLeft',
                                    label: 'Back',
                                    onDark: true,
                                    onPressed:
                                        onBack ?? () => context.canPop() ? context.pop() : context.go('/sign-in'),
                                  )
                                else
                                  const _AuthBrand(),
                                const Spacer(),
                                ?top,
                              ],
                            ),
                            const SizedBox(height: 26),
                            if (icon != null) ...[
                              Rise(child: IconBubble(icon!, size: 54, onDark: true)),
                              const SizedBox(height: 18),
                            ],
                            Rise(child: Text(title, style: T.hero(size: 30))),
                            if (lede != null || ledeWidget != null) ...[
                              const SizedBox(height: 8),
                              Rise(
                                index: 1,
                                child: DefaultTextStyle.merge(
                                  style: T.body(color: const Color(0xDDFFFFFF), size: 14.5),
                                  child: ledeWidget ?? Text(lede!),
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),
                  Expanded(
                    child: Transform.translate(
                      offset: const Offset(0, -28),
                      child: Container(
                        decoration: const BoxDecoration(
                          color: P.white,
                          borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
                        ),
                        padding: EdgeInsets.fromLTRB(22, 28, 22, 8 + inset.bottom),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            for (var i = 0; i < children.length; i++) Rise(index: i + 2, child: children[i]),
                            if (foot != null) ...[const Spacer(), const SizedBox(height: 20), foot!],
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _AuthBrand extends StatelessWidget {
  const _AuthBrand();

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(
        width: 38,
        height: 38,
        decoration: BoxDecoration(color: P.white, borderRadius: BorderRadius.circular(13)),
        child: const Center(child: AtriaIcon('pulse', size: 20, color: P.blue700)),
      ),
      const SizedBox(width: 10),
      Text('Atria', style: T.heading(color: P.white, size: 20)),
    ],
  );
}
