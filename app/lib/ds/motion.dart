import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/tokens.dart';
import '../ui/expressive.dart';

/// Words that rise into place one after another on the default spatial
/// spring, as the landing page's headlines do (web: Rise in LandingMore.tsx).
class WordRise extends StatelessWidget {
  const WordRise(this.text, {super.key, required this.style, this.delay = 0, this.align = WrapAlignment.start});
  final String text;
  final TextStyle style;
  final int delay;
  final WrapAlignment align;

  @override
  Widget build(BuildContext context) {
    final words = text.split(' ');
    if (reduceMotion(context)) return Text(text, style: style);
    return Semantics(
      label: text,
      child: ExcludeSemantics(
        child: Wrap(
          alignment: align,
          children: [
            for (var i = 0; i < words.length; i++)
              _Word(
                key: ValueKey('$text/$i'),
                word: i == words.length - 1 ? words[i] : '${words[i]} ',
                style: style,
                delay: delay + 55 * i,
              ),
          ],
        ),
      ),
    );
  }
}

class _Word extends StatelessWidget {
  const _Word({super.key, required this.word, required this.style, required this.delay});
  final String word;
  final TextStyle style;
  final int delay;

  @override
  Widget build(BuildContext context) {
    final total = AtriaMotion.spatialSlowDuration.inMilliseconds + delay;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: Duration(milliseconds: total),
      builder: (context, t, child) {
        final local = ((t * total - delay) / AtriaMotion.spatialSlowDuration.inMilliseconds).clamp(0.0, 1.0);
        final move = AtriaMotion.spatialDefault.transform(local);
        return ClipRect(
          child: Opacity(
            opacity: AtriaMotion.effects.transform(local),
            child: Transform.translate(offset: Offset(0, style.fontSize! * .9 * (1 - move)), child: child),
          ),
        );
      },
      child: Text(word, style: style),
    );
  }
}

/// A soft many-lobed shape, the M3 Expressive shapes the landing page morphs
/// between (landing-more.css, m3-morph). [shapes] are (lobes, depth) pairs,
/// and [at] is a position along them: 1.4 is 40% of the way from the second
/// to the third, so animating [at] on a spring morphs one into the next.
Path blobPath(Size size, double at, List<(int, double)> shapes, double turn) {
  final i = at.floor().clamp(0, shapes.length - 1);
  final j = (i + 1).clamp(0, shapes.length - 1);
  final t = (at - i).clamp(0.0, 1.0);
  final (la, da) = shapes[i];
  final (lb, db) = shapes[j];
  final radius = size.shortestSide / 2;
  final centre = size.center(Offset.zero);
  final path = Path();
  const n = 144;
  for (var k = 0; k <= n; k++) {
    final a = k / n * 2 * math.pi;
    final ra = 1 - da + da * math.cos(la * (a + turn));
    final rb = 1 - db + db * math.cos(lb * (a + turn));
    final r = radius * (ra + (rb - ra) * t);
    final p = centre + Offset(math.cos(a), math.sin(a)) * r;
    k == 0 ? path.moveTo(p.dx, p.dy) : path.lineTo(p.dx, p.dy);
  }
  return path..close();
}

class BlobClipper extends CustomClipper<Path> {
  BlobClipper(this.at, this.shapes, this.turn);
  final double at;
  final List<(int, double)> shapes;
  final double turn;

  @override
  Path getClip(Size size) => blobPath(size, at, shapes, turn);

  @override
  bool shouldReclip(BlobClipper old) => old.at != at || old.turn != turn;
}

/// A slow endless turn, for shapes that should never be quite still.
class Turning extends StatefulWidget {
  const Turning({super.key, required this.builder, this.period = const Duration(seconds: 30)});
  final Widget Function(BuildContext context, double turn) builder;
  final Duration period;

  @override
  State<Turning> createState() => _TurningState();
}

class _TurningState extends State<Turning> with SingleTickerProviderStateMixin {
  late final AnimationController loop = AnimationController(vsync: this, duration: widget.period);

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
  Widget build(BuildContext context) =>
      AnimatedBuilder(animation: loop, builder: (context, _) => widget.builder(context, loop.value * 2 * math.pi));
}

/// Springs in from below and a little small: for cards arriving in a scene.
class PopIn extends StatelessWidget {
  const PopIn({super.key, required this.child, this.delay = 0, this.from = const Offset(0, 26)});
  final Widget child;
  final int delay;
  final Offset from;

  @override
  Widget build(BuildContext context) {
    if (reduceMotion(context)) return child;
    final total = AtriaMotion.spatialSlowDuration.inMilliseconds + delay;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: Duration(milliseconds: total),
      builder: (context, t, child) {
        final local = ((t * total - delay) / AtriaMotion.spatialSlowDuration.inMilliseconds).clamp(0.0, 1.0);
        final move = AtriaMotion.spatialFast.transform(local);
        return Opacity(
          opacity: AtriaMotion.effects.transform(local),
          child: Transform.translate(
            offset: from * (1 - move),
            child: Transform.scale(scale: .9 + .1 * move, child: child),
          ),
        );
      },
      child: child,
    );
  }
}
