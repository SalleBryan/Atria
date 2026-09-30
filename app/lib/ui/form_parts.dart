import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../theme/theme.dart';
import '../theme/tokens.dart';
import 'icons.dart';
import '../ds/kit.dart';
import '../ds/palette.dart';

/// The 42 square glass back button at the top of an auth frame (32:65).
class BackSquare extends StatelessWidget {
  const BackSquare({super.key, this.onPressed});
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => RoundBtn(
    'arrowLeft',
    label: 'Back',
    onPressed: onPressed ?? () => context.canPop() ? context.pop() : context.go('/sign-in'),
  );
}

/// The icon that heads a verify or reset screen.
class IconTile extends StatelessWidget {
  const IconTile(this.icon, {super.key});
  final String icon;

  @override
  Widget build(BuildContext context) => IconBubble(icon, size: 60, solid: true);
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
                  color: checked ? P.blue700 : Colors.white,
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
                    style: AtriaType.body(size: 12.5, color: P.ink2, height: 1.45),
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
                        color: i < code.length ? P.white : P.blue50,
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
