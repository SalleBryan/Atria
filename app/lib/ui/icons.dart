import 'package:flutter/widgets.dart';
import 'package:flutter_svg/flutter_svg.dart';

import 'icon_paths.dart';

/// A Rev A line icon (icon_paths.dart): round caps, strokes, no fills. The
/// mobile frames draw them 17 wide with a 1.35 stroke, which is 1.9 on the
/// 24 unit grid.
class AtriaIcon extends StatelessWidget {
  const AtriaIcon(this.name, {super.key, this.size = 17, required this.color, this.stroke});
  final String name;
  final double size;
  final Color color;
  final double? stroke;

  @override
  Widget build(BuildContext context) {
    final (body, own) = atriaIconPaths[name] ?? ('', null);
    final width = stroke ?? own ?? 1.9;
    final hex = '#${(color.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';
    final svg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="$hex" '
        'stroke-width="$width" stroke-linecap="round" stroke-linejoin="round">'
        '${body.replaceAll('#000', hex)}</svg>';
    return ExcludeSemantics(
      child: Opacity(
        opacity: color.a,
        child: SvgPicture.string(svg, width: size, height: size),
      ),
    );
  }
}
