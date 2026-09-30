import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../api/api.dart';
import '../patient/data.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/expressive.dart';
import '../ui/form_parts.dart';
import '../ui/glass.dart';
import '../ui/icons.dart';
import '../ui/loading.dart';
import '../ui/widgets.dart';

/// Request a procedure (FR-BKG-12; the web's RequestProcedure): the patient
/// names a minor procedure and a unit in a few words; the unit sizes it and
/// offers a time, and nothing is booked until the patient confirms. The
/// request then lives in My visits, where its answer arrives.
class RequestProcedureScreen extends StatefulWidget {
  const RequestProcedureScreen({super.key, required this.store});
  final PatientStore store;

  @override
  State<RequestProcedureScreen> createState() => _RequestProcedureScreenState();
}

class _RequestProcedureScreenState extends State<RequestProcedureScreen> {
  final note = TextEditingController();
  String? typeId;
  String? clinicId;
  bool busy = false;
  String? failure;

  @override
  void dispose() {
    note.dispose();
    super.dispose();
  }

  Future<void> send(AppointmentType type, Clinic unit) async {
    setState(() {
      busy = true;
      failure = null;
    });
    try {
      final made = await widget.store.api.send('POST', '/procedure-requests', {
        'appointmentTypeId': type.id,
        'clinicId': unit.id,
        'note': note.text.trim(),
      });
      await widget.store.reload();
      if (!mounted) return;
      // One navigation: the request page gives way to the new request's page.
      // (A go and a push in the same frame made go_router build the tab shell
      // twice.)
      context.go('/visits/${made['appointmentId']}');
    } on ApiError catch (e) {
      if (mounted) {
        setState(() {
          busy = false;
          failure = '${e.message} Nothing was sent.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: PageBackground(
      child: SafeArea(
        child: ListenableBuilder(
          listenable: widget.store,
          builder: (context, _) {
            final state = widget.store.state;
            if (state is DataFailed) {
              return Padding(
                padding: const EdgeInsets.all(20),
                child: Notice(state.message, tone: NoticeTone.error),
              );
            }
            if (state is! DataReady) return const LoadingPane(label: 'Loading procedures');
            final data = state.data;
            final procedures = data.types.where((t) => t.serviceLine == 'PROCEDURE' && t.patientRequestable).toList();
            final type = procedures.where((t) => t.id == typeId).firstOrNull ?? procedures.firstOrNull;
            final units = data.clinics.where((c) => type != null && type.offeredAt(c.id)).toList();
            final unit = units.where((c) => c.id == clinicId).firstOrNull ?? units.firstOrNull;
            return Column(
              children: [
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(20, 14, 20, 20),
                    children: [
                      Rise(
                        child: Row(
                          children: [
                            BackSquare(onPressed: () => context.canPop() ? context.pop() : context.go('/find-care')),
                            Expanded(
                              child: Text(
                                'Request a procedure',
                                textAlign: TextAlign.center,
                                style: AtriaType.display(size: 16, weight: FontWeight.w600),
                              ),
                            ),
                            const SizedBox(width: 42),
                          ],
                        ),
                      ),
                      const SizedBox(height: 18),
                      Rise(
                        index: 1,
                        child: Text(
                          'No time is held yet. The unit sizes it and offers you a time to confirm.',
                          style: AtriaType.body(size: 14, color: AtriaColors.ink700, height: 1.45),
                        ),
                      ),
                      const SizedBox(height: 20),
                      if (procedures.isEmpty)
                        const Notice('No procedure can be requested online at the moment. The front desk can help.')
                      else ...[
                        Rise(
                          index: 2,
                          child: Text('Procedure', style: AtriaType.display(size: 16, weight: FontWeight.w600)),
                        ),
                        const SizedBox(height: 10),
                        for (var i = 0; i < procedures.length; i++) ...[
                          if (i > 0) const SizedBox(height: 10),
                          Rise(
                            index: 3 + i,
                            child: _Choice(
                              title: procedures[i].name,
                              sub: procedures[i].durationUnits == null
                                  ? 'Sized by the unit'
                                  : 'About ${procedures[i].durationUnits! * 10} minutes',
                              on: procedures[i].id == type?.id,
                              onTap: () => setState(() {
                                typeId = procedures[i].id;
                                clinicId = null;
                              }),
                            ),
                          ),
                        ],
                        const SizedBox(height: 22),
                        Text('Unit', style: AtriaType.display(size: 16, weight: FontWeight.w600)),
                        const SizedBox(height: 10),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            for (final c in units)
                              _UnitChip(
                                label: c.name,
                                on: c.id == unit?.id,
                                onTap: () => setState(() => clinicId = c.id),
                              ),
                          ],
                        ),
                        const SizedBox(height: 22),
                        Text('A note for the unit', style: AtriaType.display(size: 16, weight: FontWeight.w600)),
                        const SizedBox(height: 10),
                        Glass(
                          radius: 20,
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                          child: TextField(
                            controller: note,
                            maxLength: 500,
                            minLines: 3,
                            maxLines: 6,
                            onTapOutside: (_) => FocusManager.instance.primaryFocus?.unfocus(),
                            style: AtriaType.body(size: 14.5, color: AtriaColors.inkPrimary),
                            decoration: InputDecoration(
                              border: InputBorder.none,
                              hintText: 'A few words, for example what the doctor who referred you said',
                              hintMaxLines: 2,
                              hintStyle: AtriaType.body(size: 14, color: const Color(0xFF8497B8)),
                            ),
                          ),
                        ),
                        if (failure != null) ...[const SizedBox(height: 14), Notice(failure!, tone: NoticeTone.error)],
                      ],
                    ],
                  ),
                ),
                if (type != null && unit != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
                    child: PrimaryButton(
                      label: 'Send the request',
                      busy: busy,
                      onPressed: busy ? null : () => send(type, unit),
                    ),
                  ),
              ],
            );
          },
        ),
      ),
    ),
  );
}

/// One procedure: glass at rest, the accent edge and a check when chosen.
class _Choice extends StatelessWidget {
  const _Choice({required this.title, required this.sub, required this.on, required this.onTap});
  final String title;
  final String sub;
  final bool on;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    selected: on,
    child: Pressable(
      onTap: onTap,
      radius: 22,
      ink: AtriaColors.blue700,
      semanticLabel: '$title, $sub',
      builder: (context, _) => AnimatedContainer(
        duration: AtriaMotion.spatialFastDuration,
        curve: AtriaMotion.spatialFast,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: on ? 1 : .75),
          borderRadius: BorderRadius.circular(on ? 26 : 20),
          border: Border.all(color: on ? AtriaColors.blue500 : Colors.white, width: on ? 1.8 : 1),
          boxShadow: [
            BoxShadow(
              offset: const Offset(0, 6),
              blurRadius: 16,
              color: on ? const Color(0x2E2F6BE4) : const Color(0x0F0F295E),
            ),
          ],
        ),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                gradient: on ? accentGradient() : null,
                color: on ? null : AtriaColors.blue100,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Center(child: AtriaIcon('clipboard', size: 18, color: on ? Colors.white : AtriaColors.blue600)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: AtriaType.body(size: 14.5, weight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Text(sub, style: AtriaType.body(size: 12, color: AtriaColors.inkSoft)),
                ],
              ),
            ),
            AnimatedScale(
              scale: on ? 1 : 0,
              duration: AtriaMotion.spatialFastDuration,
              curve: AtriaMotion.spatialFast,
              child: const AtriaIcon('checkMark', size: 18, color: AtriaColors.blue600),
            ),
          ],
        ),
      ),
    ),
  );
}

class _UnitChip extends StatelessWidget {
  const _UnitChip({required this.label, required this.on, required this.onTap});
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
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
        decoration: BoxDecoration(
          gradient: on ? accentGradient() : null,
          color: on ? null : Colors.white.withValues(alpha: .8),
          borderRadius: BorderRadius.circular(on ? 22 : 15),
          border: Border.all(color: Colors.white),
        ),
        child: Text(
          label,
          style: AtriaType.body(size: 13.5, weight: FontWeight.w600, color: on ? Colors.white : AtriaColors.ink700),
        ),
      ),
    ),
  );
}

/// "Request a procedure": the way in, beside "See a doctor today".
class RequestEntry extends StatelessWidget {
  const RequestEntry({super.key});

  @override
  Widget build(BuildContext context) => Glass(
    radius: 22,
    semanticLabel: 'Request a procedure, the unit offers you a time',
    onTap: () => context.push('/request'),
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
    child: Row(
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            gradient: cssGradient(145, const [Color(0xFF8B7BF0), Color(0xFF5B49CE)]),
            borderRadius: BorderRadius.circular(14),
          ),
          child: const Center(child: AtriaIcon('clipboard', size: 19, color: Colors.white)),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Request a procedure',
                style: AtriaType.body(size: 14, weight: FontWeight.w700, color: AtriaColors.inkPrimary),
              ),
              Text('The unit offers you a time', style: AtriaType.body(size: 12, color: AtriaColors.inkSoft)),
            ],
          ),
        ),
        const AtriaIcon('chevronRight', size: 16, color: AtriaColors.ink400),
      ],
    ),
  );
}
