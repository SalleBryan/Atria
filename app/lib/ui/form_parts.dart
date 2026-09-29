import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../theme/theme.dart';
import '../theme/tokens.dart';
import 'icons.dart';
import 'expressive.dart';

/// The 42 square glass back button at the top of an auth frame (32:65).
class BackSquare extends StatelessWidget {
  const BackSquare({super.key, this.onPressed});
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => PressableSurface(
    semanticLabel: 'Back',
    radius: 14,
    width: 42,
    height: 42,
    border: Border.all(color: Colors.white),
    gradient: cssGradient(140, const [Color(0xF0FFFFFF), Color(0xA8FFFFFF)], [.145, .855]),
    shadow: const BoxShadow(offset: Offset(0, 2), blurRadius: 8, color: Color(0x140F295E)),
    ink: AtriaColors.blue700,
    onTap: onPressed ?? () => context.canPop() ? context.pop() : context.go('/sign-in'),
    child: const AtriaIcon('chevronLeft', size: 18, color: AtriaColors.ink900),
  );
}

/// The blue icon tile that heads a verify or reset frame (33:2, 33:44).
class IconTile extends StatelessWidget {
  const IconTile(this.icon, {super.key});
  final String icon;

  @override
  Widget build(BuildContext context) => Container(
    width: 62,
    height: 62,
    decoration: BoxDecoration(
      borderRadius: BorderRadius.circular(21),
      gradient: cssGradient(145, const [AtriaColors.blue500, Color(0xFF2159D2)], [.141, .859]),
      boxShadow: const [BoxShadow(offset: Offset(0, 10), blurRadius: 24, color: Color(0x572159D2))],
    ),
    child: Center(child: AtriaIcon(icon, size: 26, color: Colors.white)),
  );
}

/// A square check with its words (32:124), the whole row tappable.
class AtriaCheckbox extends StatelessWidget {
  const AtriaCheckbox({super.key, required this.checked, required this.onChanged, required this.label, this.error});
  final bool checked;
  final ValueChanged<bool> onChanged;
  final String label;
  final String? error;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Semantics(
        checked: checked,
        label: label,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => onChanged(!checked),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AnimatedContainer(
                duration: AtriaMotion.spatialFastDuration,
                curve: AtriaMotion.spatialFast,
                width: 22,
                height: 22,
                decoration: BoxDecoration(
                  color: checked ? null : Colors.white,
                  gradient: checked ? AtriaGradients.primary : null,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: checked
                        ? Colors.transparent
                        : (error == null ? AtriaColors.lineSoft : AtriaColors.cancelled),
                    width: 1.5,
                  ),
                ),
                child: checked ? const Center(child: AtriaIcon('checkMark', size: 14, color: Colors.white)) : null,
              ),
              const SizedBox(width: 11),
              Expanded(
                child: ExcludeSemantics(
                  child: Text(
                    label,
                    style: AtriaType.body(size: 11.5, color: AtriaColors.inkMuted, height: 17.25 / 11.5),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
      if (error != null) ...[
        const SizedBox(height: 6),
        Text(error!, style: AtriaType.body(size: 11.5, color: AtriaColors.cancelledInk, height: 1.35)),
      ],
    ],
  );
}

/// Six boxes for a six digit code (33:2), backed by one hidden field so the
/// keyboard, paste and the SMS/email autofill all work as for any field.
class CodeBoxes extends StatefulWidget {
  const CodeBoxes({super.key, required this.controller, this.onComplete, this.invalid = false});
  final TextEditingController controller;
  final ValueChanged<String>? onComplete;
  final bool invalid;

  @override
  State<CodeBoxes> createState() => _CodeBoxesState();
}

class _CodeBoxesState extends State<CodeBoxes> {
  final focus = FocusNode();

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_changed);
    focus.addListener(_changed);
  }

  void _changed() {
    setState(() {});
    if (widget.controller.text.length == 6) widget.onComplete?.call(widget.controller.text);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_changed);
    focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final code = widget.controller.text;
    return Stack(
      children: [
        Opacity(
          opacity: 0,
          child: SizedBox(
            height: 58,
            child: TextField(
              onTapOutside: (_) => FocusManager.instance.primaryFocus?.unfocus(),
              controller: widget.controller,
              focusNode: focus,
              autofocus: true,
              keyboardType: TextInputType.number,
              autofillHints: const [AutofillHints.oneTimeCode],
              maxLength: 6,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(counterText: ''),
            ),
          ),
        ),
        GestureDetector(
          onTap: () => focus.requestFocus(),
          child: Semantics(
            label: 'Code, ${code.length} of 6 digits',
            child: Row(
              children: [
                for (var i = 0; i < 6; i++) ...[
                  if (i > 0) const SizedBox(width: 8),
                  Expanded(
                    child: AnimatedContainer(
                      duration: AtriaMotion.effectsDefaultDuration,
                      height: 58,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(17),
                        border: Border.all(
                          color: widget.invalid
                              ? AtriaColors.cancelled
                              : (focus.hasFocus && i == code.length.clamp(0, 5))
                              ? AtriaColors.blue500
                              : i < code.length
                              ? AtriaColors.blue200
                              : AtriaColors.lineHairline,
                          width: 1.5,
                        ),
                        boxShadow: focus.hasFocus && i == code.length.clamp(0, 5)
                            ? const [BoxShadow(spreadRadius: 4, color: Color(0x264A83F0))]
                            : null,
                      ),
                      child: ExcludeSemantics(
                        child: Text(i < code.length ? code[i] : '', style: AtriaType.display(size: 22)),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// "Question? Action" in the grey and blue of the auth frames' feet.
class FootLink extends StatelessWidget {
  const FootLink({super.key, required this.lead, required this.action, required this.onTap});
  final String lead;
  final String action;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Center(
    child: GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text.rich(
          TextSpan(
            style: AtriaType.body(size: 13, color: const Color(0xFF6B7C9C)),
            children: [
              TextSpan(text: '$lead '),
              TextSpan(
                text: action,
                style: AtriaType.body(
                  size: 13,
                  weight: FontWeight.w700,
                  color: onTap == null ? AtriaColors.inkSoft : AtriaColors.blue600,
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
