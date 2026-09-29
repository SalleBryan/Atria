import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/tokens.dart';

/// The M3 Expressive loading indicator, as the web's LoadingIndicator draws
/// it: a soft many-lobed shape that turns and breathes between a round
/// "cookie" and a sharper star, never a thin spinning arc.
class LoadingIndicator extends StatefulWidget {
  const LoadingIndicator({super.key, this.size = 44, this.color = AtriaColors.blue600, this.label = 'Loading'});
  final double size;
  final Color color;
  final String label;

  @override
  State<LoadingIndicator> createState() => _LoadingIndicatorState();
}

class _LoadingIndicatorState extends State<LoadingIndicator> with SingleTickerProviderStateMixin {
  late final AnimationController turn = AnimationController(vsync: this, duration: const Duration(milliseconds: 2275));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Reduced motion holds the shape still; it still says what is happening.
    if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) {
      turn.stop();
    } else if (!turn.isAnimating) {
      turn.repeat();
    }
  }

  @override
  void dispose() {
    turn.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Semantics(
    label: widget.label,
    liveRegion: true,
    child: SizedBox.square(
      dimension: widget.size,
      child: AnimatedBuilder(
        animation: turn,
        builder: (context, _) => CustomPaint(painter: _Shape(turn.value, widget.color)),
      ),
    ),
  );
}

class _Shape extends CustomPainter {
  _Shape(this.t, this.color);
  final double t;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final centre = size.center(Offset.zero);
    final radius = size.width / 2;
    // Seven lobes, deepening and easing back twice a turn.
    final depth = .06 + .1 * (0.5 - 0.5 * math.cos(t * 4 * math.pi));
    const lobes = 7;
    final path = Path();
    const steps = 96;
    for (var i = 0; i <= steps; i++) {
      final a = i / steps * 2 * math.pi;
      final r = radius * (1 - depth) + radius * depth * math.cos(lobes * a);
      final p = centre + Offset(math.cos(a + t * 2 * math.pi), math.sin(a + t * 2 * math.pi)) * r * .92;
      i == 0 ? path.moveTo(p.dx, p.dy) : path.lineTo(p.dx, p.dy);
    }
    canvas.drawPath(path..close(), Paint()..color = color);
  }

  @override
  bool shouldRepaint(_Shape old) => old.t != t || old.color != color;
}

/// A loading indicator centred in the space the content will fill.
class LoadingPane extends StatelessWidget {
  const LoadingPane({super.key, this.label = 'Loading', this.height = 240});
  final String label;
  final double height;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: height,
    child: Center(child: LoadingIndicator(label: label)),
  );
}
