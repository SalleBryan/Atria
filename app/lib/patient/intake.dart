import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/api.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/expressive.dart';
import '../ui/form_parts.dart';
import '../ui/glass.dart';
import '../ui/icons.dart';
import '../ui/loading.dart';
import '../ui/widgets.dart';

/// Care context (FR-BKG-15, FR-PRV-10): the few questions a visit type asks
/// ahead of the visit, as the web's IntakeFields and IntakeDialog put them.
/// Only the patient and the assigned clinician read the answers.
class IntakeField {
  IntakeField(this.raw);
  final Map<String, dynamic> raw;
  String get id => raw['id'] as String;
  String get kind => raw['kind'] as String? ?? 'text';
  String get label => raw['label'] as String? ?? '';
  String? get hint => raw['hint'] as String?;
  bool get required => raw['required'] == true;
  int? get max => raw['max'] as int?;
  int? get min => raw['min'] as int?;
  List<(String, String)> get options => [
    for (final o in (raw['options'] as List? ?? const []).cast<Map>()) ('${o['id']}', '${o['label']}'),
  ];
}

class IntakeForm {
  IntakeForm(this.raw);
  final Map<String, dynamic> raw;
  String get id => raw['intakeFormId'] as String? ?? '';
  String get name => raw['name'] as String? ?? '';
  List<IntakeField> get fields => [
    for (final f in (raw['fields'] as List? ?? const []).cast<Map<String, dynamic>>()) IntakeField(f),
  ];

  static IntakeForm? of(Object? raw) => raw is Map<String, dynamic> ? IntakeForm(raw) : null;
}

/// The first needed question left unanswered, if any.
String? missingAnswer(IntakeForm form, Map<String, Object?> answers) => form.fields
    .where((f) => f.required && (answers[f.id] == null || answers[f.id] == ''))
    .map((f) => f.label)
    .firstOrNull;

/// What the patient gave before booking: answers with consent, or nothing.
class IntakeResult {
  const IntakeResult(this.answers);
  final Map<String, Object?>? answers;
  bool get given => answers != null;
  Map<String, Object?>? get body => answers == null ? null : {'answers': answers, 'consent': true};
}

/// The questions, one under another, then the consent.
class IntakeFields extends StatelessWidget {
  const IntakeFields({
    super.key,
    required this.form,
    required this.answers,
    required this.onChanged,
    required this.consent,
    required this.onConsent,
    required this.clinician,
  });
  final IntakeForm form;
  final Map<String, Object?> answers;
  final void Function(String id, Object? value) onChanged;
  final bool consent;
  final ValueChanged<bool> onConsent;
  final String clinician;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      for (final f in form.fields) ...[
        Row(
          children: [
            Expanded(
              child: Text(
                f.label,
                style: AtriaType.body(size: 13.5, weight: FontWeight.w700, color: AtriaColors.ink900),
              ),
            ),
            Text(
              f.required ? 'Needed' : 'Optional',
              style: AtriaType.body(
                size: 11,
                weight: FontWeight.w700,
                color: f.required ? AtriaColors.blue600 : AtriaColors.inkSoft,
              ),
            ),
          ],
        ),
        if (f.hint != null) ...[
          const SizedBox(height: 2),
          Text(f.hint!, style: AtriaType.body(size: 12, color: AtriaColors.inkSoft, height: 1.35)),
        ],
        const SizedBox(height: 8),
        _Input(field: f, value: answers[f.id], onChanged: (v) => onChanged(f.id, v)),
        const SizedBox(height: 16),
      ],
      AtriaCheckbox(
        checked: consent,
        onChanged: onConsent,
        label:
            "Share these answers with $clinician only. The front desk and the hospital's administrators cannot read them, and they are deleted 90 days after the visit.",
      ),
    ],
  );
}

class _Input extends StatefulWidget {
  const _Input({required this.field, required this.value, required this.onChanged});
  final IntakeField field;
  final Object? value;
  final ValueChanged<Object?> onChanged;

  @override
  State<_Input> createState() => _InputState();
}

class _InputState extends State<_Input> {
  late final text = TextEditingController(text: widget.value == null ? '' : '${widget.value}');

  @override
  void dispose() {
    text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final f = widget.field;
    if (f.kind == 'choice' || f.kind == 'yesNo') {
      final options = f.kind == 'yesNo' ? [(true, 'Yes'), (false, 'No')] : [for (final (id, l) in f.options) (id, l)];
      return Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final (value, label) in options)
            _Option(
              label: label,
              on: widget.value == value,
              onTap: () => widget.onChanged(widget.value == value ? null : value),
            ),
        ],
      );
    }
    final long = f.kind == 'longText';
    final number = f.kind == 'number';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: AtriaColors.lineHairline, width: 1.5),
      ),
      child: TextField(
        controller: text,
        minLines: long ? 3 : 1,
        maxLines: long ? 6 : 1,
        maxLength: number ? 4 : (f.max ?? (long ? 1000 : 160)),
        keyboardType: number ? TextInputType.number : TextInputType.text,
        inputFormatters: number ? [FilteringTextInputFormatter.digitsOnly] : null,
        onTapOutside: (_) => FocusManager.instance.primaryFocus?.unfocus(),
        onChanged: (v) => widget.onChanged(number ? int.tryParse(v) : (v.trim().isEmpty ? null : v)),
        style: AtriaType.body(size: 14.5, color: AtriaColors.inkPrimary),
        decoration: InputDecoration(
          border: InputBorder.none,
          counterText: '',
          hintText: number && f.min != null && f.max != null ? '${f.min} to ${f.max}' : null,
          hintStyle: AtriaType.body(size: 14, color: const Color(0xFF9AA9C4)),
        ),
      ),
    );
  }
}

class _Option extends StatelessWidget {
  const _Option({required this.label, required this.on, required this.onTap});
  final String label;
  final bool on;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    selected: on,
    child: Pressable(
      onTap: onTap,
      radius: 16,
      ink: AtriaColors.blue700,
      semanticLabel: label,
      builder: (context, _) => AnimatedContainer(
        duration: AtriaMotion.spatialFastDuration,
        curve: AtriaMotion.spatialFast,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          gradient: on ? accentGradient() : null,
          color: on ? null : Colors.white,
          borderRadius: BorderRadius.circular(on ? 20 : 15),
          border: Border.all(color: on ? Colors.transparent : AtriaColors.lineHairline, width: 1.5),
        ),
        child: ExcludeSemantics(
          child: Text(
            label,
            style: AtriaType.body(size: 13.5, weight: FontWeight.w600, color: on ? Colors.white : AtriaColors.ink800),
          ),
        ),
      ),
    ),
  );
}

/// Before booking a visit whose type asks questions (the web's IntakeDialog):
/// answer and share, or book without answers. Null when the sheet is closed.
Future<IntakeResult?> askBeforeBooking(BuildContext context, IntakeForm form, String clinician) =>
    showModalBottomSheet<IntakeResult>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => _IntakeSheet(form: form, clinician: clinician),
    );

class _IntakeSheet extends StatefulWidget {
  const _IntakeSheet({required this.form, required this.clinician});
  final IntakeForm form;
  final String clinician;

  @override
  State<_IntakeSheet> createState() => _IntakeSheetState();
}

class _IntakeSheetState extends State<_IntakeSheet> {
  final answers = <String, Object?>{};
  bool consent = false;
  String? problem;

  void share() {
    final missing = missingAnswer(widget.form, answers);
    if (missing != null) return setState(() => problem = 'Please answer: $missing');
    if (!consent) return setState(() => problem = 'Tick the box to share your answers, or book without them.');
    Navigator.pop(context, IntakeResult({...answers}..removeWhere((_, v) => v == null)));
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
    child: Container(
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * .92),
      decoration: const BoxDecoration(
        color: AtriaColors.surfacePanel,
        borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                margin: const EdgeInsets.only(top: 10),
                width: 40,
                height: 5,
                decoration: BoxDecoration(color: AtriaColors.lineSoft, borderRadius: BorderRadius.circular(3)),
              ),
            ),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.fromLTRB(22, 18, 22, 12),
                children: [
                  Text('Before your visit', style: AtriaType.display(size: 22)),
                  const SizedBox(height: 6),
                  Text(
                    'A few questions from ${widget.clinician}, so your visit starts where it should. Answer what you like, or book now and add them later from your visit.',
                    style: AtriaType.body(size: 13.5, color: AtriaColors.inkMuted),
                  ),
                  const SizedBox(height: 18),
                  IntakeFields(
                    form: widget.form,
                    answers: answers,
                    onChanged: (id, v) => setState(() {
                      answers[id] = v;
                      problem = null;
                    }),
                    consent: consent,
                    onConsent: (v) => setState(() {
                      consent = v;
                      problem = null;
                    }),
                    clinician: widget.clinician,
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(22, 4, 22, 14),
              child: Column(
                children: [
                  if (problem != null) ...[Notice(problem!, tone: NoticeTone.error), const SizedBox(height: 10)],
                  PrimaryButton(label: 'Share and book', onPressed: share),
                  const SizedBox(height: 10),
                  SecondaryButton(
                    label: 'Book without answers',
                    onPressed: () => Navigator.pop(context, const IntakeResult(null)),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

/// "Before your visit" on the visit page: the answers given, and, while the
/// visit is ahead, a way to add or change them (GET and PUT
/// /appointments/{id}/care-context).
class BeforeVisitCard extends StatefulWidget {
  const BeforeVisitCard({super.key, required this.api, required this.appointmentId, required this.clinician});
  final Api api;
  final String appointmentId;
  final String clinician;

  @override
  State<BeforeVisitCard> createState() => _BeforeVisitCardState();
}

class _BeforeVisitCardState extends State<BeforeVisitCard> {
  Map<String, dynamic>? held;
  String? failure;
  bool editing = false;
  bool saving = false;
  bool consent = false;
  Map<String, Object?> draft = {};

  String get path => '/appointments/${Uri.encodeComponent(widget.appointmentId)}/care-context';

  @override
  void initState() {
    super.initState();
    widget.api
        .get(path)
        .then(
          (found) {
            if (mounted) setState(() => held = found);
          },
          onError: (Object e) {
            if (mounted) setState(() => failure = e is ApiError ? e.message : 'The questions could not be loaded.');
          },
        );
  }

  Future<void> save(IntakeForm form) async {
    final missing = missingAnswer(form, draft);
    if (missing != null) return setState(() => failure = 'Please answer: $missing');
    if (!consent) return setState(() => failure = 'Tick the box to share your answers.');
    setState(() {
      saving = true;
      failure = null;
    });
    try {
      final saved = await widget.api.send('PUT', path, {
        'answers': {...draft}..removeWhere((_, v) => v == null),
        'consent': true,
      });
      if (mounted) {
        setState(() {
          held = saved;
          editing = false;
        });
        say(context, 'Your answers are saved.');
      }
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = e.message);
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  String shown(IntakeField f, Object? v) => switch (v) {
    null || '' => 'Not answered',
    true => 'Yes',
    false => 'No',
    _ => f.kind == 'choice' ? f.options.where((o) => o.$1 == '$v').firstOrNull?.$2 ?? '$v' : '$v',
  };

  @override
  Widget build(BuildContext context) {
    final data = held;
    final form = IntakeForm.of(data?['form']);
    if (data != null && form == null) return const SizedBox.shrink();
    final answers = (data?['answers'] as Map?)?.cast<String, Object?>();
    final editable = data?['editable'] == true;
    return Glass(
      radius: 26,
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const AtriaIcon('clipboard', size: 18, color: AtriaColors.blue600),
              const SizedBox(width: 9),
              Expanded(
                child: Text('Before your visit', style: AtriaType.display(size: 17, weight: FontWeight.w600)),
              ),
              if (editable && !editing && form != null)
                TextButton(
                  onPressed: () => setState(() {
                    editing = true;
                    draft = {...?answers};
                    consent = false;
                    failure = null;
                  }),
                  child: Text(
                    answers == null ? 'Answer' : 'Change',
                    style: AtriaType.body(size: 13, weight: FontWeight.w700, color: AtriaColors.blue600),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 6),
          if (data == null && failure == null)
            const Padding(
              padding: EdgeInsets.all(16),
              child: Center(child: LoadingIndicator(size: 32)),
            )
          else if (editing && form != null) ...[
            Text(
              'Only you and ${widget.clinician} read these.',
              style: AtriaType.body(size: 12.5, color: AtriaColors.inkSoft),
            ),
            const SizedBox(height: 14),
            IntakeFields(
              form: form,
              answers: draft,
              onChanged: (id, v) => setState(() => draft[id] = v),
              consent: consent,
              onConsent: (v) => setState(() => consent = v),
              clinician: widget.clinician,
            ),
            if (failure != null) ...[const SizedBox(height: 12), Notice(failure!, tone: NoticeTone.error)],
            const SizedBox(height: 14),
            PrimaryButton(label: 'Save my answers', busy: saving, onPressed: () => save(form)),
            const SizedBox(height: 8),
            SecondaryButton(label: 'Keep them as they were', onPressed: () => setState(() => editing = false)),
          ] else if (failure != null)
            Notice(failure!, tone: NoticeTone.error)
          else if (answers == null)
            Text(
              editable
                  ? '${widget.clinician} asks a few questions ahead of the visit. Answer them so your visit starts where it should.'
                  : 'No answers were given for this visit.',
              style: AtriaType.body(size: 13, color: AtriaColors.inkMuted),
            )
          else
            for (final f in form!.fields)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      f.label,
                      style: AtriaType.body(size: 12, weight: FontWeight.w600, color: AtriaColors.inkSoft),
                    ),
                    const SizedBox(height: 2),
                    Text(shown(f, answers[f.id]), style: AtriaType.body(size: 14, color: AtriaColors.ink900)),
                  ],
                ),
              ),
        ],
      ),
    );
  }
}
